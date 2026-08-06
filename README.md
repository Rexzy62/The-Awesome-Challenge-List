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

The public list is seeded from the repository JSON files. Accounts, profiles,
submissions, and moderation data live in Neon Postgres, so the same data works
locally and on Vercel. This project does not use Firebase.

Create a free Neon database through Vercel's **Storage** page, then create a
local `.env` file from `.env.example`. It needs:

- `DATABASE_URL` — the pooled Neon connection string.
- `AUTH_SECRET` — a unique, random secret at least 32 characters long. Create
  one with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.
- `BOOTSTRAP_ADMIN_EMAIL` — your real email address, only while registering
  your first administrator account.

Never commit `.env`, a database URL, or an `AUTH_SECRET`.

```bash
npm.cmd install
npm.cmd start
```

Then open:

```text
http://127.0.0.1:8000
```

On first API request, the server securely creates the required Postgres tables
and imports the list data. Register an account using the exact bootstrap email;
that account receives the `admin` role. Remove `BOOTSTRAP_ADMIN_EMAIL` after an
administrator exists. Existing admins can then manage `user`, `moderator`, and
`admin` roles in the Admin panel.

## Deploying on Vercel

1. Push the source code to GitHub. Do not push `.env` or database credentials.
2. In Vercel, import the repository as a project.
3. Open **Storage** (or **Integrations**) in that Vercel project and create a
   free Neon Postgres database. Vercel can add `DATABASE_URL` automatically.
4. In **Project Settings → Environment Variables**, add a strong `AUTH_SECRET`
   and your real `BOOTSTRAP_ADMIN_EMAIL`. Add both to Production, Preview, and
   Development as appropriate.
5. Deploy, visit the site, and register using the bootstrap email. Then remove
   `BOOTSTRAP_ADMIN_EMAIL` from Vercel and redeploy.

Vercel serves the site files and routes `/api/*` requests to the serverless
handler at `api/[...path].js`. Neon stores all user data; it is never placed in
the GitHub repository.

For a local PowerShell session, temporary environment variables also work:

```powershell
$env:DATABASE_URL = 'your-neon-connection-string'
$env:AUTH_SECRET = 'your-random-secret'
$env:BOOTSTRAP_ADMIN_EMAIL = 'owner@example.com'
npm.cmd start
```

## Application system

- Passwords use Node's `scrypt` with a unique salt. Sessions are signed,
  HTTP-only, `SameSite=Lax` cookies (and are `Secure` in production).
- All writes are validated on the server; moderator and admin endpoints are
  checked server-side on every request.
- The server imports listed levels and records from `data/_list.json` at
  startup. When an account's username or verified player identity matches an
  imported record, the completion is automatically linked to its profile.
- Approved run submissions become verified completions immediately; approved
  level submissions become active list entries immediately. Both are served
  through `/api/levels` and `/api/leaderboard`.

Run the API integration check with:

```powershell
$env:TEST_DATABASE_URL = 'a separate Neon test database URL'
npm.cmd run test:api
```

The test is skipped when `TEST_DATABASE_URL` is not supplied. Use a separate
Neon database or branch for tests because the workflow creates test accounts
and submissions.

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
