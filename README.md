# OSA Transaction Guide Portal

A student affairs web portal for **Emilio Aguinaldo College (EAC) Cavite**, built and maintained by the Office of Student Affairs (OSA). The portal provides students with self-service access to announcements, lost and found items, appointment booking, and an AI-powered chatbot — all backed by a Node.js/Express REST API and a PostgreSQL database.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Features](#features)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Local Setup](#local-setup)
  - [Replit Setup](#replit-setup)
- [Environment Variables](#environment-variables)
- [NPM Scripts](#npm-scripts)
- [API Overview](#api-overview)
- [Chatbot Pipeline](#chatbot-pipeline)
- [Real-Time Chat](#real-time-chat)
- [Ticket Lifecycle](#ticket-lifecycle)
- [Visit Status Timeline](#visit-status-timeline)
- [Admin Panel](#admin-panel)
- [Docker & Deployment](#docker--deployment)
- [Notes](#notes)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 (LTS) |
| Framework | Express.js |
| Database | PostgreSQL with `pgvector` extension |
| Real-time | Socket.io (namespace `/ws/chat`) |
| AI / LLM | Google Gemini (primary), Groq (fallback), OpenRouter, HuggingFace |
| Embeddings | Gemini Embedding API (`gemini-embedding-001`, 768 dims) |
| Auth | JWT + OTP via Brevo email |
| Frontend | Plain HTML / CSS / JavaScript (no framework runtime) |
| Containerization | Docker (Alpine-based, optimized for Render free tier) |

---

## Architecture

The entire application runs as a **single Node.js process** (`server/index.js`) that serves three responsibilities:

1. **Static portal** — Express serves `public/` (HTML, CSS, JS) with extensionless-HTML middleware, so URLs like `/announcements` map to `public/announcements/index.html`.
2. **REST API** — All endpoints are under `/api/v1/*`.
3. **Socket.io realtime** — Bi-directional events on `/ws/chat` for typing indicators, seen receipts, and live chat presence.

```
Browser
  │
  ├── GET /*, /announcements, /lost-and-found …  → Express static (public/)
  ├── /api/v1/*                                  → Express REST handlers
  └── /ws/chat                                   → Socket.io
           │
           ├── server/chat.js           (secure student chat, SSE, tickets)
           ├── server/chatbot/          (guest AI widget pipeline)
           ├── server/auth/             (OTP + JWT auth)
           ├── server/admin/            (admin-only routes)
           └── server/services/         (Gemini key pool, embeddings)
                    │
                    └── PostgreSQL + pgvector
```

---

## Features

### Student-Facing
- **Announcements** — browse active announcements by category and urgency.
- **Lost & Found** — browse, search, and claim found items; item status tracked live.
- **Appointment Booking** — submit a request, receive OTP-verified secure chat, track the visit status timeline (Submitted → Scheduled → Waiting at OSA → Completed).
- **Guest AI Chatbot** — ask about OSA services, Student Manual policies, forms, office hours, and more — powered by RAG (semantic search over a curated knowledge base) with Gemini/Groq fallback.
- **Secure Chat (OTP)** — after email OTP verification, students get a private threaded conversation with OSA staff.

### Admin-Facing
- Dashboard with live stats.
- Manage announcements and lost & found items.
- Chat support panel (two-pane, mobile-first layout) with live typing indicators, seen receipts, and a visit queue.
- RAG knowledge base management (chunk upload, re-embedding, search debug).
- Chat log viewer with session and guest conversation deletion.

---

## Project Structure

```
.
├── public/                          # Static frontend (served directly by Express)
│   ├── index.html                   # Redirects to preview.html
│   ├── preview.html                 # Main portal home page
│   ├── announcements/
│   ├── lost-and-found/
│   ├── appointments/
│   ├── about-portal/
│   ├── admin/                       # Admin panel (HTML modules + shell)
│   ├── css/
│   │   ├── osa-design.css           # Global design system (navbar, footer, layout)
│   │   └── osa-ai.css               # Chat widget styles
│   └── assets/
│       ├── js/                      # Chat widget, loader, admin shell JS
│       └── images/                  # EAC emblem, photos, manual cover
│
├── server/                          # Node.js / Express backend
│   ├── index.js                     # App entry point, middleware, route registration
│   ├── chat.js                      # Secure student chat, SSE, ticket management
│   ├── otp.js                       # OTP generation, hashing, email delivery (Brevo)
│   ├── db.js                        # PostgreSQL connection pool (pg)
│   ├── faqSearch.js                 # Keyword-based FAQ search
│   ├── schema.sql                   # Base schema (applied on first run)
│   ├── seed.sql                     # Seed data (OSA services, FAQs, etc.)
│   ├── auth/
│   │   ├── jwt.js                   # JWT sign / verify utilities
│   │   └── routes.js                # /auth/login, /auth/me
│   ├── admin/
│   │   ├── chatLogRoutes.js         # Chat log viewing and deletion
│   │   └── ragRoutes.js             # RAG chunk CRUD and re-embedding
│   ├── chatbot/
│   │   ├── index.js                 # Chatbot subsystem bootstrap
│   │   ├── routes/chatbotRoutes.js  # POST /chatbot/message, GET /chatbot/quota
│   │   ├── services/
│   │   │   ├── chatPipeline.js      # Main orchestration (RAG → LLM → cache)
│   │   │   ├── ragService.js        # pgvector semantic search + augmentation
│   │   │   ├── embeddingService.js  # Gemini Embedding API wrapper
│   │   │   └── providers.js         # Gemini, Groq, OpenRouter, HuggingFace calls
│   │   ├── router/smartRouter.js    # Provider selection (Gemini → Groq fallback)
│   │   ├── cache/postgresCache.js   # LLM response cache (PostgreSQL-backed)
│   │   ├── memory/postgresMemory.js # Per-conversation short-term memory
│   │   ├── utils/
│   │   │   ├── preprocessor.js      # Input cleaning + intent classification
│   │   │   ├── responseCleaner.js   # LLM output post-processing
│   │   │   ├── portalPageContext.js  # Portal page → chatbot context mapper
│   │   │   └── hash.js              # MD5 cache key utility
│   │   └── data/                    # Static knowledge base chunks (JSON/JS)
│   ├── services/
│   │   └── geminiKeyPool.js         # Multi-key Gemini pool with rate-limit failover
│   ├── middleware/
│   │   └── dailyQuota.js            # Per-IP message quota (guest vs. verified)
│   ├── migration/
│   │   └── ensureV2Schema.js        # DB migration (pgvector, auth tables, indexes)
│   └── socket/
│       └── chatRealtime.js          # Socket.io event handlers
│
├── Dockerfile                       # Production image (node:20-alpine, Render-ready)
├── docker-entrypoint.sh             # Runs schema+seed then starts server
├── package.json
└── .env                             # Local env vars (not committed)
```

---

## Getting Started

### Prerequisites

- **Node.js 20+**
- **PostgreSQL** with the `pgvector` extension (or use the Replit-managed database)
- A **Gemini API key** (required for the AI chatbot and RAG embeddings)
- A **Brevo account** (required for OTP email delivery)

### Local Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in the environment file
cp .env.example .env   # edit values as needed

# 3. Apply the database schema and seed data
npm run db:setup

# 4. (Optional) Seed the RAG knowledge base — requires GEMINI_API_KEY
npm run rag:seed

# 5. Start the API + portal
npm run api:start
```

The portal is available at `http://localhost:5000` and the API base is `http://localhost:5000/api/v1`.

### Replit Setup

The project runs on Replit out of the box. The workflow **"Start application"** runs:

```
API_PORT=5000 HOST=0.0.0.0 npm run api:start
```

The Replit-managed PostgreSQL database is automatically connected via `DATABASE_URL`. Schema and seed are applied on first deploy via `docker-entrypoint.sh`, or you can run them manually:

```bash
npm run db:setup
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `GEMINI_API_KEY` | Yes* | Primary Gemini API key (\*required for chatbot) |
| `GEMINI_API_KEY2` … `GEMINI_API_KEY9` | No | Additional Gemini keys for key-pool rotation |
| `GEMINI_API_KEYS` | No | Comma-separated extra Gemini keys |
| `GROQ_API_KEY` | No | Groq fallback LLM key |
| `OPENROUTER_API_KEY` | No | OpenRouter fallback key |
| `HUGGINGFACE_API_KEY` | No | HuggingFace fallback key |
| `JWT_SECRET` | Yes | Secret for signing student/admin JWTs |
| `ADMIN_KEY` | Yes | Static key for admin API access |
| `OTP_PEPPER` | Yes | HMAC pepper for OTP hashing |
| `Brevo_API_KEY` | Yes | Brevo (Sendinblue) API key for OTP emails |
| `OTP_TEST_BYPASS_EMAILS` | No | Comma-separated emails that skip OTP rate limits (dev/test) |
| `OTP_TEST_CODE` | No | Fixed OTP code accepted for bypass emails (dev/test) |
| `GEMINI_MODEL` | No | Gemini model name (default: `gemini-2.5-flash`) |
| `GROQ_MODEL` | No | Groq model name (default: `qwen/qwen3-32b`) |
| `CHATBOT_MAX_OUTPUT_TOKENS` | No | Max tokens per LLM reply (default: `2048`) |
| `CHATBOT_TEMPERATURE` | No | LLM temperature (default: `0.3`) |
| `CHATBOT_RAG_MIN_CONFIDENCE` | No | Min RAG confidence for LLM context use (default: `0.52`) |
| `CHATBOT_CACHE_TTL_SECONDS` | No | Response cache TTL in seconds (default: `21600`) |
| `CHATBOT_MEMORY_TURNS` | No | Conversation memory depth in turns (default: `10`) |
| `CHATBOT_DEBUG` | No | Set `true` to enable verbose chatbot pipeline logs |
| `RAG_TOP_K` | No | Max RAG chunks returned (default: `5`) |
| `RAG_THRESHOLD` | No | Cosine similarity floor for chunk inclusion (default: `0.55`) |
| `RAG_QUALITY_GATE` | No | Top-chunk quality gate for grounding (default: `0.70`) |
| `DISABLE_RATE_LIMITS` | No | Set `true` to disable all rate limiters |
| `DISABLE_RATE_LIMITS_LOCAL` | No | Set `true` to skip rate limits for localhost requests (default: `true`) |
| `API_PORT` | No | Server port (default: `5000`) |
| `HOST` | No | Bind address (default: `0.0.0.0`) |

---

## NPM Scripts

| Script | Description |
|---|---|
| `npm run api:start` | Start the API server + static portal |
| `npm run db:setup` | Apply `server/schema.sql` and `server/seed.sql` |
| `npm run rag:seed` | Embed and insert static knowledge base chunks into PostgreSQL |
| `npm run rag:reembed` | Re-generate all RAG embeddings (run after chunk edits) |
| `npm run minify` | Emit minified `*.min.css` and `*.min.js` into `public/` for production |

---

## API Overview

All endpoints are prefixed with `/api/v1`.

### Public

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check (`{"ok":true,"db":"connected"}`) |
| `GET` | `/announcements` | List active announcements |
| `GET` | `/lost-found` | List active lost & found items |
| `POST` | `/auth/otp/send` | Send OTP to a campus email |
| `POST` | `/auth/otp/verify` | Verify OTP and issue a chat token |
| `POST` | `/chatbot/message` | Guest chatbot message |
| `GET` | `/chatbot/quota` | Guest quota status |

### Student (JWT required)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/chat/session` | Create a secure chat session |
| `GET` | `/chat/session/:id/events` | SSE stream for chat events |
| `POST` | `/chat/message` | Send a message in a secure session |
| `POST` | `/chat/typing` | Signal typing start/stop to staff |
| `POST` | `/chat/seen` | Mark staff messages as seen |
| `GET` | `/chat/visit/status` | Get visit queue position |
| `POST` | `/chat/visit/arrive` | Signal arrival at the OSA office |

### Admin (`x-admin-key` or admin JWT required)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/admin/system-info` | Server and DB diagnostics |
| `GET/POST/PUT/DELETE` | `/admin/announcements` | Manage announcements |
| `GET/POST/PUT/DELETE` | `/admin/lost-found` | Manage lost & found items |
| `GET/DELETE` | `/admin/chat/logs` | View and delete chat logs |
| `GET/POST/DELETE` | `/admin/rag/chunks` | Manage RAG knowledge base |
| `POST` | `/admin/rag/reembed` | Re-generate RAG embeddings |
| `POST` | `/chat/tickets/:id/staff-message` | Send a staff reply |
| `POST` | `/chat/tickets/:id/approve-appointment` | Approve an appointment ticket |
| `POST` | `/chat/tickets/:id/complete-visit` | Mark a student's visit complete |

---

## Chatbot Pipeline

The guest widget posts to `POST /api/v1/chatbot/message` → `runChatPipeline()`.

The pipeline executes in strict order:

1. **Short-circuits** — date/time queries and official forms/links requests return deterministic answers immediately, bypassing cache, RAG, and the LLM entirely.
2. **Domain quick-replies** — patterned intent matches (live staff requests, appointment flow) return structured responses with optional escalation prompts.
3. **Cache check** — if the cleaned query has a cached LLM response (PostgreSQL-backed, default 6-hour TTL), serve it directly.
4. **Live context** — announcements, lost & found registry, and services catalog are fetched from the DB and appended to the prompt.
5. **RAG retrieval** — the query is embedded via Gemini Embedding API and run against `pgvector` (cosine similarity, HNSW index). Top-K chunks above the confidence threshold are used to ground the LLM prompt.
6. **LLM generation** — Gemini (primary) with automatic key-pool rotation on rate limits; Groq as emergency fallback if all Gemini keys are exhausted.
7. **Response cleaning** — `<think>` tags, localhost URLs, internal tooling references, and prompt-scaffold leaks are stripped before the reply reaches the student.
8. **Cache + memory write** — the response is stored in the response cache and appended to the conversation memory.

Set `CHATBOT_DEBUG=true` to enable verbose per-request pipeline logs.

---

## Real-Time Chat

Typing indicators and seen receipts flow through the existing **SSE infrastructure** (no extra WebSocket layer is needed). The relevant endpoints in `server/chat.js` are:

| Method | Endpoint | Direction | Event emitted |
|---|---|---|---|
| `POST` | `/chat/typing` | Student → Staff SSE | `student_typing` / `student_typing_stop` |
| `POST` | `/chat/seen` | Student → Staff SSE | `student_seen` |
| `POST` | `/chat/tickets/:id/staff-typing` | Staff → Student SSE | `staff_typing` / `staff_typing_stop` |
| `POST` | `/chat/tickets/:id/staff-seen` | Staff → Student SSE | `staff_seen` |

Per-message delivery status (`queued → sent → delivered → seen`) is rendered as small checkmarks under each message bubble in the chat widget.

---

## Ticket Lifecycle

Tickets move through: `open` → `in_progress` → `resolved` / `cancelled`.

- `in_progress` is reserved for tickets where the student is **actively connected** in the chat session.
- When the student disconnects (explicit session end, session expiry, or idle past `ORPHAN_TICKET_DEAD_AIR_MS`), `cancelOrphanedTickets()` immediately closes all open/in-progress tickets for that session.
- `sweepDeadAirTickets()` runs every 30 seconds to catch any remaining dangling tickets from students who went offline without closing their session.
- Tickets with `appointment_status = 'approved'` are resolved as `resolved` (with `resolution_reason = 'approved_<reason>'`); all others are resolved as `cancelled`.

---

## Visit Status Timeline

After an appointment is approved, the student's chat widget shows a live **Visit Status** card with four stages:

**Submitted → Scheduled → Waiting at OSA → Completed**

| Endpoint | Actor | Action |
|---|---|---|
| `POST /chat/visit/arrive` | Student | Taps "I'm here" on the timeline; sets `arrived_at`, broadcasts queue positions |
| `GET /chat/visit/status?case_id=…` | Student | Returns `visit_state`, `queue_position`, `queue_total` |
| `POST /chat/tickets/:id/complete-visit` | Admin | Sets `visit_completed_at`, advances timeline to "Completed", re-broadcasts queue |

The admin panel shows a dedicated **"Waiting at OSA"** status tab, a purple `waiting · #N` badge on each relevant ticket, and a "Mark Visit Completed" button that appears only when a student has arrived but not yet been seen.

---

## Admin Panel

The admin panel lives at `/admin/` and is protected by `ADMIN_KEY` or an admin JWT.

Key modules:

| Module | Path | Description |
|---|---|---|
| Dashboard | `/admin/` | Live stats and system overview |
| Announcements | `/admin/modules/announcements` | CRUD for portal announcements |
| Lost & Found | `/admin/modules/lost-and-found` | CRUD and status management for items |
| Chat Support | `/admin/modules/chat-support` | Two-pane live chat interface with full ticket management |
| Chat Logs | `/admin/modules/chat-logs` | View, filter, and delete OTP session logs and guest conversations |
| RAG Manager | `/admin/modules/rag` | Upload and re-embed knowledge base chunks |

The chat support panel is full-bleed and mobile-first. Every other admin module uses the shared `.page-header` hero (maroon diagonal gradient, EAC photo backdrop, serif h1) defined in `admin-shell.css`.

---

## Docker & Deployment

A production-ready `Dockerfile` is included, optimized for the **Render free tier**:

- Base image: `node:20-alpine`
- Dependencies installed with `npm ci --omit=dev --no-audit --no-fund`
- Health check at `GET /api/v1/health`
- `docker-entrypoint.sh` runs schema + seed migrations before starting the server

### Build and run locally

```bash
docker build -t osa-portal .
docker run -p 5000:5000 --env-file .env osa-portal
```

### Deploy to Render

1. Push to your GitHub/GitLab repository.
2. Create a new **Web Service** on Render pointing at the repository.
3. Set the environment variables listed in [Environment Variables](#environment-variables).
4. Render will detect the `Dockerfile` and build automatically.

The server binds to `0.0.0.0:5000` by default — set `API_PORT` and `HOST` in your Render environment if needed.

---

## Notes

- The React/Vite workspace under `frontend/` is a **work in progress** and is not served at runtime. It runs independently via `npm run dev` inside `frontend/`.
- `serve.js` (port 8001) is a legacy standalone static server kept for reference; the workflow does not use it.
- The Gemini key pool supports up to 9 keys via `GEMINI_API_KEY`, `GEMINI_API_KEY2` through `GEMINI_API_KEY9`, or a comma-separated `GEMINI_API_KEYS` list. Keys are rotated automatically when rate limits are hit.
- `OFFICIAL_FORMS` in `server/chatbot/services/chatPipeline.js` must be kept in sync with the "Student Manual and Forms" block in `public/preview.html` and `public/index.html`.
- Optional asset minification: run `npm run minify` to emit `*.min.css` / `*.min.js` alongside sources. The chat loader auto-detects `.min.js` when the script URL contains that suffix.
