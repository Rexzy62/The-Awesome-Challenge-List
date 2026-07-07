# The Awesome Challenge List

The Awesome Challenge List, or TaCL, is a Geometry Dash challenge list website.
It shows ranked challenges, accepted records, player leaderboard points, and a
roulette mode for randomized practice runs.

## Features

- Ranked challenge list with records, verifier credits, level IDs, passwords,
  and embedded YouTube videos.
- Player leaderboard generated from verifier credits and accepted records.
- Challenge roulette with automatic local saves, import, and export.
- Light and dark themes.
- Responsive layout for desktop and mobile screens.
- Dependency-free data validation for level and editor JSON files.

## Running locally

This is a static site, but it should be served through a local web server so
browser module imports and JSON fetches work correctly.

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Editing list data (in forked repos etc.)

The public list order lives in:

```text
data/_list.json
```

Each entry in `_list.json` points to a level file in `data/` with the same name.
For example, `Reflect` points to:

```text
data/Reflect.json
```

Use `data/_example.json` as the shape for new level files. A listed level should
include:

- `id`
- `name`
- `author`
- `creators`
- `verifier`
- `verification`
- `percentToQualify`
- `password`
- `records`

Use an embeddable YouTube video URL for `verification` whenever possible. If a
level is approved before the video is ready, `SOON` is accepted as a temporary
placeholder; the level will show a coming-soon video state and will be skipped
by roulette until a playable video is added.

Editor metadata lives in:

```text
data/_editors.json
```

Supported editor roles are `owner`, `admin`, `helper`, `dev`, and `trial`.

## Validating data

Run the validator before submitting data changes:

```bash
python3 scripts/validate_data.py
```

The validator checks listed level files, required fields, record percentages,
Hz values, embeddable YouTube video links, editor roles, duplicate listed
levels, and malformed JSON. It reports extra unlisted level files as warnings
so drafts can live in the repository without breaking the site.

The same validation runs in GitHub Actions on pushes and pull requests.

## Project structure

```text
assets/                 Icons and images
css/                    Page, component, and typography styles
data/                   List, editor, and level JSON data
js/components/          Shared Vue components
js/pages/               List, leaderboard, and roulette pages
js/content.js           Data loading and leaderboard generation
js/score.js             Points formula
scripts/validate_data.py
```

## Credits

TaCL is maintained by the list staff and contributors:

- AcL, list owner
- Blaze, list editor
- Rexzy, list editor and coder

The original site layout is credited to TheGDPSLayoutList and TheShittyList.

## Feedback

For feedback, records, and list discussion, use the Discord link on the site or
contact Rexzy at `rexzy62@proton.me`.
