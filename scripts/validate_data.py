#!/usr/bin/env python3
"""Validate TaCL list data without requiring project dependencies."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
LIST_FILE = DATA_DIR / "_list.json"
EDITORS_FILE = DATA_DIR / "_editors.json"
VALID_EDITOR_ROLES = {"owner", "admin", "helper", "dev", "trial"}
PENDING_VIDEO_VALUES = {"soon", "tba", "pending"}
URL_RE = re.compile(r"^https?://", re.IGNORECASE)
YOUTUBE_RE = re.compile(
    r"^https?://(?:(?:www\.)?youtu\.be|(?:(?:www|m)\.)?youtube\.com)/",
    re.IGNORECASE,
)
YOUTUBE_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,}$")

errors: list[str] = []
warnings: list[str] = []


def load_json(path: Path) -> Any:
    try:
        with path.open(encoding="utf-8") as file:
            return json.load(file)
    except FileNotFoundError:
        errors.append(f"{path.relative_to(ROOT)} does not exist.")
    except json.JSONDecodeError as exc:
        errors.append(
            f"{path.relative_to(ROOT)} is invalid JSON at line {exc.lineno}, "
            f"column {exc.colno}: {exc.msg}."
        )
    return None


def location(path: Path) -> str:
    return str(path.relative_to(ROOT))


def is_non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and value.strip() != ""


def as_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def get_youtube_video_id(value: str) -> str | None:
    parsed = urlparse(value)
    host = parsed.netloc.lower()
    if host.startswith("www."):
        host = host[4:]

    path_segments = [segment for segment in parsed.path.split("/") if segment]
    video_id = ""

    if host == "youtu.be":
        video_id = path_segments[0] if path_segments else ""
    elif host in {"youtube.com", "m.youtube.com"}:
        if parsed.path == "/watch":
            video_id = parse_qs(parsed.query).get("v", [""])[0]
        elif path_segments and path_segments[0] in {"embed", "shorts", "v"}:
            video_id = path_segments[1] if len(path_segments) > 1 else ""

    return video_id if YOUTUBE_VIDEO_ID_RE.fullmatch(video_id) else None


def validate_url(
    path: Path,
    field: str,
    value: Any,
    youtube: bool = False,
    allow_pending: bool = False,
    require_video_id: bool = False,
) -> None:
    if not is_non_empty_string(value):
        errors.append(f"{location(path)}: {field} must be a non-empty URL string.")
        return

    if allow_pending and value.strip().lower() in PENDING_VIDEO_VALUES:
        warnings.append(f"{location(path)}: {field} is marked as {value!r}.")
        return

    pattern = YOUTUBE_RE if youtube else URL_RE
    if not pattern.search(value):
        errors.append(f"{location(path)}: {field} must be a valid URL.")
        return

    if youtube and not get_youtube_video_id(value):
        message = (
            f"{location(path)}: {field} should be an embeddable YouTube video URL."
        )
        if require_video_id:
            errors.append(message)
        else:
            warnings.append(message)


def validate_record(path: Path, rank: int, record: Any, index: int) -> str | None:
    prefix = f"{location(path)}: records[{index}]"
    if not isinstance(record, dict):
        errors.append(f"{prefix} must be an object.")
        return None

    user = record.get("user")
    if not is_non_empty_string(user):
        errors.append(f"{prefix}.user must be a non-empty string.")
    validate_url(path, f"records[{index}].link", record.get("link"), youtube=True)

    percent = as_number(record.get("percent"))
    if percent is None or percent <= 0 or percent > 100:
        errors.append(f"{prefix}.percent must be a number from 1 to 100.")
    elif rank > 75 and rank <= 150 and percent < 100:
        warnings.append(
            f"{location(path)}: records[{index}] is below 100% on the extended list."
        )

    hz = as_number(record.get("hz"))
    if hz is None or hz <= 0:
        errors.append(f"{prefix}.hz must be a positive number.")

    if "mobile" in record and not isinstance(record["mobile"], bool):
        errors.append(f"{prefix}.mobile must be true or false when present.")

    return user.lower() if isinstance(user, str) else None


def validate_level(slug: str, rank: int) -> None:
    path = DATA_DIR / f"{slug}.json"
    level = load_json(path)
    if level is None:
        return
    if not isinstance(level, dict):
        errors.append(f"{location(path)} must contain a JSON object.")
        return

    if not isinstance(level.get("id"), int) or isinstance(level.get("id"), bool):
        errors.append(f"{location(path)}: id must be an integer.")
    for field in ("name", "author", "verifier"):
        if not is_non_empty_string(level.get(field)):
            errors.append(f"{location(path)}: {field} must be a non-empty string.")

    creators = level.get("creators")
    if not isinstance(creators, list) or not all(
        is_non_empty_string(creator) for creator in creators
    ):
        errors.append(f"{location(path)}: creators must be a list of strings.")

    validate_url(
        path,
        "verification",
        level.get("verification"),
        youtube=True,
        allow_pending=True,
        require_video_id=True,
    )
    if level.get("showcase"):
        validate_url(
            path,
            "showcase",
            level.get("showcase"),
            youtube=True,
            require_video_id=True,
        )

    percent_to_qualify = as_number(level.get("percentToQualify"))
    if percent_to_qualify is None or percent_to_qualify <= 0 or percent_to_qualify > 100:
        errors.append(f"{location(path)}: percentToQualify must be from 1 to 100.")

    if "password" in level and not isinstance(level["password"], (str, int)):
        errors.append(f"{location(path)}: password must be a string or number.")

    records = level.get("records")
    if not isinstance(records, list):
        errors.append(f"{location(path)}: records must be a list.")
        return

    seen_users: set[str] = set()
    for index, record in enumerate(records):
        user = validate_record(path, rank, record, index)
        if user is None:
            continue
        if user in seen_users:
            warnings.append(f"{location(path)}: duplicate record user {record['user']!r}.")
        seen_users.add(user)


def validate_editors() -> None:
    editors = load_json(EDITORS_FILE)
    if editors is None:
        return
    if not isinstance(editors, list):
        errors.append(f"{location(EDITORS_FILE)} must contain a list.")
        return

    for index, editor in enumerate(editors):
        prefix = f"{location(EDITORS_FILE)}: editors[{index}]"
        if not isinstance(editor, dict):
            errors.append(f"{prefix} must be an object.")
            continue

        role = editor.get("role")
        if role not in VALID_EDITOR_ROLES:
            errors.append(
                f"{prefix}.role must be one of: {', '.join(sorted(VALID_EDITOR_ROLES))}."
            )
        if not is_non_empty_string(editor.get("name")):
            errors.append(f"{prefix}.name must be a non-empty string.")
        link = editor.get("link")
        if link and (not isinstance(link, str) or not URL_RE.search(link)):
            errors.append(f"{prefix}.link must be empty or a valid URL.")


def validate_list() -> int:
    level_list = load_json(LIST_FILE)
    if level_list is None:
        return 0
    if not isinstance(level_list, list) or len(level_list) == 0:
        errors.append(f"{location(LIST_FILE)} must contain a non-empty list.")
        return 0

    seen: set[str] = set()
    for index, slug in enumerate(level_list):
        if not is_non_empty_string(slug):
            errors.append(f"{location(LIST_FILE)}: item {index} must be a string.")
            continue
        if slug in seen:
            errors.append(f"{location(LIST_FILE)}: duplicate level {slug!r}.")
            continue
        seen.add(slug)
        validate_level(slug, index + 1)

    listed_files = {f"{slug}.json" for slug in seen}
    unlisted = sorted(
        path.name
        for path in DATA_DIR.glob("*.json")
        if not path.name.startswith("_") and path.name not in listed_files
    )
    if unlisted:
        warnings.append(
            "Unlisted level files found: " + ", ".join(unlisted)
        )

    return len(seen)


def main() -> int:
    level_count = validate_list()
    validate_editors()

    if warnings:
        print("Warnings:")
        for warning in warnings:
            print(f"  - {warning}")
        print()

    if errors:
        print("Errors:")
        for error in errors:
            print(f"  - {error}")
        return 1

    print(f"Validated {level_count} listed level files and editor metadata.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
