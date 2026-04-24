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

## Real-time chat presence (typing + seen receipts)
Both the student widget and the staff portal exchange typing and seen receipts
through the existing SSE infrastructure (no WebSocket layer). Endpoints in
`server/chat.js`:
- `POST /api/v1/chat/typing` — student → admin SSE (fans out `student_typing` / `student_typing_stop`)
- `POST /api/v1/chat/seen` — student → admin SSE (`student_seen`)
- `POST /api/v1/chat/tickets/:caseId/staff-typing` (admin auth) — staff → per-session SSE (`staff_typing` / `staff_typing_stop`)
- `POST /api/v1/chat/tickets/:caseId/staff-seen` (admin auth) — staff → per-session SSE (`staff_seen`)

Per-message status (queued → sent → delivered → seen) is rendered as small
checkmarks under user bubbles in `public/assets/js/osa-chat-widget.js` and
persisted in the `osaChatThread` localStorage record. Cache-bust pins:
loader `v=70`, widget `v=75`, `osa-ai.css?v=46`, island css `v=18`.

## Visit Status (4-stage timeline)
After OSA approves an appointment, the widget renders an in-thread "Visit Status"
card with four steps: Submitted → Scheduled → Waiting at OSA → Completed.
The card is updated in place from `visit_status` SSE events keyed by `case_id`.

- Schema: `escalation_tickets.arrived_at`, `visit_completed_at` (see
  `server/migration/ensureV2Schema.js`) plus a partial index for the live queue.
- Endpoints (in `server/chat.js`):
  - `POST /api/v1/chat/visit/arrive` — student taps "I'm here / Waiting at OSA"
    on the timeline card; sets `arrived_at` and broadcasts queue positions.
  - `GET  /api/v1/chat/visit/status?case_id=…` — returns `visit_state`,
    `queue_position`, `queue_total`; used on widget reload.
  - `POST /api/v1/chat/tickets/:caseId/complete-visit` (admin) — sets
    `visit_completed_at`, advances the timeline to "Completed", and re-broadcasts
    queue numbers so remaining waiters move up.
- Admin UI (`public/admin/modules/chat-support.html`): new "Waiting at OSA"
  status tab, purple `waiting · #N` badge, "Arrived HH:MM · Queue #N of M" row
  on the ticket card, and a "Mark Visit Completed" topbar button visible only
  while `arrived_at && !visit_completed_at`.

## Admin Chat Support page (`/admin/modules/chat-support`)
Full-bleed, mobile-first redesign lives in the inline `<style>` block of
`public/admin/modules/chat-support.html`. The standard `.page-header` is
hidden inside this module (`.admin-main--chat-support > .page-header { display: none; }`)
so the two-pane layout (`.chat-support-wrap`) fills `calc(100dvh - var(--shell-top))`.
JS hooks (IDs and class names like `.ticket-item`, `.cmsg`, `.convo-topbar`,
`.btn-resolve`, `.btn-send-staff`, etc.) are unchanged — only visual styles,
spacing, touch targets, and breakpoints were updated. Modal becomes a
bottom-sheet on phones (≤ 560px), composer respects `env(safe-area-inset-bottom)`.
