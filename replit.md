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

## Home page extended sections (`public/preview.html`)
The home page has 4 extra text-only bands (no icons, same maroon/gold aesthetic):
`#glance` (by-the-numbers strip), `#how-it-works` (4-step numbered flow),
`#faq` (6 FAQ cards in 2-col grid + Ask OSA CTA), and `#where`
(office hours table + contact rows). Layout uses `.home-extra-surface` +
modifier classes (`.glance-surface`, `.flow-surface`, `.faq-surface`,
`.where-surface`). Reveal-on-scroll is wired through a single
IntersectionObserver against `.home-extra-reveal` containers (no extra deps).
The `#hours-now-pill` shows a live "Open now · closes in …" or
"Closed now · opens …" status using `Intl.DateTimeFormat` with
`timeZone: "Asia/Manila"`; the matching weekday row gets `.is-today`
highlighting. Hours are 8 AM – 5 PM Mon–Fri.

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

## Ticket status lifecycle (in_progress / resolved / cancelled)
`in_progress` is reserved for tickets whose student is **actively online** in
the chat. The instant the student leaves the live session — explicit "End
Session", session expiry, or no SSE + idle past `ORPHAN_TICKET_DEAD_AIR_MS` —
`cancelOrphanedTickets()` in `server/chat.js` closes every open/in_progress
ticket attached to that session:
- `appointment_status = 'approved'` → `status = 'resolved'`
  (`resolution_reason = 'approved_<reason>'`)
- otherwise → `status = 'cancelled'` (`cancelled_reason = <reason>`)

`sweepDeadAirTickets()` runs every 30 s and applies the same rule to
**both** `open` and `in_progress` tickets when the student goes offline, so
approved appointments no longer dangle in `in_progress` after the student
disconnects. Manual staff actions (`/approve-appointment`,
`/schedule-appointment`, `/staff-message`, `/resolve`) are unchanged — they
only set `in_progress` while the live conversation is happening.

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

## Shared Admin Page Hero (`.page-header`)
Every admin module page (except chat-support, which is full-bleed) renders the
same hero board defined in `public/admin/admin-shell.css`: maroon 4-stop
diagonal gradient, EAC photo backdrop at low opacity, gold radial top-right
glow, `pageHeroIn` slide-in animation, and a serif h1 — visually matching the
dashboard `.welcome-banner`. Markup contract:
```
<div class="page-header" [data-accent="gold"]>
  <div class="page-header__main">eyebrow + h1 + p + .page-header__actions</div>
  <div class="page-header__widget">status + kicker + meta</div>
</div>
```
Lost & Found uses `data-accent="gold"` for an extra-large gold radial and a
gold-tinted widget — its "hint of uniqueness" relative to Announcements while
keeping the same brand theme. Hero widget stat IDs (`hero-stat-pub`,
`hero-stat-unclaimed`, `hero-stat-chunks`, `hero-stat-msgs`) are populated by
each page's existing data load to give per-page live status.

## Chat Logs deletion (`/admin/modules/chat-logs`)
Both data sources are deletable from the UI and via REST. Backend
(`server/admin/chatLogRoutes.js`):
- `DELETE /api/v1/admin/chat/logs?id=<n>` — single OTP message row
- `DELETE /api/v1/admin/chat/logs?session_id=<uuid>` — every message in a session
- `DELETE /api/v1/admin/chat/logs/guest?id=<n>` — single guest memory row
- `DELETE /api/v1/admin/chat/logs/guest?conversation_id=<id>` — whole guest conversation

Auth uses the same `requireAdminAuth` (`x-admin-key: ADMIN_KEY` or admin JWT)
as the GET endpoints. The page UI adds: a per-row trash button, a
"Delete this session/conversation" bulk button (enabled only when the Session/
Conversation ID filter is filled), and a "Delete shown rows" iterator. Cache
bust is pinned at `?v=20260424b` for `admin-shell.css` and `admin-shell.js`.

## Chat pipeline short-circuits (`server/chatbot/services/chatPipeline.js`)
The guest widget posts to `/api/v1/chatbot/message` → `runChatPipeline()`.
Two deterministic short-circuits run BEFORE cache, RAG, and LLM so they
return `escalate: false` (no "Verify email & escalate" card) and never
hallucinate:

1. **Date/time** (`looksLikeDateTimeQuery` + `formatPhDateTime` +
   `buildDateTimeReply`) — handles "date today", "what time is it", "anong
   oras na", "petsa ngayon", apostrophes/punctuation, Tagalog single-words,
   while suppressing "office hours" / "what are your hours".

2. **Official forms / Student Manual links** (`OFFICIAL_FORMS` +
   `looksLikeFormsLinkQuery` + `buildFormsLinkReply`) — answers "student
   manual link", "scholarship form", "give me all the forms", "saan po yung
   scholarship form", "lahat ng forms", etc. with the real URLs from the
   home-page "Student Manual and Forms" block. The same list is appended
   to the live context (`buildOfficialFormsContextBlock`) and the system
   prompt explicitly allows the LLM to cite those URLs verbatim, so even
   non-short-circuited multi-topic questions get correct links.
   **Keep `OFFICIAL_FORMS` in sync with `public/preview.html` and
   `public/index.html` (manual-highlight + manual-forms-grid).**
