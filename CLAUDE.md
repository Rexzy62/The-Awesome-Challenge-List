# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Setup

1. Install dependencies:
   ```bash
   npm.cmd install
   ```

2. Create a `.env` file from `.env.example` and fill in:
   - `DATABASE_URL`: Neon Postgres connection string (create via Vercel Storage or locally)
   - `AUTH_SECRET`: Random string >=32 chars (generate with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`)
   - `BOOTSTRAP_ADMIN_EMAIL`: Your email for initial admin setup (remove after first admin account exists)

3. Start the development server:
   ```bash
   npm.cmd start
   ```
   The app will be available at http://127.0.0.1:8000

## Common Commands

- **Start server**: `npm.cmd start`
- **Validate data**: `npm.cmd run validate:data` (runs `python scripts/validate_data.py`)
- **Run API tests**: `npm.cmd run test:api` (requires `TEST_DATABASE_URL` env var)
- **Install dependencies**: `npm.cmd install`

## Project Structure

- `data/` - JSON data files: `_list.json` (ordered list of challenges), level files (e.g., `Reflect.json`), `_editors.json`
- `db/` - Database schema (`schema.postgres.sql`)
- `js/` - Frontend code:
  - `components/` - Vue components
  - `pages/` - Page components (list, leaderboard, roulette)
  - `content.js` - Data loading and leaderboard generation
  - `score.js` - Points calculation formula
- `css/` - Styling for pages, components, typography
- `assets/` - Images and icons
- `scripts/` - Data validation script (`validate_data.py`)
- `tests/` - API tests (`api.test.mjs`)
- `server.mjs` - Main HTTP/WebSocket server and API logic
- `vercel.json` - Vercel configuration

## Architecture Overview

- **Backend**: Node.js HTTP server with WebSocket support for real-time features. Uses Neon Postgres serverless driver for database operations.
- **Data Flow**: 
  - On startup, the server reads `data/_list.json` and corresponding level files to populate the database (if not already initialized).
  - User data (accounts, profiles, submissions) is stored in Neon Postgres.
  - API endpoints handle authentication, user profiles, level/run submissions, moderation, and admin actions.
- **Frontend**: 
  - Vanilla HTML/CSS/JavaScript with Vue.js for reactivity (via CDN, no build step).
  - Components and pages are in `js/components/` and `js/pages/`.
  - Data loading and leaderboard logic in `js/content.js`.
  - Scoring algorithm in `js/score.js`.
- **Security**: 
  - Passwords hashed with scrypt and unique salt.
  - Sessions via HTTP-only, SameSite=Lax cookies (Secure in production).
  - Server-side validation for all writes and role-based access control.
- **Deployment**: 
  - Deployed to Vercel as a serverless function (`api/[...path].js` maps to `server.mjs`).
  - Neon Postgres database attached via Vercel Storage.
  - Environment variables set in Vercel Project Settings.

## Data Validation

Before modifying challenge list data, run the validator:
```bash
npm.cmd run validate:data
```
This checks:
- Required fields in level files
- Record percentages and Hz values
- Embeddable YouTube/Twitch URLs
- Editor roles
- Duplicate entries
- JSON syntax

## Testing

API tests are in `tests/api.test.mjs` and can be run with:
```bash
TEST_DATABASE_URL=<your-test-db-url> npm.cmd run test:api
```
Tests use a separate Neon database to avoid interfering with development data.

## Notes

- Never commit `.env`, database credentials, or `AUTH_SECRET`.
- The bootstrap admin email (`BOOTSTRAP_ADMIN_EMAIL`) should be removed after the first admin account is created.
- When editing list data, ensure new level files follow the shape in `data/_example.json`.
- The server automatically creates database tables and imports list data on first API request.