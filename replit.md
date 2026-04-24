# OSA Transaction Guide Portal

## Overview
Student-affairs portal for EAC. Plain HTML/CSS/JS frontend in `public/` paired with an Express API in `server/` (Node.js 20). Includes a chat widget with FAQ + RAG (PostgreSQL + pgvector), realtime via Socket.io, and an admin shell. A WIP React/Vite migration lives in `frontend/` but is not used at runtime.

## Architecture
- **Single Node process** (`server/index.js`) serves:
  - Static portal from `public/` (mapped via the static + extensionless-HTML middleware)
  - REST API under `/api/v1/*`
  - Socket.io realtime under `/ws/chat`
- **Database**: Replit-managed PostgreSQL (uses `DATABASE_URL`). Schema in `server/schema.sql` + `server/migration/ensureV2Schema.js` (adds `pgvector`, auth, conversations, tickets, etc.). Seed data in `server/seed.sql`.
- **Optional services**: Gemini / Groq / OpenRouter / HuggingFace for chatbot tiers — not required for the portal to run.

## Replit Setup
- Workflow `Start application` runs `API_PORT=5000 HOST=0.0.0.0 npm run api:start` on port 5000 (webview).
- DB schema + seed already applied via `npm run db:setup`.
- Express has no host check, so the Replit iframe proxy works out of the box.

## Useful Scripts
- `npm run api:start` — start the API + static portal
- `npm run db:setup` — apply `server/schema.sql` and `server/seed.sql`
- `npm run rag:seed` / `rag:reembed` — populate RAG chunks (needs `GEMINI_API_KEY`)
- `npm run minify` — emit minified CSS/JS into `public/`

## Notes
- `serve.js` (port 8001) is a legacy standalone static server kept for reference; not used by the workflow.
- The React workspace under `frontend/` is independent and not wired into the running app.
