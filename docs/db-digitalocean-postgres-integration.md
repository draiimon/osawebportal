# DigitalOcean PostgreSQL Integration Log

This document lists all database-related work added to this repo for integrating the portal with PostgreSQL on DigitalOcean.

## Scope implemented

- Added a Node.js API server (`Express + pg`) in `server/`
- Added PostgreSQL schema and seed SQL files
- Added frontend API client for announcements and lost-and-found
- Wired `announcements` and `lost-and-found` pages to fetch DB data with local fallback
- Updated service worker cache version and pre-cache list for the new frontend API client
- Added environment template and npm script for API startup

## Files added

- `.env.example`
- `server/db.js`
- `server/index.js`
- `server/schema.sql`
- `server/seed.sql`
- `public/assets/js/osa-api-client.js`
- `docs/db-digitalocean-postgres-integration.md` (this file)

## Files updated

- `package.json`
  - Added dependencies: `express`, `pg`, `cors`, `dotenv`
  - Added script: `api:start`
- `public/announcements`
  - Added API client script include
  - Added `hydrateAnnouncementsFromApi()` to load API data first
  - Kept local storage + static data as fallback
- `public/lost-and-found`
  - Added API client script include
  - Added `hydrateLostFoundFromApi()` to load API data first
  - Kept local storage + static data as fallback
- `public/sw.js`
  - Bumped cache versions to `v1.0.6`
  - Added `/assets/js/osa-api-client.js?v=1` to precache list

## Environment variables

Create `.env` from `.env.example`:

```env
API_PORT=8787
CORS_ORIGIN=*

# Option A
# DATABASE_URL=postgresql://DB_USER:DB_PASSWORD@DB_HOST:5432/admin

# Option B
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=admin
DB_USER=postgres
DB_PASSWORD=change_me
DB_SSL=false
```

For your current public DB host setup, you may temporarily use:

```env
DB_HOST=168.144.107.107
DB_PORT=5432
DB_NAME=admin
DB_USER=<your_user>
DB_PASSWORD=<your_password>
```

Recommended production hardening:

- Keep DB private (localhost/private VPC binding)
- Restrict port `5432` with firewall
- Use strong DB user password and rotate periodically

## Database schema setup

Run schema:

```bash
psql -h <db-host> -p 5432 -U <db-user> -d admin -f server/schema.sql
```

Run seed data:

```bash
psql -h <db-host> -p 5432 -U <db-user> -d admin -f server/seed.sql
```

## API endpoints implemented

Base prefix: `/api/v1`

- `GET /health`
  - checks DB connection using `SELECT 1`
- `GET /announcements`
  - returns active announcements for announcements page
- `GET /lost-found/items`
  - returns active lost-and-found items for lost-and-found page
- `POST /lost-found/claims`
  - saves claim requests to `lost_found_claims`

## Frontend data behavior

### Announcements page

`public/announcements` now:

1. loads existing local data
2. tries API fetch (`OSAApiClient.loadAnnouncements()`)
3. if API succeeds and has rows, uses DB data
4. if API fails, uses existing local/fallback data

### Lost & Found page

`public/lost-and-found` now:

1. loads existing local data
2. tries API fetch (`OSAApiClient.loadLostFoundItems()`)
3. if API succeeds and has rows, uses DB data
4. if API fails, uses existing local/fallback data

This keeps pages functional during backend rollout.

## Run instructions

Install dependencies:

```bash
npm install
```

Start API:

```bash
npm run api:start
```

Expected startup log:

```txt
OSA API running on http://localhost:8787/api/v1
```

Quick health test:

```bash
curl http://127.0.0.1:8787/api/v1/health
```

## Deployment notes for DigitalOcean droplet

- Run API with process manager (pm2/systemd)
- Put API behind Nginx reverse proxy (HTTPS)
- Set `CORS_ORIGIN` to your real frontend domain only
- Do not expose DB credentials in frontend code or repository

## Rollback guide

If needed, rollback to frontend-only behavior:

1. remove `osa-api-client.js` script include from both pages
2. remove hydrate function calls in both pages
3. keep local storage/static arrays only
4. optional: revert `sw.js` cache version and precache entry

