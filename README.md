# OSA Transaction Guide Portal

A student affairs web portal for **Emilio Aguinaldo College (EAC) Cavite**, built and maintained by the Office of Student Affairs (OSA). The portal gives students self-service access to announcements, lost and found items, appointment booking, and an AI-powered chatbot — all backed by a Node.js/Express REST API and a PostgreSQL database with pgvector for semantic search.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Features](#features)
- [Frontend](#frontend)
- [Backend](#backend)
- [RAG System](#rag-system)
- [Chatbot Pipeline](#chatbot-pipeline)
- [Auth & OTP System](#auth--otp-system)
- [Real-Time Chat](#real-time-chat)
- [Ticket & Visit Lifecycle](#ticket--visit-lifecycle)
- [Admin Panel](#admin-panel)
- [Database Schema](#database-schema)
- [Getting Started](#getting-started)
- [NPM Scripts](#npm-scripts)
- [API Overview](#api-overview)
- [Docker & Deployment](#docker--deployment)
- [Notes](#notes)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 (LTS) |
| Web Framework | Express.js 5 |
| Database | PostgreSQL + `pgvector` extension |
| ORM | Prisma 6 (schema management) |
| Real-time | Socket.io 4 (namespace `/ws/chat`) |
| AI — LLM (primary) | Google Gemini API (`gemini-2.5-flash`) via `@google/genai` |
| AI — LLM (fallback) | Groq (`qwen/qwen3-32b`) via OpenAI-compatible API |
| AI — Embeddings | Gemini Embedding API (`gemini-embedding-001`, 768 dimensions) |
| Vector Search | pgvector (HNSW index, cosine similarity) |
| Auth | JWT (`jsonwebtoken`) + email-based OTP verification |
| Password Hashing | bcryptjs |
| Frontend (portal) | Vanilla HTML / CSS / JavaScript (no framework, served statically) |
| Frontend (in-progress) | React 19 + Vite 8 + Tailwind CSS 4 |
| Containerization | Docker (node:20-alpine) |

---

## Architecture

The entire application runs as a **single Node.js process** (`server/index.js`) serving three responsibilities simultaneously:

1. **Static portal** — Express serves `public/` with extensionless-HTML middleware, so `/announcements` maps to `public/announcements/index.html`.
2. **REST API** — All API endpoints are under `/api/v1/*`.
3. **Socket.io realtime** — Bidirectional events on the `/ws/chat` namespace handle typing indicators, seen receipts, and live chat presence.

```
Browser
  │
  ├── GET /*, /announcements, /lost-and-found …  → Express static (public/)
  ├── POST/GET /api/v1/*                          → Express REST handlers
  └── /ws/chat                                    → Socket.io
           │
           ├── server/chat.js            (secure student chat, SSE, tickets, appointments)
           ├── server/chatbot/           (guest AI widget — RAG pipeline)
           ├── server/auth/              (OTP + JWT registration and login)
           ├── server/admin/             (admin-only routes)
           └── server/services/          (Gemini key pool, embeddings)
                    │
                    └── PostgreSQL + pgvector (Supabase-hosted or self-hosted)
```

---

## Project Structure

```
.
├── public/                          # Static frontend (served by Express)
│   ├── index.html                   # Redirects to preview.html
│   ├── preview.html                 # Main portal home page
│   ├── announcements/index.html     # Announcements browsing page
│   ├── lost-and-found/index.html    # Lost & found browsing page
│   ├── about-portal/index.html      # About the portal
│   ├── admin/                       # Admin panel (HTML shell + JS modules)
│   │   ├── admin-shell.js           # Single-page admin shell (tab routing, auth)
│   │   ├── admin-shell.css          # Admin global styles
│   │   └── modules/                 # Per-module HTML, JS, and CSS
│   │       ├── announcements/
│   │       ├── lost-found/
│   │       ├── chat-support/
│   │       ├── chat-logs/
│   │       ├── home-content/
│   │       └── about/
│   ├── css/
│   │   ├── osa-design.css           # Global design system (navbar, footer, cards)
│   │   └── osa-ai.css               # Chat widget styles
│   └── assets/
│       ├── js/                      # Chat widget loader, API client, admin shell JS
│       └── images/                  # EAC emblem, campus photos, manual cover
│
├── server/                          # Node.js / Express backend
│   ├── index.js                     # App entry point — middleware, route registration, startup
│   ├── chat.js                      # Secure student chat, SSE event stream, tickets, appointments
│   ├── otp.js                       # OTP generation, HMAC hashing, transactional email delivery
│   ├── db.js                        # PostgreSQL connection pool (pg driver)
│   ├── faqSearch.js                 # Keyword-based FAQ matching (tier 1 fallback)
│   ├── schema.sql                   # Base SQL schema
│   ├── seed.sql                     # Initial seed data (OSA services, FAQs)
│   ├── auth/
│   │   ├── jwt.js                   # signAuthToken / verifyAuthToken utilities
│   │   └── routes.js                # POST /auth/register, /auth/login, GET /auth/me
│   ├── admin/
│   │   ├── chatLogRoutes.js         # GET/DELETE chat session and guest conversation logs
│   │   └── ragRoutes.js             # CRUD RAG chunks, trigger re-embedding
│   ├── chatbot/
│   │   ├── routes/chatbotRoutes.js  # POST /chatbot/message, GET /chatbot/quota
│   │   ├── services/
│   │   │   ├── chatPipeline.js      # Main orchestrator (cache → RAG → LLM → clean → store)
│   │   │   ├── ragService.js        # pgvector semantic search, chunk ranking, augmentation
│   │   │   ├── embeddingService.js  # Gemini Embedding API wrapper (batched, validated)
│   │   │   └── providers.js         # Gemini, Groq, OpenRouter, HuggingFace API calls
│   │   ├── router/smartRouter.js    # Provider chain builder (Gemini → Groq failover)
│   │   ├── cache/postgresCache.js   # PostgreSQL-backed LLM response cache (TTL, hit count)
│   │   ├── memory/postgresMemory.js # Per-conversation short-term memory (PostgreSQL)
│   │   ├── utils/
│   │   │   ├── preprocessor.js      # Input cleaning, intent classification (otp/appointment/general)
│   │   │   ├── responseCleaner.js   # Strip <think> tags, localhost URLs, scaffold leaks
│   │   │   ├── portalPageContext.js  # Maps portal page → relevant chatbot context hint
│   │   │   └── hash.js              # MD5 cache key generator
│   │   ├── data/                    # Static knowledge base chunks loaded at RAG seed time
│   │   │   ├── eac_manual_chunks.json
│   │   │   ├── eac_manual_chunks_extra.json
│   │   │   ├── eac_manual_chunks_detailed.js
│   │   │   └── system_chunks.json
│   │   └── seed/
│   │       ├── seedRagChunks.js     # Embeds static chunks and upserts into rag_chunks table
│   │       └── seedFaq.js           # Seeds curated FAQ entries
│   ├── services/
│   │   └── geminiKeyPool.js         # Multi-key Gemini pool; rotates on 429/503/502 errors
│   ├── middleware/
│   │   └── dailyQuota.js            # Per-IP daily message quota (guests: 20/day, students: 50/day)
│   ├── migration/
│   │   └── ensureV2Schema.js        # Creates all tables, enums, indexes, and pgvector on startup
│   └── socket/
│       └── chatRealtime.js          # Socket.io event handlers (join, message, reply)
│
├── frontend/                        # React 19 + Vite (work in progress, not served at runtime)
│   └── src/
│       ├── App.jsx                  # Client-side router (react-router-dom v7)
│       ├── pages/                   # HomePage, AuthPage, ChatPage, StudentPortalPage, AdminPortalPage …
│       ├── layouts/PortalLayout.jsx
│       ├── components/ui/           # Reusable UI primitives (button, etc.)
│       └── lib/                     # api.js (Axios wrapper), socket.js, utils.js
│
├── prisma/schema.prisma             # Prisma schema (used for type generation and migrations)
├── scripts/                         # CLI utility scripts (test-chatbot, recent-chat-log, minify)
├── Dockerfile                       # Production image (node:20-alpine)
├── docker-entrypoint.sh             # Runs db:setup then starts the server
└── package.json
```

---

## Features

### Student-Facing

- **Announcements** — browse active announcements filtered by category and urgency level.
- **Lost & Found** — browse and search found items, submit a claim request, track claim status (Pending / Approved / Rejected).
- **Guest AI Chatbot** — ask about OSA services, Student Manual policies, forms, schedules, and office hours. Powered by a RAG pipeline backed by Gemini embeddings and pgvector semantic search.
- **Secure Chat (OTP-verified)** — students verify their campus email via a 6-digit OTP, then get a private threaded conversation with OSA staff.
- **Appointment Booking** — submit a ticket, track the four-stage visit timeline (Submitted → Scheduled → Waiting at OSA → Completed).

### Admin-Facing

- Dashboard with live system stats.
- Full CRUD for announcements and lost & found items (with image support).
- **Chat Support panel** — two-pane, mobile-first live chat with typing indicators, seen receipts, and a "Waiting at OSA" queue.
- **RAG Manager** — upload knowledge base chunks, trigger re-embedding, search and debug retrieval.
- **Chat Log viewer** — view, filter, and delete OTP session logs and guest chatbot conversations.

---

## Frontend

The portal has two distinct frontends:

### 1. Static HTML Portal (`public/`)

This is the production frontend that Express serves directly. It is plain HTML, CSS, and vanilla JavaScript — no build step required.

- **Global styles** are in `public/css/osa-design.css` (design system: navbar, footer, cards, color tokens) and `osa-ai.css` (chat widget).
- **Chat widget** (`public/assets/js/`) is a self-contained widget loader that opens the guest chatbot or the OTP chat flow depending on the page context.
- **Admin shell** (`public/admin/admin-shell.js`) is a single-page app that handles authentication, tab routing, and lazy-loading of HTML module fragments into a content container.

### 2. React / Vite Workspace (`frontend/`)

A React 19 + Vite 8 + Tailwind CSS 4 workspace currently under active development. It is **not** served in production yet — it runs independently via `npm run dev` inside the `frontend/` directory.

Pages built so far: `HomePage`, `AuthPage`, `ChatPage`, `StudentPortalPage`, `StudentAnnouncementsPage`, `StudentLostFoundPage`, `AdminPortalPage`, `AdminAnnouncementsPage`.

The React app uses `react-router-dom` v7 for client-side routing, Axios for API calls (`lib/api.js`), and Socket.io client (`lib/socket.js`) for real-time chat.

---

## Backend

The backend is a single Express 5 application in `server/index.js`. On startup it:

1. Connects the PostgreSQL pool (`server/db.js`).
2. Runs `ensureV2Schema()` to create any missing tables, enums, extensions, and indexes.
3. Registers all route groups under `/api/v1`.
4. Starts the Socket.io server on `/ws/chat`.
5. Serves `public/` as static files with extensionless-HTML routing.

### Core Modules

| Module | File | Responsibility |
|---|---|---|
| Auth | `auth/routes.js`, `auth/jwt.js` | JWT sign/verify, bcrypt register/login |
| OTP | `otp.js` | 6-digit code generation, HMAC hashing, transactional email delivery, rate limiting |
| Secure Chat | `chat.js` | Student sessions, SSE event streams, tickets, appointments, visit queue |
| Chatbot | `chatbot/` | Guest RAG pipeline (see [RAG System](#rag-system)) |
| Admin | `admin/chatLogRoutes.js`, `admin/ragRoutes.js` | Log management, RAG CRUD |
| Socket.io | `socket/chatRealtime.js` | Real-time events for typing, presence, delivery receipts |
| Key Pool | `services/geminiKeyPool.js` | Rotates up to 9 Gemini API keys on rate-limit errors |
| Daily Quota | `middleware/dailyQuota.js` | Per-IP message caps for guests and verified students |
| Migration | `migration/ensureV2Schema.js` | Idempotent DB schema bootstrap on every startup |

---

## RAG System

The chatbot's knowledge base is powered by a **Retrieval-Augmented Generation (RAG)** pipeline using Google Gemini embeddings and PostgreSQL's `pgvector` extension for vector similarity search.

### Overview

Instead of relying on the LLM's training data to answer EAC-specific questions, the system:

1. Pre-processes and embeds a curated knowledge base (EAC Student Manual, OSA policies, procedures) into 768-dimensional vectors.
2. At query time, embeds the student's question using the same model.
3. Finds the most semantically relevant chunks via cosine similarity in the database.
4. Injects those chunks as grounding context into the LLM prompt.
5. Instructs the LLM to answer **only** from the provided context — never from general training knowledge about EAC.

### Knowledge Base

Static chunks are stored in `server/chatbot/data/`:

| File | Contents |
|---|---|
| `eac_manual_chunks.json` | Core EAC Student Manual sections |
| `eac_manual_chunks_extra.json` | Extended manual content |
| `eac_manual_chunks_detailed.js` | Detailed procedural breakdowns |
| `system_chunks.json` | OSA policies, office procedures, system FAQs |

Each chunk has: `topic`, `article`, `section`, `keywords[]`, `bot_routing`, `content`, `source`, and `token_count`.

After seeding (`npm run rag:seed`), chunks are stored in the `rag_chunks` PostgreSQL table with their embeddings.

### Embedding

`server/chatbot/services/embeddingService.js` wraps the Gemini Embedding API:

- Model: `gemini-embedding-001` (768 dimensions)
- Batched: 10 chunks per batch with a 1-second pause to respect rate limits
- Validates vector shape before inserting
- At query time, the student's message is embedded using the same model to produce a query vector

### Vector Search

`server/chatbot/services/ragService.js` runs the retrieval:

1. **Query embedding** — embed the incoming message via Gemini
2. **pgvector cosine search** — `SELECT ... ORDER BY embedding <=> $queryVector LIMIT $topK`
3. **Threshold filter** — discard chunks with similarity below `RAG_THRESHOLD` (default: 0.55)
4. **Quality gate** — if the top chunk is below `RAG_QUALITY_GATE` (default: 0.70), the context is considered insufficient
5. **Deduplication and ranking** — sort by similarity descending, remove near-duplicates
6. **Token trimming** — combined context is capped at `RAG_MAX_CONTEXT_TOKENS` (default: 1500) to stay within the LLM's prompt budget

The `rag_chunks` table has an **HNSW index** on the `embedding` column for fast approximate nearest-neighbor search.

### Grounding Rules

When RAG context is injected into the system prompt, the LLM is instructed to:

- Answer **only** from the provided context excerpts
- Never invent EAC-specific facts (schedules, fees, room numbers, names) from training data
- If no relevant context is found, respond with: `"No relevant information found in the knowledge base."`
- Note that policies may change per academic year and direct students to OSA for confirmation

### Tunable Parameters

The retrieval layer exposes runtime knobs for top-K, similarity threshold, quality gate, max context tokens, keyword augmentation, and debug logging. Defaults are tuned for the EAC knowledge base (top-K = 5, threshold = 0.55, quality gate = 0.70, max context = 1500 tokens).

### Re-seeding and Re-embedding

```bash
# Seed from scratch (generate embeddings + upsert into DB)
npm run rag:seed

# Re-generate embeddings for all existing chunks (run after editing chunk content)
npm run rag:reembed
```

Admins can also manage chunks through the RAG Manager in the admin panel (`/admin/modules/rag`), which calls `POST/GET/DELETE /api/v1/admin/rag/chunks` and `POST /api/v1/admin/rag/reembed`.

---

## Chatbot Pipeline

Guest messages (`POST /api/v1/chatbot/message`) flow through `runChatPipeline()` in `server/chatbot/services/chatPipeline.js`. Steps execute in strict order — each step can short-circuit and skip the rest.

```
Incoming message
       │
       ▼
1. Short-circuits ──────────────────────────────► Return deterministic answer
   (date/time queries, official forms/links)

       │ (no match)
       ▼
2. Domain quick-replies ────────────────────────► Return structured response
   (live staff requests, appointment flow)

       │ (no match)
       ▼
3. Cache check ─────────────────────────────────► Serve cached LLM response (6h TTL)
   (PostgreSQL-backed, MD5 key on cleaned query)

       │ (cache miss)
       ▼
4. Live context fetch
   (announcements, lost & found, OSA services catalog from DB)

       │
       ▼
5. RAG retrieval
   (embed query → pgvector cosine search → filter by threshold → top-K chunks)

       │
       ▼
6. LLM generation
   (Gemini gemini-2.5-flash primary, key pool rotation on rate limits)
   (Groq qwen/qwen3-32b emergency fallback if all Gemini keys exhausted)

       │
       ▼
7. Response cleaning
   (strip <think> tags, localhost URLs, internal refs, scaffold leaks)

       │
       ▼
8. Cache write + memory write
   (store in chatbot_response_cache; append to chatbot_conversation_memory)

       │
       ▼
   Return response to student
```

**Quota enforcement** (`middleware/dailyQuota.js`) runs before the pipeline:
- Guests (no JWT): 20 messages/day per IP
- Students (valid JWT): 50 messages/day per IP
- Per-session rate limit: 80 messages/hour per `session_id`

---

## Auth & OTP System

### JWT Auth (Student / Admin Accounts)

1. **Register** — `POST /api/v1/auth/register`: validates the email domain, hashes password with bcrypt (10 rounds), inserts into the `users` table. Admins are auto-verified; students must complete OTP verification.
2. **Login** — `POST /api/v1/auth/login`: bcrypt-verifies password, issues a signed JWT (24-hour expiry) containing `sub`, `email`, `name`, and `role`.
3. **Protected routes** — JWT is passed as a Bearer token in the `Authorization` header. `verifyAuthToken()` in `auth/jwt.js` validates the signature and returns the decoded payload.

### OTP Chat Auth (Secure Student Chat)

Students who want to start a private chat with OSA staff use a separate OTP flow, not the password-based JWT:

1. Student submits their campus email → `POST /api/v1/otp/send`
   - Email format and domain are validated
   - Rate limited: 3 sends per 15 minutes per IP+email
   - Daily cap: 5 sends per email
2. A 6-digit code is generated with `crypto.randomInt`, hashed with HMAC-SHA256 using a server-side pepper, and stored in `email_otp_codes` with a 5-minute TTL.
3. The code is delivered through a transactional email provider.
4. Student submits the code → `POST /api/v1/otp/verify`
   - Hash is recomputed and compared; max 5 attempts before lockout
   - On success: a short-lived chat token (5-minute TTL) is issued and stored in `chat_auth_tokens`
5. The chat token is exchanged for a chat session, which persists the student's identity for the duration of their support conversation.

---

## Real-Time Chat

Typing indicators and delivery receipts use **Server-Sent Events (SSE)** rather than WebSockets. Each student session opens a persistent SSE connection to `GET /api/v1/chat/session/:id/events`. Staff actions push events down this stream in real-time.

| Endpoint | Actor | SSE event pushed |
|---|---|---|
| `POST /chat/typing` | Student → staff | `student_typing` / `student_typing_stop` |
| `POST /chat/seen` | Student → staff | `student_seen` |
| `POST /chat/tickets/:id/staff-typing` | Staff → student | `staff_typing` / `staff_typing_stop` |
| `POST /chat/tickets/:id/staff-seen` | Staff → student | `staff_seen` |

Per-message delivery states (`queued → sent → delivered → seen`) are rendered as double-checkmark indicators under each message bubble.

Socket.io (`/ws/chat`) handles presence events that do not require the SSE session — for example, online/offline status and admin-side queue updates.

---

## Ticket & Visit Lifecycle

### Ticket States

`open` → `in_progress` → `resolved` / `cancelled`

- A ticket moves to `in_progress` when the student is actively connected in the chat session.
- If the student disconnects (explicit close, session expiry, or `ORPHAN_TICKET_DEAD_AIR_MS` idle timeout), `cancelOrphanedTickets()` immediately closes all open/in-progress tickets for that session.
- `sweepDeadAirTickets()` runs every 30 seconds to catch dangling tickets from students who went offline without closing.
- Tickets with an approved appointment resolve as `resolved`; all others resolve as `cancelled`.

### Visit Status Timeline

After an appointment is approved, the student's chat widget displays a live **Visit Status** card with four stages:

**Submitted → Scheduled → Waiting at OSA → Completed**

| Endpoint | Actor | What happens |
|---|---|---|
| `POST /chat/visit/arrive` | Student | Taps "I'm here"; sets `arrived_at`, broadcasts updated queue positions |
| `GET /chat/visit/status?case_id=…` | Student | Returns `visit_state`, `queue_position`, `queue_total` |
| `POST /chat/tickets/:id/complete-visit` | Admin | Sets `visit_completed_at`, advances timeline to "Completed", re-broadcasts queue |

The admin panel shows a dedicated **"Waiting at OSA"** tab, a purple `waiting · #N` badge on each relevant ticket, and a "Mark Visit Completed" button that appears only when the student has arrived but has not yet been seen.

---

## Admin Panel

The admin panel lives at `/admin/` and is protected by an admin key header or an admin JWT.

| Module | URL path | Description |
|---|---|---|
| Dashboard | `/admin/` | Live system stats and server diagnostics |
| Announcements | `/admin/modules/announcements` | Create, edit, and delete portal announcements |
| Lost & Found | `/admin/modules/lost-found` | Manage found items, update status, process claims |
| Chat Support | `/admin/modules/chat-support` | Two-pane live chat interface with full ticket management |
| Chat Logs | `/admin/modules/chat-logs` | View, filter, and delete OTP session logs and guest conversations |
| RAG Manager | `/admin/modules/rag` | Upload chunks, trigger re-embedding, debug search results |

The chat support module is full-bleed and mobile-first. All other modules share the `.page-header` hero layout (maroon diagonal gradient, EAC campus photo backdrop) defined in `admin-shell.css`.

---

## Database Schema

PostgreSQL with the `pgvector` extension. Schema is applied automatically by `ensureV2Schema.js` on every server startup.

### Users & Auth

| Table | Purpose | Key columns |
|---|---|---|
| `users` | Student and admin accounts | `id UUID`, `email`, `name`, `password_hash`, `role (STUDENT\|ADMIN)`, `is_verified` |
| `email_otp_codes` | OTP storage | `email PK`, `code_hash`, `expires_at`, `verify_attempts` |
| `email_otp_daily_quota` | Daily OTP send cap | `(email, day DATE) PK`, `count` |
| `chat_auth_tokens` | Short-lived OTP chat tokens | `token PK`, `email`, `expires_at` |
| `chat_sessions` | Verified chat sessions | `id UUID`, `email`, `student_name`, `created_at`, `last_active_at` |

### Chat & Tickets

| Table | Purpose | Key columns |
|---|---|---|
| `conversations` | Chat sessions (React chat) | `id UUID`, `user_id FK`, `status (ACTIVE\|ESCALATED\|CLOSED)` |
| `messages` | Conversation messages | `id UUID`, `conversation_id FK`, `sender (USER\|BOT\|ADMIN)`, `tier_used (FAQ\|RAG\|ADMIN)` |
| `chat_messages` | OTP session messages | `id BIGSERIAL`, `session_id FK (nullable)`, `role (user\|assistant)`, `content` |
| `tickets` | Escalation tickets | `id UUID`, `case_id UNIQUE`, `user_id FK`, `subject`, `status (OPEN\|IN_PROGRESS\|RESOLVED)` |
| `appointments` | Appointment bookings | `id UUID`, `ticket_id FK`, `preferred_date`, `confirmed_date`, `status (PENDING\|CONFIRMED\|RESCHEDULED\|CANCELLED)` |

### Portal Content

| Table | Purpose | Key columns |
|---|---|---|
| `announcements` | Student announcements | `id BIGSERIAL`, `title`, `category`, `urgency`, `images[]`, `is_active` |
| `lost_found_items` | Lost & found registry | `id BIGSERIAL`, `item_number UNIQUE`, `status (Unclaimed\|Claimed)`, `images[]`, `is_active` |
| `lost_found_claims` | Claim submissions | `id BIGSERIAL`, `email`, `item_id FK`, `status (Pending\|Approved\|Rejected)` |
| `portal_content` | Dynamic page content | `page_name`, `content_key`, `content_value` (UNIQUE on page+key) |

### RAG / Knowledge Base

| Table | Purpose | Key columns |
|---|---|---|
| `rag_chunks` | Embedded knowledge base | `chunk_id PK`, `topic`, `section`, `keywords[]`, `content`, `embedding vector(768)`, `source` |
| `faq_entries` | Curated FAQ tier | `id`, `question`, `answer`, `category`, `keywords[]`, `is_active`, `times_matched` |
| `documents` | Legacy embeddings (1536-dim) | `id UUID`, `title`, `content`, `embedding vector(1536)`, `source` |

### Chatbot State

| Table | Purpose | Key columns |
|---|---|---|
| `chatbot_response_cache` | LLM response cache | `cache_key PK`, `query_text`, `response_text`, `provider`, `hit_count`, `updated_at` |
| `chatbot_conversation_memory` | Short-term conversation memory | `id`, `conversation_id`, `role (user\|assistant\|system)`, `content`, `created_at` |

### Key Indexes

- HNSW index on `rag_chunks.embedding` — fast approximate nearest-neighbor for vector search
- GIN index on `rag_chunks.keywords` and `faq_entries.keywords` — efficient array containment queries
- Composite indexes on `(is_active, created_at DESC)` for announcements and lost & found items
- Index on `(conversation_id, created_at ASC)` for conversation memory retrieval

---

## Getting Started

### Prerequisites

- **Node.js 20+**
- **PostgreSQL** with the `pgvector` extension enabled
- A **Google Gemini API key** for the chatbot and RAG embeddings
- A transactional email provider account for OTP delivery

### Local Setup

```bash
# 1. Install dependencies
npm install

# 2. Apply the database schema and seed data
npm run db:setup

# 3. Seed the RAG knowledge base
npm run rag:seed

# 4. Start the server
npm run api:start
```

The portal is available at `http://localhost:5000` and the API base URL is `http://localhost:5000/api/v1`.

---

## NPM Scripts

| Script | Description |
|---|---|
| `npm run api:start` | Start the API server and static portal |
| `npm run db:setup` | Apply `server/schema.sql` and `server/seed.sql` to the database |
| `npm run rag:seed` | Generate Gemini embeddings for all static chunks and upsert into PostgreSQL |
| `npm run rag:reembed` | Re-generate all RAG embeddings (run after editing chunk content) |
| `npm run minify` | Emit minified `*.min.css` and `*.min.js` into `public/` for production |

---

## API Overview

All endpoints are prefixed with `/api/v1`.

### Public

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check — returns `{"ok":true,"db":"connected"}` |
| `GET` | `/announcements` | List active announcements |
| `GET` | `/lost-found` | List active lost & found items |
| `POST` | `/otp/send` | Send a 6-digit OTP to a campus email |
| `POST` | `/otp/verify` | Verify OTP and issue a short-lived chat token |
| `POST` | `/chatbot/message` | Send a guest chatbot message |
| `GET` | `/chatbot/quota` | Check remaining daily quota for the current IP |

### Student (JWT or chat token required)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/auth/register` | Create a student or admin account |
| `POST` | `/auth/login` | Login and receive a JWT |
| `GET` | `/auth/me` | Return current user from JWT |
| `POST` | `/chat/session` | Create a new secure chat session |
| `GET` | `/chat/session/:id/events` | SSE stream for real-time chat events |
| `POST` | `/chat/message` | Send a message in the secure chat |
| `POST` | `/chat/typing` | Signal typing start or stop |
| `POST` | `/chat/seen` | Mark staff messages as seen |
| `GET` | `/chat/visit/status` | Get visit queue position |
| `POST` | `/chat/visit/arrive` | Signal arrival at the OSA office |

### Admin (`x-admin-key` header or admin JWT required)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/admin/system-info` | Server and database diagnostics |
| `GET/POST/PUT/DELETE` | `/admin/announcements` | Manage announcements |
| `GET/POST/PUT/DELETE` | `/admin/lost-found` | Manage lost & found items |
| `GET/DELETE` | `/admin/chat/logs` | View and delete chat logs |
| `GET/POST/DELETE` | `/admin/rag/chunks` | Manage RAG knowledge base chunks |
| `POST` | `/admin/rag/reembed` | Trigger re-embedding of all RAG chunks |
| `POST` | `/chat/tickets/:id/staff-message` | Send a staff reply to a student |
| `POST` | `/chat/tickets/:id/approve-appointment` | Approve a student appointment |
| `POST` | `/chat/tickets/:id/complete-visit` | Mark a student's visit as completed |

---

## Docker & Deployment

A production-ready `Dockerfile` is included. Because it is a standard OCI container with no platform-specific hooks, it runs **anywhere that supports Docker**:

- Render (Web Service)
- Railway
- DigitalOcean App Platform / Droplets / DOKS
- Fly.io
- AWS (ECS, Fargate, App Runner, EKS, EC2)
- Google Cloud (Cloud Run, GKE, Compute Engine)
- Azure (Container Apps, AKS, App Service for Containers)
- Heroku (container stack)
- Self-hosted (any VPS with Docker installed)

Image details:

- Base image: `node:20-alpine`
- Dependencies installed with `npm ci --omit=dev --no-audit --no-fund`
- Health check at `GET /api/v1/health`
- `docker-entrypoint.sh` runs `db:setup` then starts the server
- Server binds to `0.0.0.0:${PORT:-5000}` — most PaaS providers (Render, Railway, Fly, Cloud Run, App Runner) inject `PORT` automatically

### Build and run locally

```bash
docker build -t osa-portal .
docker run -p 5000:5000 --env-file .env osa-portal
```

### Deploy to Render

1. Push the repository to GitHub.
2. Create a new **Web Service** on Render pointing at the repository.
3. Set the environment variables listed in the [Environment Variables](#environment-variables) section.
4. Render detects the `Dockerfile` and builds automatically.

### Deploy to Railway

1. Create a new project from the GitHub repository.
2. Railway auto-detects the `Dockerfile`.
3. Add the environment variables in the **Variables** tab.
4. Railway provisions a public domain on its own.

### Deploy to DigitalOcean

**Option A — App Platform (managed):**
1. Create a new App, point it at the GitHub repository.
2. App Platform auto-detects the `Dockerfile`.
3. Set environment variables in the app spec.
4. Choose a plan and deploy.

**Option B — Droplet (self-managed VPS):**
```bash
docker build -t osa-portal .
docker run -d -p 80:5000 --env-file .env --restart unless-stopped --name osa-portal osa-portal
```

### Deploy to Fly.io

```bash
fly launch          # detects the Dockerfile
fly secrets set GEMINI_API_KEY=... DATABASE_URL=... JWT_SECRET=... # etc
fly deploy
```

### Deploy to AWS / GCP / Azure

The same image works on AWS App Runner, ECS/Fargate, Google Cloud Run, and Azure Container Apps. Push the image to the platform's container registry (ECR / Artifact Registry / ACR), then create a service pointing at it and inject the environment variables through the platform's secret manager.

---

## Notes

- `serve.js` (port 8001) is a legacy standalone static file server kept for reference only. It is not used at runtime.
- The Gemini key pool supports up to 9 keys via `GEMINI_API_KEY`, `GEMINI_API_KEY2` through `GEMINI_API_KEY9`, or a comma-separated `GEMINI_API_KEYS` list. Keys are rotated automatically when rate limits are hit (HTTP 429/503/502).
- `OFFICIAL_FORMS` in `server/chatbot/services/chatPipeline.js` must be kept in sync with the forms block in `public/preview.html` and `public/index.html`.
- Optional asset minification: run `npm run minify` to emit `*.min.css` / `*.min.js` alongside source files. The chat widget loader auto-selects `.min.js` when the script URL contains that suffix.
- The React/Vite workspace under `frontend/` is a work in progress. It is not built or served at runtime; develop it independently with `cd frontend && npm run dev`.
