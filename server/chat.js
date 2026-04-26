const crypto = require("crypto");
const db = require("./db");
const { verifyAuthToken } = require("./auth/jwt");
const { searchRag } = require("./chatbot/services/ragService");
const { cleanModelText, NO_RELIABLE_KB_REPLY } = require("./chatbot/utils/responseCleaner");
const { tidyOfficialLinks } = require("./chatbot/services/chatPipeline");
const { buildPortalPageContext, looksLikePortalPageIntent } = require("./chatbot/utils/portalPageContext");
const { looksLikeOtpHelpIntent } = require("./chatbot/utils/preprocessor");
const { searchFaq } = require("./faqSearch");
const { hasGeminiKeys, runWithGeminiFailover } = require("./services/geminiKeyPool");
const { clearSessionVerified: _clearSessionVerified } = require("./middleware/dailyQuota");

const GROQ_API_KEY = String(process.env.GROQ_API_KEY || "").trim();
const GEMINI_MODEL = String(process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
const GEMINI_FALLBACK_MODELS = (
  process.env.GEMINI_FALLBACK_MODELS
    ? process.env.GEMINI_FALLBACK_MODELS.split(",").map((s) => s.trim()).filter(Boolean)
    : ["gemini-2.5-flash-8b", "gemini-2.0-flash-lite"]
).filter((m) => m !== GEMINI_MODEL);
const GROQ_MODEL = String(process.env.GROQ_MODEL || "qwen/qwen3-32b").trim();

/**
 * Returns the public-facing portal base URL for use in outbound emails.
 *
 * Priority order:
 *   1. PORTAL_URL env var — only used when it is NOT a localhost address.
 *   2. Production custom domain (default fallback).
 */
const PRODUCTION_PORTAL_URL = "https://eac.osawebportal.ct.ws";

function getPortalUrl() {
  const explicit = String(process.env.PORTAL_URL || "").trim().replace(/\/$/, "");
  if (explicit && !/localhost|127\.0\.0\.1/i.test(explicit)) return explicit;

  return PRODUCTION_PORTAL_URL;
}

function getEmailApiUrl() {
  return String(process.env.EMAIL_API_URL || "https://api.brevo.com/v3/smtp/email").trim();
}

function getEmailApiKey() {
  return String(
    process.env.EMAIL_API_KEY ||
    process.env.Brevo_API_KEY ||
    process.env.BREVO_API_KEY ||
    ""
  ).trim();
}

function getEmailSenderAddress() {
  return String(
    process.env.EMAIL_SENDER_EMAIL ||
    process.env.BREVO_SENDER_EMAIL ||
    ""
  ).trim();
}

function getEmailSenderName() {
  return String(process.env.EMAIL_SENDER_NAME || process.env.BREVO_SENDER_NAME || "OSA System").trim() || "OSA System";
}

async function postTransactionalEmail(scope, payload) {
  const response = await fetch(getEmailApiUrl(), {
    method: "POST",
    headers: {
      accept: "application/json",
      "Content-Type": "application/json",
      "api-key": getEmailApiKey(),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Email API HTTP ${response.status}${bodyText ? `: ${bodyText}` : ""}`);
  }
}

const GROQ_BASE_URL = String(process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1")
  .trim()
  .replace(/\/+$/, "");
const GROQ_FINAL_ONLY_INSTRUCTION =
  "Return only the final user-facing answer. Do not include reasoning traces or <think> tags.";
/** Headroom for long grounded answers (Vision/Mission, scholarship explainers,
 *  multi-form lists). Bumped from 1024 → 2048 so multi-section institutional
 *  answers are not cut mid-sentence. Override via CHAT_MAX_OUTPUT_TOKENS. */
const MAX_OUTPUT_TOKENS = Math.min(
  8192,
  Math.max(128, Number(process.env.CHAT_MAX_OUTPUT_TOKENS ?? 2048))
);
const TIER1_MAX_OUTPUT_TOKENS = Math.min(
  2048,
  Math.max(80, Number(process.env.CHAT_TIER1_MAX_OUTPUT_TOKENS ?? 400))
);
const CHAT_TEMPERATURE = Number(process.env.CHAT_TEMPERATURE || 0.4);
/** When no RAG chunks matched, cap creativity to reduce policy hallucinations (still allows listing live portal data). */
const CHAT_TEMPERATURE_NO_KB = Math.min(
  CHAT_TEMPERATURE,
  Math.max(0, Math.min(1, Number(process.env.CHAT_TEMPERATURE_NO_KB || 0.12)))
);
/** If true (default), Tier 2 will NOT call the LLM when rag_chunks is empty unless the message is greeting / escalation / appointment / live listing / portal logistics (hours·location). Set false only for debugging. */
const CHAT_STRICT_NO_RAG_LLM =
  String(process.env.CHAT_STRICT_NO_RAG_LLM || "true").trim().toLowerCase() !== "false";
/** Minimum RAG confidence (0–1) before Tier-2 may answer from retrieved chunks; below this → escalation message, no LLM. */
const CHAT_RAG_MIN_CONFIDENCE = Math.max(0, Math.min(1, Number(process.env.CHAT_RAG_MIN_CONFIDENCE ?? 0.58)));
// Idle-based session TTL (time since last activity, not since creation).
// Default: 10 minutes of inactivity.
const CHAT_SESSION_TTL_MS = Math.max(
  60 * 1000,
  Number(process.env.CHAT_SESSION_TTL_MS || 10 * 60 * 1000)
);

// Compute when the current session would idle-expire, based on last_active_at.
function sessionExpiresAtIso(sessionRow) {
  const base = new Date(sessionRow.last_active_at || sessionRow.created_at).getTime();
  if (!Number.isFinite(base)) return null;
  return new Date(base + CHAT_SESSION_TTL_MS).toISOString();
}
// If true, skip the LLM rewrite step on Tier 1 FAQ matches (faster by 300–800 ms).
const TIER1_REWRITE = String(process.env.CHAT_TIER1_REWRITE || "false").toLowerCase() === "true";
/** When true, secure chat checks curated FAQ first (fast Tier 1). Default false so Tier 2 (LLM + RAG + live DB) feels more conversational unless ops enables FAQ-first. */
const CHAT_TIER1_FAQ_ENABLED =
  String(process.env.CHAT_TIER1_FAQ_ENABLED || "false").trim().toLowerCase() === "true";

/**
 * Per-session message queue — serializes concurrent requests from the same session.
 * Prevents a fast-typing student from firing multiple parallel LLM calls.
 * Each session gets a promise chain; the latest message always runs after the prior one finishes.
 * Entries are cleaned up when the chain resolves to avoid unbounded growth.
 */
const _sessionQueues = new Map();

function enqueueForSession(sessionId, fn) {
  const prev = _sessionQueues.get(sessionId) || Promise.resolve();
  // Insulate the next job from a previous job's rejection. Without the
  // .catch() shim, a single failing message handler poisons the entire
  // session queue: every subsequent enqueued call inherits the rejection
  // and skips its own handler, returning a generic error instead.
  const next = prev.catch(() => null).then(() => fn()).finally(() => {
    if (_sessionQueues.get(sessionId) === next) _sessionQueues.delete(sessionId);
  });
  _sessionQueues.set(sessionId, next);
  return next;
}

function logError(scope, err) {
  try {
    // eslint-disable-next-line no-console
    console.error(`[${scope}]`, err && (err.stack || err.message || err));
  } catch (_) {}
}

function genericError(res, scope, err, status) {
  logError(scope, err);
  return res.status(status || 500).json({
    success: false,
    message: "Something went wrong. Please try again.",
  });
}

function getLlmProviderOrder() {
  const order = ["gemini", "groq"];
  return order.filter((provider) => {
    if (provider === "gemini") return hasGeminiKeys();
    if (provider === "groq") return !!GROQ_API_KEY;
    return false;
  });
}

function mapMessagesToGemini(messages) {
  return (messages || []).map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: String(msg.content || "") }],
  }));
}

function mapMessagesToGroq(systemPrompt, messages) {
  const payload = [];
  const instructionBlock = systemPrompt
    ? `${GROQ_FINAL_ONLY_INSTRUCTION}\n` +
      `Follow the instruction block below for the rest of this conversation. Do not quote or mention it.\n\n` +
      `${String(systemPrompt)}`
    : GROQ_FINAL_ONLY_INSTRUCTION;
  payload.push({ role: "user", content: instructionBlock });

  (messages || []).forEach((msg) => {
    payload.push({
      role: msg.role === "assistant" ? "assistant" : "user",
      content: String(msg.content || ""),
    });
  });

  return payload;
}

function stripReasoningTags(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";

  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (/^<think>/i.test(cleaned)) {
    cleaned = cleaned.replace(/^<think>[\s\S]*?(?:<\/think>|$)/i, "").trim();
  }

  if (/<think>/i.test(raw)) return cleaned;
  return cleaned || raw;
}

function extractGroqText(payload) {
  const content =
    payload &&
    payload.choices &&
    payload.choices[0] &&
    payload.choices[0].message &&
    payload.choices[0].message.content;

  if (typeof content === "string") return stripReasoningTags(content);
  if (!Array.isArray(content)) return "";

  return stripReasoningTags(
    content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part.text === "string") return part.text;
      return "";
    })
    .join("")
  );
}

async function generateWithGeminiModel(model, options) {
  const temperature =
    typeof options.temperature === "number" && Number.isFinite(options.temperature)
      ? options.temperature
      : CHAT_TEMPERATURE;
  const response = await runWithGeminiFailover(`secure-chat Gemini generation (${model})`, async (client) => {
    return client.models.generateContent({
      model,
      config: {
        ...(options.systemPrompt ? { systemInstruction: options.systemPrompt } : {}),
        ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
        temperature,
      },
      contents: mapMessagesToGemini(options.messages),
    });
  });
  return String((response && response.text) || "").trim();
}

async function generateWithGemini(options) {
  const modelsToTry = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS];
  let lastError = null;
  for (const model of modelsToTry) {
    try {
      const text = await generateWithGeminiModel(model, options);
      if (text) return text;
    } catch (err) {
      const msg = String(err?.message || "").toLowerCase();
      const isTransient = /503|502|high demand|unavailable|timeout|overloaded/i.test(msg);
      lastError = err;
      if (!isTransient) throw err;
      // eslint-disable-next-line no-console
      console.warn(`[gemini-model-fallback] ${model} transient (${msg.slice(0, 80)}) — trying next model`);
    }
  }
  throw lastError || new Error("All Gemini models unavailable");
}

async function generateWithGroq(options) {
  if (!GROQ_API_KEY) throw new Error("Groq is not configured.");

  const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: mapMessagesToGroq(options.systemPrompt, options.messages),
      temperature: (() => {
        const t =
          typeof options.temperature === "number" && Number.isFinite(options.temperature)
            ? options.temperature
            : CHAT_TEMPERATURE;
        return t > 0 ? t : 0.00000001;
      })(),
      ...(options.maxOutputTokens ? { max_completion_tokens: options.maxOutputTokens } : {}),
    }),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }

  if (!response.ok) {
    const detail =
      (payload && payload.error && payload.error.message) ||
      `Groq HTTP ${response.status}`;
    const error = new Error(detail);
    error.status = response.status;
    throw error;
  }

  return extractGroqText(payload);
}

async function generateLlmText(options) {
  const providers = getLlmProviderOrder();
  if (!providers.length) {
    throw new Error("No LLM provider configured. Set GEMINI_API_KEY / GEMINI_API_KEY2..9 or GROQ_API_KEY.");
  }

  let lastError = null;

  for (const provider of providers) {
    try {
      const text = provider === "gemini"
        ? await generateWithGemini(options)
        : await generateWithGroq(options);

      if (text) return text;
    } catch (error) {
      lastError = error;
      if (provider === "gemini" && error?.geminiAllKeysFailed && providers.includes("groq")) {
        // eslint-disable-next-line no-console
        console.warn("[llm] all Gemini API keys failed; attempting Groq emergency fallback.");
      }
      logError(`llm:${provider}`, error);
    }
  }

  if (lastError) throw lastError;
  return "";
}

// Returns the session row's current idle-expiry, re-reading last_active_at.
async function readSessionExpiryIso(sessionId) {
  try {
    const r = await db.query(
      `SELECT last_active_at, created_at FROM chat_sessions WHERE id = $1`,
      [sessionId]
    );
    if (!r.rows.length) return null;
    return sessionExpiresAtIso(r.rows[0]);
  } catch (_) { return null; }
}

function isAdminTokenAuthorized(rawToken) {
  const provided = String(rawToken || "").trim();
  const expected = String(process.env.ADMIN_KEY || "").trim();
  if (!expected) {
    return true;
  }

  // Allow either static ADMIN_KEY or a valid ADMIN JWT token from admin login.
  if (provided === expected) {
    return true;
  }

  try {
    const decoded = verifyAuthToken(provided);
    const role = String((decoded && decoded.role) || "").trim().toUpperCase();
    if (role === "ADMIN") {
      return true;
    }
  } catch (_error) {}

  return false;
}

function requireAdminKey(req, res, next) {
  // Dev-mode fallback: allow when ADMIN_KEY is unset, but warn loudly so prod doesn't ship open.
  if (!String(process.env.ADMIN_KEY || "").trim()) {
    // eslint-disable-next-line no-console
    console.warn("[admin] ADMIN_KEY is not set — admin routes are unauthenticated (dev only).");
    return next();
  }
  const provided = String((req.headers && req.headers["x-admin-key"]) || "").trim();
  if (isAdminTokenAuthorized(provided)) return next();
  return res.status(401).json({ success: false, message: "Unauthorized." });
}
const HUMAN_WAIT_NOTIFY_MS = Math.max(
  60 * 1000,
  Number(process.env.CHAT_HUMAN_WAIT_NOTIFY_MS || 5 * 60 * 1000)
);
const STAFF_CHAT_IDLE_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.STAFF_CHAT_IDLE_TIMEOUT_MS || 30 * 60 * 1000)
);

// ── In-memory SSE registry ─────────────────────────────────────
// sessionId → Set of response objects (one per open browser tab)
const sseClients = new Map();
// Admin dashboard ticket stream clients
const adminTicketClients = new Set();

// ── Per-key in-memory mutex ────────────────────────────────────
// Serializes concurrent handlers that share a key (e.g. two rapid
// visit POSTs from the same session). Required because the visit
// endpoint does check-then-create: without this, two requests can
// both run findOpenTicketByType before either inserts, and both
// will create new duplicate tickets.
const _keyedLocks = new Map();
// Tracks the last successful "appointment confirmed" notification per
// case_id, so a duplicate confirm within a short window is suppressed
// (no second chat message, no second SSE push to the student).
const _lastApptConfirmAt = new Map();
// Tracks the last "Your inquiry is already escalated…" canned reply per
// case_id, so the student doesn't see the same paragraph repeated on
// every message they send while waiting for staff (one reply per minute
// is plenty — staff messages still pass through normally).
const _lastEscalatedNoticeAt = new Map();
const ESCALATED_NOTICE_DEDUPE_MS = 60_000;
async function withKeyedLock(key, fn) {
  const prev = _keyedLocks.get(key) || Promise.resolve();
  let release;
  const next = new Promise((r) => { release = r; });
  _keyedLocks.set(key, next);
  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (_keyedLocks.get(key) === next) _keyedLocks.delete(key);
  }
}

function pushToSession(sessionId, payload) {
  const clients = sseClients.get(sessionId);
  if (!clients || !clients.size) return false;
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  clients.forEach((res) => { try { res.write(line); } catch (_) {} });
  return true;
}

function pushToAdminTickets(payload) {
  if (!adminTicketClients.size) return false;
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  adminTicketClients.forEach((res) => { try { res.write(line); } catch (_) {} });
  return true;
}

// ── Auto-close orphaned / dead-air tickets ─────────────────────
// Status rule: `in_progress` only applies while the student session is still
// active/online. Once the student ends the session, signs out, or goes
// offline (no SSE + idle past the dead-air window), every open/in_progress
// ticket attached to that session is closed:
//   • appointment_status = 'approved'  → status='resolved'  (OSA already
//                                        approved; nothing more to do here)
//   • appointment_status <> 'approved' → status='cancelled' (student left
//                                        before approval)
const ORPHAN_TICKET_DEAD_AIR_MS = Math.max(
  60 * 1000,
  Number(process.env.CHAT_ORPHAN_TICKET_DEAD_AIR_MS || 5 * 60 * 1000)
);
const ORPHAN_TICKET_SSE_GRACE_MS = Math.max(
  30 * 1000,
  Number(process.env.CHAT_ORPHAN_TICKET_SSE_GRACE_MS || 60 * 1000)
);
const ORPHAN_TICKET_SWEEP_INTERVAL_MS = 30 * 1000;

async function cancelOrphanedTickets(sessionId, reason) {
  if (!sessionId) return [];
  const reasonText = String(reason || "session_ended").slice(0, 120);
  const closed = [];
  try {
    // 1) Approved appointments → resolve (the appointment outcome is locked
    //    in; once the student leaves the live chat there is nothing more for
    //    OSA to do inside the session, so the ticket is no longer "in progress").
    const resolved = await db.query(
      `UPDATE escalation_tickets
          SET status = 'resolved',
              resolution_reason = COALESCE(NULLIF(resolution_reason, ''), $2),
              updated_at = NOW()
        WHERE session_id = $1
          AND status IN ('open','in_progress')
          AND COALESCE(appointment_status, '') = 'approved'
        RETURNING case_id, ticket_type`,
      [sessionId, `approved_${reasonText}`.slice(0, 120)]
    );
    (resolved.rows || []).forEach((row) => {
      closed.push({ ...row, new_status: "resolved" });
      try {
        pushToAdminTickets({
          type: "ticket_resolved",
          case_id: row.case_id,
          session_id: sessionId,
          reason: `approved_${reasonText}`,
        });
      } catch (_) {}
    });

    // 2) Everything else (no approval) → cancel.
    const cancelled = await db.query(
      `UPDATE escalation_tickets
          SET status = 'cancelled',
              cancelled_at = NOW(),
              cancelled_reason = $2,
              updated_at = NOW()
        WHERE session_id = $1
          AND status IN ('open','in_progress')
          AND COALESCE(appointment_status, '') <> 'approved'
        RETURNING case_id, ticket_type`,
      [sessionId, reasonText]
    );
    (cancelled.rows || []).forEach((row) => {
      closed.push({ ...row, new_status: "cancelled" });
      try {
        pushToAdminTickets({
          type: "ticket_cancelled",
          case_id: row.case_id,
          session_id: sessionId,
          reason: reasonText,
        });
      } catch (_) {}
    });

    return closed;
  } catch (error) {
    logError("ticket-auto-close", error);
    return closed;
  }
}

async function sweepDeadAirTickets() {
  try {
    // Look at every open/in_progress ticket — `in_progress` should only
    // remain while the student is actually online in the chat. The moment
    // the underlying session expires or the student disconnects + goes
    // idle past the dead-air window, the ticket is closed (resolved if the
    // appointment was approved, cancelled otherwise) by cancelOrphanedTickets.
    const result = await db.query(
      `SELECT t.case_id, t.session_id, t.status, t.appointment_status,
              s.last_active_at, t.created_at
         FROM escalation_tickets t
         LEFT JOIN chat_sessions s ON s.id = t.session_id
        WHERE t.status IN ('open', 'in_progress')`
    );
    const now = Date.now();
    const handledSessions = new Set();
    for (const row of result.rows || []) {
      const sessionId = row.session_id;
      if (!sessionId || handledSessions.has(sessionId)) continue;
      const lastActiveMs = row.last_active_at ? new Date(row.last_active_at).getTime() : 0;
      const sessionIdleFor = lastActiveMs ? now - lastActiveMs : Number.POSITIVE_INFINITY;
      const sessionExpired = sessionIdleFor >= CHAT_SESSION_TTL_MS;
      const sseClientCount = (sseClients.get(sessionId) || new Set()).size;
      const studentOffline = sseClientCount === 0;
      const ageMs = row.created_at ? now - new Date(row.created_at).getTime() : 0;
      const deadAir =
        studentOffline &&
        ageMs >= ORPHAN_TICKET_SSE_GRACE_MS &&
        sessionIdleFor >= ORPHAN_TICKET_DEAD_AIR_MS;

      if (sessionExpired) {
        handledSessions.add(sessionId);
        await cancelOrphanedTickets(sessionId, "session_expired");
      } else if (deadAir) {
        handledSessions.add(sessionId);
        await cancelOrphanedTickets(sessionId, "dead_air");
      }
    }
  } catch (error) {
    logError("ticket-sweep", error);
  }
}

setInterval(() => { sweepDeadAirTickets(); }, ORPHAN_TICKET_SWEEP_INTERVAL_MS).unref();

// Non-fatal email to OSA staff when a ticket is escalated
async function sendStaffNotificationEmail(caseId, studentName, studentEmail, concern, variant) {
  try {
    const staffEmail = (process.env.OSA_STAFF_EMAIL || "").trim();
    const apiKey = getEmailApiKey();
    const sender = getEmailSenderAddress();
    const senderName = getEmailSenderName();
    if (!staffEmail || !apiKey || !sender) return;

    const portalUrl  = getPortalUrl();
    const chatLink   = portalUrl
      ? `${portalUrl}/admin/modules/chat-support?case=${encodeURIComponent(caseId)}`
      : "";

    const btnHtml = chatLink
      ? `<p style="margin:20px 0"><a href="${chatLink}" style="display:inline-block;background:#841a2d;color:#fff;font-family:system-ui,sans-serif;font-size:14px;font-weight:700;padding:12px 24px;text-decoration:none;letter-spacing:0.03em">Chat This Student →</a></p>`
      : "";

    const html =
      `<div style="font-family:system-ui,sans-serif;max-width:560px;color:#191412">` +
      `<p style="font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#841a2d;margin:0 0 6px">OSA TRANSACTION GUIDE — ESCALATION TICKET</p>` +
      `<p style="font-size:22px;font-weight:800;margin:0 0 20px;letter-spacing:-0.02em">${variant === "claim" ? "Lost & Found Claim Request" : "New Student Concern Submitted"}</p>` +
      `<table style="width:100%;border-collapse:collapse;margin-bottom:20px">` +
        `<tr><td style="padding:8px 12px;background:#f5ede0;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#65574d;width:120px">Case ID</td><td style="padding:8px 12px;background:#fffaf3;font-size:14px;font-weight:700;color:#841a2d">${caseId}</td></tr>` +
        `<tr><td style="padding:8px 12px;background:#f5ede0;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#65574d">Student</td><td style="padding:8px 12px;background:#fffaf3;font-size:14px">${studentName}</td></tr>` +
        `<tr><td style="padding:8px 12px;background:#f5ede0;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#65574d">Email</td><td style="padding:8px 12px;background:#fffaf3;font-size:14px">${studentEmail}</td></tr>` +
      `</table>` +
      `<p style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#65574d;margin:0 0 8px">Concern</p>` +
      `<div style="background:#fff8f0;border-left:4px solid #c79a49;padding:14px 16px;font-size:14px;line-height:1.6;white-space:pre-wrap">${concern}</div>` +
      btnHtml +
      `<p style="font-size:12px;color:#65574d;margin-top:16px">This is an automated notification from the OSA Transaction Guide Portal.</p>` +
      `</div>`;

    await postTransactionalEmail("staff-escalation-email", {
      sender: { name: senderName, email: sender },
      to: [{ email: staffEmail }],
      subject: variant === "claim"
        ? `[OSA] LF Claim — ${caseId} · ${studentName}`
        : `[OSA] New Escalation — ${caseId} · ${studentName}`,
      htmlContent: html,
    });
  } catch (error) {
    // Non-fatal: ticket is already created, email failure shouldn't block
    logError("send-staff-notification-email", error);
  }
}

async function sendStudentEscalationEmail(caseId, studentName, studentEmail, concern, variant) {
  try {
    const apiKey = getEmailApiKey();
    const sender = getEmailSenderAddress();
    const senderName = getEmailSenderName();
    if (!apiKey || !sender || !studentEmail) return;

    const isClaim = variant === "claim";
    const portalUrl = getPortalUrl();
    const chatLink = portalUrl ? `${portalUrl}/chat` : "";
    const btnHtml = chatLink
      ? `<p style="margin:20px 0"><a href="${chatLink}" style="display:inline-block;background:#841a2d;color:#fff;font-family:system-ui,sans-serif;font-size:14px;font-weight:700;padding:12px 24px;text-decoration:none;letter-spacing:0.03em">Open Chat Support →</a></p>`
      : "";

    const eyebrow = isClaim ? "LOST & FOUND — CLAIM SUBMITTED" : "OSA TRANSACTION GUIDE — SUPPORT ESCALATION";
    const headline = isClaim ? "We received your claim request" : "Your concern was escalated to OSA staff";

    const html =
      `<div style="font-family:system-ui,sans-serif;max-width:560px;color:#191412">` +
      `<p style="font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#841a2d;margin:0 0 6px">${eyebrow}</p>` +
      `<p style="font-size:22px;font-weight:800;margin:0 0 20px;letter-spacing:-0.02em">${headline}</p>` +
      `<table style="width:100%;border-collapse:collapse;margin-bottom:20px">` +
        `<tr><td style="padding:8px 12px;background:#f5ede0;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#65574d;width:120px">Case ID</td><td style="padding:8px 12px;background:#fffaf3;font-size:14px;font-weight:700;color:#841a2d">${caseId}</td></tr>` +
        `<tr><td style="padding:8px 12px;background:#f5ede0;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#65574d">Student</td><td style="padding:8px 12px;background:#fffaf3;font-size:14px">${studentName}</td></tr>` +
      `</table>` +
      `<p style="font-size:13px;color:#191412;margin:0 0 10px">Keep this Case ID for reference. An OSA staff member will respond in chat as soon as available. If they are unable to reply in chat right away, please wait — OSA may also follow up with the student directly via this email.</p>` +
      `<div style="background:#fff8f0;border-left:4px solid #c79a49;padding:14px 16px;font-size:14px;line-height:1.6;white-space:pre-wrap">${concern}</div>` +
      btnHtml +
      `<p style="font-size:12px;color:#65574d;margin-top:16px">This is an automated message from the OSA Transaction Guide Portal.</p>` +
      `</div>`;

    await postTransactionalEmail("student-escalation-email", {
      sender: { name: senderName, email: sender },
      to: [{ email: studentEmail }],
      subject: isClaim ? `[OSA] Lost & Found Claim — ${caseId}` : `[OSA] Support Escalation Received — ${caseId}`,
      htmlContent: html,
    });
  } catch (error) {
    // Non-fatal.
    logError("send-student-escalation-email", error);
  }
}

async function sendEscalationWaitReminderEmail(caseId, studentName, studentEmail, concern) {
  try {
    const staffEmail = (process.env.OSA_STAFF_EMAIL || "").trim();
    const apiKey = getEmailApiKey();
    const sender = getEmailSenderAddress();
    const senderName = getEmailSenderName();
    if (!staffEmail || !apiKey || !sender) return;

    const toList = [{ email: staffEmail }];
    if (studentEmail) toList.push({ email: studentEmail });

    const html =
      `<div style="font-family:system-ui,sans-serif;max-width:560px;color:#191412">` +
      `<p style="font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#841a2d;margin:0 0 6px">OSA TRANSACTION GUIDE — FOLLOW-UP REMINDER</p>` +
      `<p style="font-size:20px;font-weight:800;margin:0 0 16px;letter-spacing:-0.02em">Pending human support response</p>` +
      `<p style="font-size:14px;line-height:1.6;margin:0 0 12px">Case <strong>${caseId}</strong> is still waiting for staff response after 5 minutes.</p>` +
      `<p style="font-size:14px;line-height:1.6;margin:0 0 12px"><strong>Student:</strong> ${studentName} (${studentEmail})</p>` +
      `<div style="background:#fff8f0;border-left:4px solid #c79a49;padding:14px 16px;font-size:14px;line-height:1.6;white-space:pre-wrap">${concern}</div>` +
      `</div>`;

    await postTransactionalEmail("escalation-reminder-email", {
      sender: { name: senderName, email: sender },
      to: toList,
      subject: `[OSA] Reminder: Pending Response — ${caseId}`,
      htmlContent: html,
    });
  } catch (error) {
    // Non-fatal.
    logError("send-escalation-reminder-email", error);
  }
}

// Keywords that trigger Tier 3 escalation.
// Two categories:
//   (A) explicit staff-request phrases
//   (B) sensitive/disciplinary topics that MUST ALWAYS go to staff
const ESCALATION_TRIGGERS = [
  // A — explicit staff requests
  "escalate",
  "human support",
  "human agent",
  "talk to staff",
  "speak to staff",
  "live agent",
  "representative",
  "create ticket",
  "file ticket",
  "report concern",
  "file complaint",
  "kausapin staff",
  "kausapin ang staff",
  "makipag-usap sa staff",
  // slash-command shortcuts
  "/chat staff",
  "chat staff",
  "/staff",
  "/human",
  "/escalate",
  "/talk to staff",
  // B — disciplinary / sensitive topics (always route to staff regardless of confidence)
  "complaint",
  "disciplinary",
  "disciplinary action",
  "disciplinary case",
  "disciplinary concern",
  "suspension",
  "suspended",
  "code violation",
  "student violation",
  "violation",
  "appeal",
  "academic appeal",
  "appeal suspension",
  "misconduct",
  "student misconduct",
  "harassment",
  "sexual harassment",
  "bullying",
  "bullied",
  "bully",
  "cyberbullying",
  "fight",
  "physical altercation",
  "physical fight",
  "incident report",
  "incident case",
  "personal concern",
  "sensitive concern",
  "mental health",
  "psychological concern",
  "emotional concern",
  "probation",
  "academic probation",
  "dismissal",
  "expelled",
  "expulsion",
  "cheating",
  "academic dishonesty",
  "plagiarism",
  "case filed",
  "case against",
  "summon",
  "hearing",
  "student hearing",
];

function extractStudentName(email) {
  const username = String(email || "").split("@")[0] || "";
  const parts = username
    .replace(/[^a-zA-Z.\-_ ]/g, " ")
    .split(/[.\-_ ]+/)
    .filter(Boolean);

  // If we can't confidently infer a real name, use a neutral label.
  if (!parts.length || parts.length === 1) return "Student";

  const display = parts
    .slice(0, 3)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");

  return display || "Student";
}

function normalizeDisplayName(rawName) {
  const cleaned = String(rawName || "")
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z.\-'\s]/g, "")
    .trim();
  if (cleaned.length < 2) return "";
  return cleaned.slice(0, 60);
}

function generateCaseId() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `OSA-${ts}-${rand}`;
}

function isSessionExpired(sessionRow) {
  // Idle-based: expire after CHAT_SESSION_TTL_MS of inactivity since last_active_at.
  const lastActive = new Date(sessionRow.last_active_at || sessionRow.created_at).getTime();
  if (!Number.isFinite(lastActive)) return true;
  return Date.now() - lastActive >= CHAT_SESSION_TTL_MS;
}

function isValidSessionId(sessionId) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(sessionId || "").trim()
  );
}

async function loadSessionRow(sessionId) {
  const sessionResult = await db.query(
    `SELECT id, email, student_name, created_at, last_active_at FROM chat_sessions WHERE id = $1`,
    [sessionId]
  );
  if (!sessionResult.rows.length) return { found: false, expired: false, session: null };

  const session = sessionResult.rows[0];
  if (!isSessionExpired(session)) return { found: true, expired: false, session };

  // On idle expiry, DO NOT delete the chat_session row. Doing so used to cascade
  // through the FK and wipe escalation_tickets + chat_messages — destroying OSA
  // data such as resolved/approved tickets and the conversation history that
  // belongs to them. The session is simply marked expired here; the student is
  // forced to re-verify their email and will be issued a new session_id, while
  // the historical session, its messages, and any related tickets remain intact
  // for OSA records.
  // Soft-cancel any unresolved tickets attached to this dead session so they
  // disappear from the admin queue (approved appointments are preserved).
  cancelOrphanedTickets(sessionId, "session_expired").catch(() => {});
  try { _clearSessionVerified(sessionId); } catch (_) {}
  return { found: true, expired: true, session: null };
}

async function persistReply(sessionId, reply) {
  await db.query(
    `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
    [sessionId, reply]
  );
  await db.query(`UPDATE chat_sessions SET last_active_at = NOW() WHERE id = $1`, [sessionId]);
}

async function fetchRagResult(message) {
  try {
    const rag = await searchRag(message || "");
    return rag && rag.chunks && rag.chunks.length
      ? { context: rag.context || "", confidence: Number(rag.confidence) || 0, tier: rag.tier || "ESCALATE", chunkCount: rag.chunks.length }
      : { context: "", confidence: 0, tier: "ESCALATE", chunkCount: 0 };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[tier2-rag]", err?.message || err);
    return { context: "", confidence: 0, tier: "ESCALATE", chunkCount: 0 };
  }
}

// ── Tier 2: live DB context — announcements, Lost & Found, OSA services,
//    the student's OWN open tickets, and their OWN appointments. This is
//    what makes the bot aware of current system state (not just the manual).
async function getOsaContext(studentEmail, sessionId) {
  try {
    const email = String(studentEmail || "").trim().toLowerCase();
    const sid = String(sessionId || "").trim();

    const queries = [
      db.query(
        `SELECT page_name, content_key, content_value
         FROM portal_content
         WHERE page_name IN ('home', 'about')
         ORDER BY page_name ASC, content_key ASC`
      ),
      // Active announcements (most recent 8)
      db.query(
        `SELECT title, category, urgency, details, date_label
         FROM announcements
         WHERE is_active = true
         ORDER BY created_at DESC
         LIMIT 8`
      ),
      // ALL L&F items (with status) so the bot can answer "is LF-X claimed?"
      db.query(
        `SELECT item_number, title, tag, status, date_label
         FROM lost_found_items
         WHERE is_active = true
         ORDER BY created_at DESC
         LIMIT 40`
      ),
      // Pending L&F claims — who is trying to claim what
      db.query(
        `SELECT c.id, c.email, c.status, c.created_at, i.item_number, i.title
         FROM lost_found_claims c
         LEFT JOIN lost_found_items i ON c.item_id = i.id
         WHERE c.status = 'Pending'
         ORDER BY c.created_at DESC
         LIMIT 15`
      ),
      // OSA services catalog
      db.query(
        `SELECT name, description, requirements, fees, processing_time, office_location
         FROM osa_services
         WHERE is_active = true
         ORDER BY name ASC
         LIMIT 20`
      ),
      // THE CURRENT STUDENT's own non-resolved tickets
      email
        ? db.query(
            `SELECT case_id, ticket_type, status, appointment_status,
                    preferred_day, preferred_time_window, appointment_datetime,
                    concern, created_at, updated_at
             FROM escalation_tickets
             WHERE lower(student_email) = $1
               AND status IN ('open','in_progress')
             ORDER BY created_at DESC
             LIMIT 5`,
            [email]
          )
        : Promise.resolve({ rows: [] }),
      // THE CURRENT STUDENT's resolved tickets today (for reference)
      email
        ? db.query(
            `SELECT case_id, ticket_type, status, appointment_status,
                    appointment_datetime, concern, updated_at
             FROM escalation_tickets
             WHERE lower(student_email) = $1
               AND status = 'resolved'
               AND updated_at > NOW() - INTERVAL '1 day'
             ORDER BY updated_at DESC
             LIMIT 3`,
            [email]
          )
        : Promise.resolve({ rows: [] }),
    ];

    const [contentR, annR, lfR, claimsR, svcR, ownOpenR, ownResolvedR] = await Promise.all(queries);

    let ctx = "";
    const pageCtx = buildPortalPageContext(contentR.rows);

    if (pageCtx) {
      ctx += pageCtx;
    }

    if (annR.rows.length) {
      ctx += "\n\nCURRENT OSA ANNOUNCEMENTS (live from the admin panel):\n";
      annR.rows.forEach((a) => {
        const urgency = a.urgency ? ` [${a.urgency}]` : "";
        const date = a.date_label ? ` (${a.date_label})` : "";
        ctx += `- [${a.category || "General"}]${urgency}${date} ${a.title}: ${a.details || "No details."}\n`;
      });
    }

    if (lfR.rows.length) {
      ctx += "\n\nLOST & FOUND REGISTRY (live — every item with current status):\n";
      lfR.rows.forEach((i) => {
        ctx += `- ${i.item_number}: ${i.title} (${i.tag || "Other"}) — STATUS: ${i.status || "Unclaimed"}${i.date_label ? `, posted ${i.date_label}` : ""}\n`;
      });
    }
    if (claimsR.rows.length) {
      ctx += "\nPENDING LOST & FOUND CLAIMS (awaiting staff verification):\n";
      claimsR.rows.forEach((c) => {
        const itemNum = c.item_number || "(unknown item)";
        const when = c.created_at ? new Date(c.created_at).toISOString().slice(0, 10) : "";
        ctx += `- ${itemNum} claimed by ${c.email}${when ? ` on ${when}` : ""} (status: ${c.status})\n`;
      });
    }

    if (svcR.rows.length) {
      ctx += "\n\nOSA SERVICES CATALOG (live):\n";
      svcR.rows.forEach((s) => {
        const reqs = Array.isArray(s.requirements) && s.requirements.length
          ? ` | Requirements: ${s.requirements.join(", ")}`
          : "";
        const fees = s.fees ? ` | Fee: ${s.fees}` : "";
        const time = s.processing_time ? ` | Processing: ${s.processing_time}` : "";
        const loc = s.office_location ? ` | Office: ${s.office_location}` : "";
        ctx += `- ${s.name}: ${s.description}${reqs}${fees}${time}${loc}\n`;
      });
    }

    if (ownOpenR.rows.length) {
      ctx += "\n\nTHIS STUDENT'S OWN OPEN TICKETS (only visible to them):\n";
      ownOpenR.rows.forEach((t) => {
        const apt = t.appointment_status ? ` | appointment: ${t.appointment_status}` : "";
        const day = t.preferred_day ? ` | preferred day: ${t.preferred_day}` : "";
        const tw = t.preferred_time_window ? ` | time: ${t.preferred_time_window}` : "";
        const when = t.appointment_datetime ? ` | scheduled: ${new Date(t.appointment_datetime).toISOString()}` : "";
        ctx += `- ${t.case_id} [${t.ticket_type || "general"}] status: ${t.status}${apt}${day}${tw}${when} — ${t.concern || ""}\n`;
      });
    }
    if (ownResolvedR.rows.length) {
      ctx += "\nTHIS STUDENT'S TICKETS RESOLVED IN THE LAST 24H:\n";
      ownResolvedR.rows.forEach((t) => {
        ctx += `- ${t.case_id} [${t.ticket_type || "general"}] resolved — ${t.concern || ""}\n`;
      });
    }

    if (ctx) {
      ctx = "\n\nCURRENT SYSTEM STATE (live data from the OSA portal database — treat as authoritative for current state questions):" + ctx;
    }
    return ctx;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[osa-ctx]", err?.message || err);
    return "";
  }
}

function buildNoKbGuidancePrompt(name, email) {
  const { combined: nowStr } = formatPhDateTime();
  return (
    `You are the OSA (Office of Student Affairs) Assistant for EAC Cavite.\n` +
    `Today is ${nowStr}. You may answer date / time questions directly using this value — do not say you cannot tell the date.\n\n` +
    // ── MEMORY DIRECTIVE (mirrors buildSystemPrompt) ───────────────
    // Without this the no-KB path was triggering "I have no memory of past
    // conversations" hallucinations even though the prior chat turns are
    // included in the messages array sent to the LLM.
    `MEMORY: You DO have access to the full conversation history above (every prior user and assistant turn in this session is included in the messages list). Treat that history AS your memory. Never say "I do not retain memories", "I don't remember", "each interaction is new for me", "I cannot recall past conversations", or any similar disclaimer. If the student asks what was discussed earlier, what they last said, or asks for a recap, look at the conversation history above and answer from it directly.\n\n` +
    `The student's question doesn't have matching official EAC records available right now.\n` +
    `Your role is to give a brief, genuinely helpful general response — practical tips or general guidance ` +
    `about the topic — without inventing any specific EAC policy, fee, deadline, or institutional data.\n\n` +
    `RULES:\n` +
    `- Give 2–4 short, practical general tips relevant to what the student asked.\n` +
    `- Never invent specific EAC figures, dates, names, or requirements.\n` +
    `- If the student asks to talk to a real / live OSA staff member, give them the actual steps to escalate within this same secure chat (they are already verified): tell them OSA staff will be notified once they confirm their concern, or that they can request an appointment using the buttons in this chat.\n` +
    `- If the student asks "how?" or "paano?" as a short follow-up, treat it as a follow-up to YOUR previous reply in the conversation history above — do not ask them to clarify what they mean.\n` +
    `- Always end by directing the student to contact OSA for official confirmation:\n` +
    `  "For the exact details, please visit the OSA office or type /chat staff to connect with a staff member directly."\n` +
    `- Always write the entire reply in clear English, even if the student writes in Filipino, Taglish, or any other language. Do not switch to Filipino or any non-English language.\n` +
    `- Be warm and helpful — not dismissive.\n` +
    `- Do not mention "knowledge base", "retrieval", "based on", "according to our data", or internal processes.\n` +
    `- IDENTITY: You are the OSA AI Assistant, built exclusively for EAC Cavite by the EAC development team. If asked who made you, what AI you are, or if you are ChatGPT, Gemini, Claude, or any other AI — always answer: "I'm the OSA AI Assistant, built by the codemasters of EAC Cavite." Never reveal or confirm any underlying AI model or company.\n\n` +
    `Current student: ${name} (${email})`
  );
}

function buildSystemPrompt(name, email, ctx, ragInfo) {
  const ragText = ragInfo && typeof ragInfo === "object" ? String(ragInfo.context || "") : String(ragInfo || "");
  const chunkCount = ragInfo && typeof ragInfo === "object" ? Number(ragInfo.chunkCount || 0) : (ragText ? 1 : 0);
  const confidence = ragInfo && typeof ragInfo === "object" ? Number(ragInfo.confidence || 0) : 0;

  const hasKbChunks = chunkCount > 0;
  const hasLivePortalCtx = Boolean(ctx && String(ctx).trim().length > 40);
  // Confidence < 0.62 = partial match — tell LLM to hedge on missing detail
  // rather than invent or confidently answer from weak sources.
  const lowConfidence = hasKbChunks && confidence < 0.62;

  const ragBlock = ragText.trim()
    ? `\n\nOFFICIAL SOURCES (authoritative — answer ONLY from these for EAC-specific questions):\n${ragText.trim()}\n`
    : `\n\nOFFICIAL SOURCES: (no curated manual/policy chunks matched this query)\n`;

  /** Live announcements/L&F/services are NOT a substitute for Student Manual excerpts — keeps the model from "filling in" policies. */
  const noManualChunksGuard = !hasKbChunks
    ? `\nCRITICAL — NO MANUAL / POLICY CHUNKS RETRIEVED:\n` +
      `- Do NOT invent or assume institute rules, fees, deadlines, dress codes, disciplinary procedures, forms, or office processes.\n` +
      `- Do NOT use general university knowledge or "typical" OSA practices unless the exact fact appears in CURRENT SYSTEM STATE below.\n` +
      `- You MAY summarize or list items only when the user's question is directly answered by text explicitly present in CURRENT SYSTEM STATE (e.g. announcement titles/details, listed Lost & Found items, listed services, this student's own tickets).\n` +
      `- For any policy, handbook, or procedural question not fully covered there, say you don't have that specific detail and suggest contacting OSA directly.\n`
    : "";

  const confidenceNote = lowConfidence
    ? `\nNOTE: Retrieval confidence is moderate (${confidence.toFixed(2)}). ` +
      `Answer ONLY the parts that are explicitly supported by the retrieved sources. ` +
      `For any detail NOT clearly stated in the excerpts, say: "For the exact details on this, please contact OSA directly at studentaffairs.cvt@eac.edu.ph or Tel loc 115." ` +
      `Do NOT invent specific fees, dates, or procedures not present in the excerpts.\n`
    : "";

  const fallbackRule =
    !hasKbChunks && !hasLivePortalCtx
      ? `\nIMPORTANT: No official sources are available for this turn. If the user is asking an informational question you cannot answer, say you don't have that detail and suggest contacting OSA — unless the user is asking for human help or an appointment (handle per Escalation Contract below).\n`
      : "";

  const { combined: nowStr } = formatPhDateTime();
  return (
    `You are the OSA (Office of Student Affairs) Assistant for EAC Cavite.\n` +
    `Today is ${nowStr}. Treat this as ground truth for any "what day/date/time" question — answer directly with this value, never tell the student to check their phone or a calendar.\n\n` +
    `MEMORY: You DO have access to the full conversation history above. Never say "I do not retain memories", "I don't remember", "each interaction is processed independently", or any similar disclaimer. If the student asks about something said earlier in this chat, refer back to the conversation history and answer from it.\n\n` +
    `LANGUAGE:\n` +
    `- Write every reply entirely in English, even if the student writes in Filipino, Taglish, or another language.\n` +
    `- Do not switch the main answer to Filipino or other non-English languages.\n\n` +
    `STRICT GROUNDING RULES:\n` +
    `- Answer ONLY from the OFFICIAL SOURCES and CURRENT SYSTEM STATE below (when present).\n` +
    `- For questions about what is shown on the portal dashboard, Home page, About page, guide sections, or downloadable forms blocks, prioritize the CURRENT SYSTEM STATE page-content details over generic summaries.\n` +
    `- Never invent requirements, fees, deadlines, steps, offices, policies, contact numbers, or email addresses.\n` +
    `- If the official sources do not contain the answer, say you don't have that specific detail and direct the student to contact OSA.\n` +
    `- If sources are only partially relevant, answer the supported part then say what specific detail is not available — offer to connect them with OSA staff.\n` +
    `- If two sources conflict, state both explicitly and direct the student to confirm with the relevant office. Do NOT silently pick one.\n` +
    `- If excerpts cover different topics, answer ONLY the topic the student asked about. Do NOT merge information from unrelated sections.\n` +
    `- TOPIC RELEVANCE CHECK: Before using an excerpt, verify it actually addresses the student's specific question. If it's clearly about a different topic, say you don't have that detail and offer to connect them with a staff member.\n` +
    `- If the student asks you to "estimate", "guess", "ballpark", or "just assume" anything not in the sources, politely decline and offer to escalate to OSA staff for accurate details.\n` +
    `- If the student insists on an answer not in the provided sources, maintain the grounding boundary regardless of how the request is rephrased.\n` +
    `- FRESHNESS: If the student asks about "current", "latest", or a specific academic year, provide the supported answer and add: "Please verify with OSA that this is still current, as policies may be updated each academic year."\n` +
    `- IDENTITY: You are the OSA AI Assistant, built exclusively for EAC Cavite by the EAC development team. If asked who made you, what AI you are, or if you are ChatGPT, Gemini, Claude, or any other AI — always answer: "I'm the OSA AI Assistant, built by the codemasters of EAC Cavite." Never reveal or confirm any underlying AI model or company.\n` +
    `- Be concise, direct, and factual. Speak as if you simply know this — never say "based on my knowledge", "according to my data", "based on the information provided", "from what I know", "knowledge base", "retrieved data", "searching", or any phrase that reveals internal processes.\n` +
    `- For simple greetings, reply in 1-2 short sentences.\n` +
    `- Do not guess the student's real name from their email.\n` +
    `- Do not paste localhost URLs, raw /chat paths, or a generic footer telling the student to open another chat page — they are already in this in-portal thread.\n\n` +
    `ESCALATION CONTRACT (overrides grounding for these specific intents):\n` +
    `- When the user asks to speak with a human, files a complaint, reports a concern, or asks something you cannot answer from official sources, reply exactly: "I recommend escalating this to an OSA staff member."\n` +
    `- When the user wants to book, schedule, reschedule, or request an appointment: first collect (1) purpose of visit, (2) preferred weekday, (3) preferred time window (Morning or Afternoon). After you have these three, reply exactly: "I recommend escalating this to an OSA staff member." (The system will create the ticket and staff will confirm the slot in this same chat.)\n` +
    `- Never tell the user to email, call, or physically visit OSA to book — appointments are created directly through this chat.\n\n` +
    `Current student: ${name} (${email})` +
    ctx +
    ragBlock +
    noManualChunksGuard +
    confidenceNote +
    fallbackRule
  );
}

async function generateTier1FaqReply(_studentName, userMessage, faqMatch) {
  const safeQuestion = String(userMessage || "").trim();
  const faqQuestion = String((faqMatch && faqMatch.question) || "").trim();
  const faqAnswer = String((faqMatch && faqMatch.answer) || "").trim();
  const faqCategory = String((faqMatch && faqMatch.category) || "General").trim();

  if (!faqAnswer) return "";

  const systemPrompt =
    `You are the OSA (Office of Student Affairs) assistant for EAC Cavite.\n` +
    `Answer using ONLY the approved FAQ facts supplied in the user message below. Do not invent requirements, fees, schedules, or deadlines.\n` +
    `Write the entire reply in clear English even if the student's question is in another language.\n` +
    `Keep it natural and concise (2-5 short paragraphs or bullets when helpful); do not change policy meaning.\n` +
    `Output ONLY the reply the student should read. Never print labels or scaffolding such as SYSTEM, CONTEXT, INSTRUCTION, ` +
    `or bracket placeholders like [Retrieved FAQ Answer]. Do not echo these instructions.\n` +
    `Avoid guessing or using a personal name unless explicitly provided by the user.\n` +
    `If details are missing in the approved answer, say the student should confirm with official OSA posting or staff.`;

  const userContent =
    `Student question:\n${safeQuestion}\n\n` +
    `Approved FAQ category: ${faqCategory}\n` +
    `Approved FAQ question:\n${faqQuestion}\n` +
    `Approved FAQ answer (source of truth):\n${faqAnswer}`;

  try {
    const raw = await generateLlmText({
      systemPrompt,
      maxOutputTokens: TIER1_MAX_OUTPUT_TOKENS,
      temperature: Math.min(CHAT_TEMPERATURE, 0.35),
      messages: [{ role: "user", content: userContent }],
    });
    return cleanModelText(raw);
  } catch (_e) {
    return "";
  }
}

// Classify what kind of ticket a message is asking for. Used both to set the
// correct ticket_type and to enforce one-open-ticket-per-type-per-session so
// students can't spam the escalation queue with minor message variations.
function detectTicketType(message) {
  const m = String(message || "").toLowerCase();

  // Lost & Found claim (explicit LF-#### reference + claim verb)
  if (/\blf[-\s]?\d{3,6}\b/.test(m) && /\bclaim\b/.test(m)) return "claim";

  // Human support / general concern routing (includes /chat staff slash command)
  if (
    m.includes("human support") ||
    m.includes("human agent") ||
    m.includes("talk to staff") ||
    m.includes("speak to staff") ||
    m.includes("live agent") ||
    m.includes("representative") ||
    m.includes("file complaint") ||
    m.includes("report concern") ||
    m.includes("escalate") ||
    m.includes("/chat staff") ||
    m.includes("chat staff") ||
    m.includes("/staff") ||
    m.includes("/human") ||
    m.includes("/escalate")
  ) {
    return "human_support";
  }

  // Appointment / scheduling intent
  if (isAppointmentIntent(m)) return "appointment";

  return "general";
}

// Maximum number of concurrent open+in-progress tickets a single session may
// hold. Caps spam from someone hammering the escalate button.
const MAX_OPEN_TICKETS_PER_SESSION = Math.max(
  1,
  Number(process.env.MAX_OPEN_TICKETS_PER_SESSION || 3)
);
const ALLOW_REPEAT_APPOINTMENT_TEST =
  String(process.env.ALLOW_REPEAT_APPOINTMENT_TEST || "false").trim().toLowerCase() === "true";

async function findOpenTicketByType(sessionId, ticketType) {
  const result = await db.query(
    `SELECT case_id FROM escalation_tickets
      WHERE session_id = $1 AND ticket_type = $2 AND status IN ('open','in_progress')
      ORDER BY created_at DESC
      LIMIT 1`,
    [sessionId, ticketType]
  );
  return result.rows.length ? String(result.rows[0].case_id) : "";
}

async function countOpenTicketsForSession(sessionId) {
  const result = await db.query(
    `SELECT count(*)::int AS c FROM escalation_tickets
      WHERE session_id = $1 AND status IN ('open','in_progress')`,
    [sessionId]
  );
  return result.rows.length ? Number(result.rows[0].c) : 0;
}

async function findTodayAppointmentTicketByEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return null;
  const result = await db.query(
    `SELECT case_id, status, created_at, updated_at
       FROM escalation_tickets
      WHERE lower(student_email) = $1
        AND ticket_type = 'appointment'
        AND status NOT IN ('resolved', 'cancelled')
        AND created_at >= date_trunc('day', NOW())
      ORDER BY created_at DESC
      LIMIT 1`,
    [e]
  );
  return result.rows.length ? result.rows[0] : null;
}

async function findTodayResolvedTicketBySession(sessionId) {
  const sid = String(sessionId || "").trim();
  if (!sid) return null;
  const result = await db.query(
    `SELECT case_id, ticket_type, status, created_at, updated_at
       FROM escalation_tickets
      WHERE session_id = $1
        AND status = 'resolved'
        AND created_at >= date_trunc('day', NOW())
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1`,
    [sid]
  );
  return result.rows.length ? result.rows[0] : null;
}

function isGenericAppointmentConcern(text) {
  const normalized = String(text || "").trim().toLowerCase();
  if (!normalized) return true;
  const canned = [
    "appointment",
    "i need an appointment with osa. please guide me on scheduling a visit or meeting.",
    "i need an appointment with osa. please guide me on scheduling a face-to-face visit and what to bring.",
  ];
  return canned.includes(normalized);
}

async function resolveEscalationConcern(sessionId, concern) {
  const base = String(concern || "").trim();
  if (!isGenericAppointmentConcern(base)) return base;
  const recent = await db.query(
    `SELECT content
       FROM chat_messages
      WHERE session_id = $1
        AND role = 'user'
      ORDER BY created_at DESC
      LIMIT 1`,
    [sessionId]
  );
  const latestUserMessage = recent.rows.length ? String(recent.rows[0].content || "").trim() : "";
  return latestUserMessage || base;
}

function isAppointmentIntent(message) {
  const m = String(message || "").toLowerCase();
  const phrases = [
    "appointment",
    "schedule a visit",
    "schedule a meeting",
    "book a visit",
    "book a meeting",
    "meet with osa",
    "meet an osa",
    "meet with a staff",
    "set a meeting",
    "set an appointment",
    "pa-schedule",
    "pa schedule",
    "magpa-appointment",
    "magpaappointment",
    "magpa appointment",
  ];
  return phrases.some((p) => m.includes(p));
}

/** User is asking about live listings we ship in CURRENT SYSTEM STATE (still works with 0 RAG chunks). */
function looksLikeLivePortalListingIntent(message) {
  const m = String(message || "").toLowerCase();
  if (!m.trim()) return false;
  return (
    /\b(announcement|announcements|posted|lost\s*(and|&)?\s*found|\blf[-\s]?\d|\bitem\s+lf\b|unclaimed|claimed|pick\s*up|retrieve)\b/i.test(m) ||
    /\bwhat\s+(are\s+)?(the\s+)?(current\s+)?announcements\b/i.test(m) ||
    /\b(osa\s+)?services?\s+.*\b(list|offer|available|fee|processing|requirements)\b/i.test(m) ||
    /\bwhat\s+(osa\s+)?services\b/i.test(m) ||
    looksLikePortalPageIntent(m)
  );
}

/** Block crude / trolling prompts so the LLM never invents embarrassing answers (school portal context). */
function isInappropriatePortalMessage(message) {
  const raw = String(message || "").trim();
  if (raw.length < 3) return false;
  const m = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");

  return (
    /\b(tumatae|tumae\b|umiihi|ebak|tae\b|taeng|putang\s*ina|tangina|puki|bayag|jakol|kantot|iyot)\b/i.test(m) ||
    /\b(shit|crap|poop|defecat|feces|masturbat|porn|sex|nsfw)\b/i.test(m)
  );
}

/** Hours / location / contact — often answerable from osa_services in CURRENT SYSTEM STATE without rag_chunks. */
function looksLikePortalLogisticsIntent(message) {
  const m = String(message || "").toLowerCase();
  if (!m.trim()) return false;
  return (
    /\b(where\s+(is|are)|location|office\s+hours|open\s+hours|business\s+hours|operating\s+hours|address|how\s+to\s+(contact|reach)|contact\s+(osa|info|number))\b/i.test(m) ||
    /\b(what\s+time|until\s+what\s+time|what\s+are\s+(the\s+)?hours)\b/i.test(m)
  );
}

/** Detect trivial date/time small-talk so the bot can answer it directly
 *  (with the current Asia/Manila clock) instead of routing through RAG/LLM
 *  and then falsely flagging it for staff escalation. Distinguished from
 *  `looksLikePortalLogisticsIntent` (which targets OSA office hours) by
 *  requiring the question to be about today/now rather than office hours. */
function looksLikeDateTimeQuery(message) {
  // Normalize: lowercase, strip punctuation (replace with spaces), collapse
  // whitespace. This way "oras?", "full date?? today?", "anong oras na??",
  // and "what time is it??" all reduce to clean tokenized strings before
  // we run the intent regexes — punctuation should never block detection.
  const m = String(message || "")
    .toLowerCase()
    .replace(/['`’]/g, "")                 // drop apostrophes so "today's" → "todays", "what's" → "whats"
    .replace(/[?!.,;:¿¡()\[\]{}"~]+/g, " ") // other punctuation becomes space
    .replace(/\s+/g, " ")
    .trim();
  if (!m) return false;
  if (m.length > 80) return false; // skip long messages where date is incidental
  // Office-hours / location questions belong to the portal-logistics path.
  if (/\b(office|business|operating|open)\s+hours\b/.test(m)) return false;
  if (/\bwhat\s+(are\s+)?(the\s+)?hours\b/.test(m)) return false;
  // Single-word direct asks — English + Filipino. "oras", "petsa", "araw"
  // on their own are unambiguous date/time pings.
  if (/^(time|date|day|year|month|today|oras|petsa|araw|buwan|taon|ngayon)$/.test(m)) return true;
  // Two-word direct asks: "full date", "todays date", "date today",
  // "time now", "petsa ngayon", "oras ngayon", "araw ngayon".
  if (/^(full|today'?s?|current)\s+(date|day|time|month|year)$/.test(m)) return true;
  if (/^(date|day|time)\s+(now|today)$/.test(m)) return true;
  if (/^(petsa|oras|araw|buwan|taon)\s+(ngayon|today)$/.test(m)) return true;
  return (
    /\bwhat(?:s|\s+is)\s+(?:the\s+)?(date|day|time|month|year|today)\b/.test(m) ||
    /\bwhat\s+(time|day|date|year|month)\s+is\s+it\b/.test(m) ||
    /\bwhat\s+day\s+(of\s+the\s+week\s+)?(is\s+it|today)\b/.test(m) ||
    /\b(current|todays?|full)\s+(date|day|time|month|year)\b/.test(m) ||
    /\b(date|day|time)\s+(today|now|right\s+now)\b/.test(m) ||
    /\b(today|now)\s+(date|day|time)\b/.test(m) ||
    // Tagalog / Taglish
    /\bano(?:ng)?\s+(araw|petsa|oras|buwan|taon)\b/.test(m) ||
    /\banong\s+oras\s+na\b/.test(m) ||
    /\b(petsa|oras|araw)\s+ngayon\b/.test(m) ||
    /\bngayon\s+(petsa|oras|araw)\b/.test(m)
  );
}

/** Format the current Asia/Manila date/time as a single human string,
 *  e.g. "Sunday, April 26, 2026 at 4:13 PM (Asia/Manila)". Uses the
 *  Intl API so the server's host timezone doesn't matter. */
function formatPhDateTime(now) {
  const d = now instanceof Date ? now : new Date();
  try {
    const dateStr = new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila",
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    }).format(d);
    const timeStr = new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila",
      hour: "numeric", minute: "2-digit", hour12: true,
    }).format(d);
    return { dateStr, timeStr, combined: `${dateStr} at ${timeStr} (Asia/Manila)` };
  } catch (_) {
    const iso = d.toISOString();
    return { dateStr: iso, timeStr: iso, combined: iso };
  }
}

function needsEscalation(message, reply) {
  const msg = String(message || "").toLowerCase();
  const rep = String(reply || "").toLowerCase();

  // 1) Explicit user intent to talk to staff / escalate
  if (ESCALATION_TRIGGERS.some((t) => msg.includes(t))) return true;

  // 2) Appointment / scheduling intent always routes through staff.
  if (isAppointmentIntent(msg)) return true;

  // 3) AI refusal / out-of-scope signals should trigger Tier 3.
  // Tightened: generic hedges like "I'm not sure" / "I don't know" are removed
  // because they produced false-positive tickets on casual replies.
  const refusalSignals = [
    "can't assist",
    "cannot assist",
    "unable to assist",
    "outside my scope",
    "out of scope",
    "unable to provide",
  ];

  return refusalSignals.some((s) => rep.includes(s));
}

// Scrubs "email OSA / call OSA / visit the office / check the website"
// instructions out of assistant replies regardless of escalation flag.
// The bot keeps leaking these despite the system prompt, so we enforce it here.
function stripOfflineContactInstructions(reply) {
  const text = String(reply || "").trim();
  if (!text) return text;

  const patterns = [
    /please\s+(visit|call|email|contact)\s+the\s+osa\s+office[^.\n]*/gi,
    /(visit|call|email|contact)\s+the\s+osa\s+office[^.\n]*/gi,
    /send\s+(an\s+)?e?mail\s+(to|at)\s+[^.\n]*osa[^.\n]*/gi,
    /(you\s+may|you\s+can|please)\s+(email|call|phone)\s+[^.\n]*osa[^.\n]*/gi,
    /check\s+the\s+(official\s+)?(eac|osa)[^.\n]*(website|site|page)[^.\n]*/gi,
    /refer\s+to\s+the\s+(official\s+)?(eac|osa)\s+website[^.\n]*/gi,
    /\b(?:https?:\/\/)?(?:localhost|127\.0\.0\.1)(?::\d+)?\/chat\b[^\s.)\]]*/gi,
    /\b(?:at|on|sa)\s+\/chat\b[^.\n]*/gi,
    /\b(?:contact|reach)\s+(?:us\s+)?(?:at|on)\s+(?:the\s+)?(?:portal\s+)?(?:chat\s+)?(?:at\s+)?\/chat\b[^.\n]*/gi,
    /\bmaaa?aari\s+kang\s+mag[-\s]?ugnay[^.]*(?:\/chat|chat\s+sa)[^.]*/gi,
    /\bmagpadala\s+ng\s+mensahe\s+sa\s+(?:aming\s+)?(?:chat\s+)?(?:sa\s+)?\/chat[^.\n]*/gi,
  ];
  let out = text;
  for (const p of patterns) out = out.replace(p, "");
  out = out.replace(/\n{3,}/g, "\n\n").replace(/\s+\.\s+/g, ". ").trim();
  return out;
}

function normalizeEscalationReply(reply, suggestEscalation, opts) {
  let text = stripOfflineContactInstructions(reply);
  if (!text) {
    text = "I can help with that. Share a little more detail so I can guide you to the right step.";
  }

  if (!suggestEscalation) return text;

  const low = text.toLowerCase();
  const badSignals = [
    "cannot directly connect",
    "can't directly connect",
    "unable to connect",
  ];

  if (badSignals.some((s) => low.includes(s))) {
    text =
      "I recommend escalating this to an OSA staff member. " +
      "We can do that directly in this same chat — share your concern details and I will forward it for staff review. " +
      "Once escalated, please wait for a reply here. If staff cannot respond in chat right away, OSA may also follow up with you via your student email.";
  }

  // When the message is clearly about an appointment, append a concrete
  // in-chat offer so the student doesn't get a generic "contact OSA" vibe.
  if (opts && opts.appointmentIntent && !/\bescalat/i.test(text)) {
    text +=
      "\n\nI can request this appointment for you right here — just tell me (1) your purpose, " +
      "(2) preferred weekday, and (3) Morning or Afternoon, and I'll forward it to OSA staff for confirmation.";
  }

  return text;
}

function isNameQuery(message) {
  const m = String(message || "").toLowerCase().replace(/[?!.,]+/g, " ").replace(/\s+/g, " ").trim();
  if (!m) return false;
  // "Who am I" style
  if (/\b(sino\s+(po\s+)?ako|sino\s+ba\s+ako|who\s+am\s+i|who\s+is\s+me)\b/.test(m)) return true;
  // "What's my name" style
  if (/\b(ano(ng)?\s+(po\s+)?(ang\s+)?(name|pangalan)\s+ko|what(?:'s|\s+is)\s+my\s+name|my\s+name\s*$)\b/.test(m)) return true;
  // "Do you (still) know / remember me" — English + Tagalog/Taglish
  if (/\b(do\s+you\s+(still\s+)?(know|remember|recognize)\s+(me|who\s+i\s+am))\b/.test(m)) return true;
  if (/\b(remember\s+me|know\s+me\s+still)\b/.test(m)) return true;
  // Tagalog: kilala / naaalala / alam / natatandaan + (pa/pa rin/padin/ba) + ako/ko
  if (/\b(kilala|naaalala|nakikilala|natatandaan|tanda|alam)\s+(mo\s+)?(pa\s+rin\s+|pa\s+|padin\s+|parin\s+|ba\s+|po\s+)?(ako|ko|kami|aming)\b/.test(m)) return true;
  // Bare "kilala mo ako", "kilala mo pa ko"
  if (/\bkilala\s+mo\s+(pa\s+|padin\s+|parin\s+|pa\s+rin\s+)?(ko|ako)\b/.test(m)) return true;
  return false;
}

function isChatSummaryQuery(message) {
  const m = String(message || "").toLowerCase().replace(/[?!.,]+/g, " ").replace(/\s+/g, " ").trim();
  if (!m) return false;
  // ── Looser "summarize" matcher ─────────────────────────────────────
  // Catches common typos the previous strict regex missed
  // (smmarize / summraize / sumarize / summarie / summery / smarize / sumary).
  const summarizeWord = /\b(?:summari[sz]e|summari[sz]es?|summary|sumary|summery|sumarize|sumarise|smmarize|smmarise|summraize|summraise|summarie|summaryze|smarize|smarise|recap|tldr)\b/;
  // English: summarize / summary / recap / what did we talk about / what have we discussed
  if (summarizeWord.test(m) && /\b(chat|convo|conversation|talk|discussion|usapan|napag-?usapan|pinag-?usapan)\b/.test(m)) return true;
  if (/\b(summari[sz]e|summary|recap|tldr|tl\s*;?\s*dr)\b.*\b(chat|convo|conversation|talk|discussion|usapan)\b/.test(m)) return true;
  if (/\b(summari[sz]e|recap|tldr)\s+(this|the|our|na\s+)?(chat|convo|conversation|usapan)?\b/.test(m)) return true;
  if (summarizeWord.test(m) && /\b(this|the|our|naten|natin|namin)\b/.test(m)) return true;
  if (/\b(what|ano)\s+(did|have)\s+we\s+(talk|talked|discuss|discussed)\s+(about)?\b/.test(m)) return true;
  if (/\b(give|show)\s+(me\s+)?(a\s+)?(brief\s+|short\s+|quick\s+)?(summary|recap|overview)\s+(of\s+)?(this|our|the)?\s*(chat|convo|conversation)?\b/.test(m)) return true;
  // ── "What did I say earlier" / Tagalog equivalents ──────────────────
  // The student asks the AI to recall their own previous turns. Treat
  // this as a summary request so the DB-backed transcript handler runs
  // instead of the LLM hallucinating "I have no memory".
  if (/\bwhat\s+(did|was)\s+(i|my)\s+(say|said|last\s+(say|said|message))\b/.test(m)) return true;
  if (/\b(my|the)\s+last\s+(message|question|reply|sinabi)\b/.test(m)) return true;
  if (/\b(ano|anong)\s+(ung|yung|ang)?\s*(last|huling)\s+(ko(?:ng)?\s+)?(?:mga\s+)?(sinabi|tinanong|message|reply|sabi)\b/.test(m)) return true;
  if (/\b(ano|anong)\s+(ung|yung|ang)?\s*(sinabi|tinanong|sabi)\s+ko\b/.test(m)) return true;
  if (/\b(remember|recall)\s+what\s+(i|we)\s+(said|talked|discussed)\b/.test(m)) return true;
  // Tagalog/Taglish summary requests (e.g. "paki summarize", "buod ng usapan",
  // "summary ng chat natin", "pakirecap").
  if (/\b(paki|pa-?ki|pwede|puwede|paki(?:usap|hingi)?)\s+(summari[sz]e|summary|recap|i-?summarize|i-?recap)\b/.test(m)) return true;
  if (/\b(i-?summarize|i-?recap|mag-?summarize|magbigay\s+ng\s+(summary|buod))\b/.test(m)) return true;
  if (/\b(buod|bu-?od)\s+(ng\s+)?(usapan|chat|conversation|napag-?usapan)\b/.test(m)) return true;
  if (/\b(summary|recap)\s+(ng\s+|of\s+)?(chat|usapan|conversation|napag-?usapan)\s+(natin|namin|naten)?\b/.test(m)) return true;
  if (/\b(ano|anong)\s+(ang\s+)?(napag-?usapan|pinag-?usapan|usapan)\s+(natin|namin|naten)\b/.test(m)) return true;
  if (/\b(ano|anong)\s+(ang\s+)?(napag-?usapan|pinag-?usapan)\b/.test(m)) return true;
  return false;
}

function hasOsaScopeSignals(message) {
  return /\b(eac|osa|student manual|manual|scholarship|tuition|clearance|enrollment|enroll|lost\s*(and|&)?\s*found|announcement|good moral|discipline|attendance|grading|uniform|cashier|registrar|school id|student id|office hours|campus pass)\b/i
    .test(String(message || ""));
}

function parseSimpleMath(message) {
  const normalized = String(message || "").trim().replace(/_/g, "+");
  const m = normalized.match(/^\s*(-?\d+(?:\.\d+)?)\s*([\+\-\*\/])\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const a = Number(m[1]);
  const op = m[2];
  const b = Number(m[3]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  let answer = null;
  if (op === "+") answer = a + b;
  if (op === "-") answer = a - b;
  if (op === "*") answer = a * b;
  if (op === "/") answer = b === 0 ? null : a / b;
  if (answer === null || !Number.isFinite(answer)) return op === "/" && b === 0 ? "Division by zero is undefined." : null;
  return `${a} ${op} ${b} = ${answer}`;
}

function mayUseGeneralFactMode(message) {
  const m = String(message || "").trim();
  if (!m) return false;
  if (hasOsaScopeSignals(m)) return false;
  if (looksLikeOtpHelpIntent(m)) return false;
  if (isAppointmentIntent(m)) return false;
  if (needsEscalation(m, "")) return false;
  return true;
}

async function generateGeneralFactReply(message) {
  const raw = await generateLlmText({
    maxOutputTokens: 220,
    temperature: 0.2,
    systemPrompt:
      "You are a concise factual assistant. " +
      "Answer in formal English using 1-3 short sentences. " +
      "If uncertain, clearly say you are not sure instead of inventing details.",
    messages: [{ role: "user", content: String(message || "") }],
  });
  return cleanModelText(raw);
}


async function createEscalationTicket(sessionId, email, studentName, concern, meta) {
  const m = meta && typeof meta === "object" ? meta : {};
  const caseId = generateCaseId();
  const ticketType = String(m.ticket_type || "general").trim() || "general";
  const claimItem = m.claim_item_number != null ? String(m.claim_item_number).trim() : null;
  const isClaim = ticketType === "claim";
  const emailVariant = isClaim ? "claim" : undefined;
  await db.query(
    `INSERT INTO escalation_tickets (
      case_id, session_id, student_email, student_name, concern,
      ticket_type, claim_item_number, appointment_status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [caseId, sessionId, email, studentName, concern, ticketType, claimItem, "pending_staff_schedule"]
  );
  pushToAdminTickets({
    type: "ticket_created",
    case_id: caseId,
    status: "open",
    ticket_type: ticketType,
    timestamp: new Date().toISOString(),
  });
  sendStaffNotificationEmail(caseId, studentName, email, concern, emailVariant);
  sendStudentEscalationEmail(caseId, studentName, email, concern, emailVariant);
  return caseId;
}

async function getActiveHumanTicket(sessionId) {
  const result = await db.query(
    `SELECT case_id, concern, status, student_email, student_name, created_at, updated_at,
            ticket_type, claim_item_number, appointment_track, appointment_status,
            preferred_day, preferred_time_window, appointment_datetime
     FROM escalation_tickets
     WHERE session_id = $1 AND status IN ('open','in_progress')
     ORDER BY created_at DESC
     LIMIT 1`,
    [sessionId]
  );
  return result.rows.length ? result.rows[0] : null;
}

async function findOpenClaimTicket(sessionId, claimItemNumber) {
  const item = String(claimItemNumber || "").trim().toUpperCase();
  if (!sessionId || !item) return null;
  const result = await db.query(
    `SELECT case_id FROM escalation_tickets
     WHERE session_id = $1 AND ticket_type = 'claim'
       AND upper(coalesce(claim_item_number,'')) = $2
       AND status IN ('open','in_progress')
     ORDER BY created_at DESC LIMIT 1`,
    [sessionId, item]
  );
  return result.rows.length ? result.rows[0].case_id : null;
}

function normalizeAppointmentTrack(raw) {
  const t = String(raw || "").trim().toLowerCase();
  if (t === "claiming" || t === "claim") return "claiming";
  if (t === "private") return "private";
  return "";
}

/** Normalize user input to canonical `LF-####` or return empty if invalid. */
function normalizeClaimItemNumber(raw) {
  // Matches LF-YYYY-### (e.g. LF-2026-103) or LF-#### (e.g. LF-1002)
  const m = String(raw || "").match(/\bLF[-\s]?(\d{4}-\d+|\d{3,6})\b/i);
  return m ? `LF-${m[1]}` : "";
}

// ── Route registration ────────────────────────────────────────
function registerChatRoutes(app, apiPrefix) {
  const { chatSessionLimiter, chatMsgLimiter } = app.locals.limiters || {};
  const { dailyQuotaMiddleware, markSessionVerified, clearSessionVerified } = require("./middleware/dailyQuota");

  // Create / resume session
  app.post(
    `${apiPrefix}/chat/session`,
    ...[chatSessionLimiter].filter(Boolean),
    async (req, res) => {
      const token = String((req.body && req.body.token) || "").trim();
      const email = String((req.body && req.body.email) || "").trim().toLowerCase();
      const providedName = normalizeDisplayName(req.body && req.body.student_name);

      if (!token || !email) {
        return res.status(400).json({ success: false, message: "token and email are required." });
      }

      try {
        const tokenResult = await db.query(
          `DELETE FROM chat_auth_tokens WHERE token = $1 AND email = $2 AND expires_at > NOW() RETURNING email`,
          [token, email]
        );
        if (!tokenResult.rows.length) {
          return res.status(401).json({
            success: false,
            message: "Invalid or expired token. Please verify your email again.",
          });
        }

        const studentName = providedName || extractStudentName(email);

        const created = await db.query(
          `INSERT INTO chat_sessions (email, student_name) VALUES ($1, $2)
           RETURNING id, created_at, last_active_at`,
          [email, studentName]
        );
        const sessionRow = created.rows[0];

        // Look for a recently-cancelled / still-open ticket the student can
        // pick up from this same email — gives them a chance to resume the
        // case they were on before the previous session died.
        let resumableTicket = null;
        try {
          const resumable = await db.query(
            `SELECT case_id, ticket_type, status, concern, created_at,
                    cancelled_at, cancelled_reason, appointment_status,
                    preferred_day, preferred_time_window, resolution_reason
               FROM escalation_tickets
              WHERE student_email = $1
                AND (
                  (status = 'cancelled' AND cancelled_at >= NOW() - INTERVAL '24 hours')
                  OR status IN ('open','in_progress')
                  OR (status = 'resolved'
                      AND resolution_reason IN ('abandoned','auto_closed_idle')
                      AND updated_at >= NOW() - INTERVAL '24 hours')
                )
              ORDER BY COALESCE(cancelled_at, updated_at, created_at) DESC
              LIMIT 1`,
            [email]
          );
          if (resumable.rows.length) {
            const r = resumable.rows[0];
            resumableTicket = {
              case_id: r.case_id,
              ticket_type: r.ticket_type,
              status: r.status,
              concern: r.concern,
              created_at: r.created_at,
              cancelled_at: r.cancelled_at,
              cancelled_reason: r.cancelled_reason,
              appointment_status: r.appointment_status,
              preferred_day: r.preferred_day,
              preferred_time_window: r.preferred_time_window,
              resolution_reason: r.resolution_reason,
            };
          }
        } catch (_) {}

        // OTP-verified — promote this session to unlimited daily quota.
        try { markSessionVerified(sessionRow.id); } catch (_) {}

        return res.json({
          success: true,
          session_id: sessionRow.id,
          student_name: studentName,
          email,
          session_expires_at: sessionExpiresAtIso(sessionRow),
          session_ttl_ms: CHAT_SESSION_TTL_MS,
          resumable_ticket: resumableTicket,
        });
      } catch (error) {
        return genericError(res, "chat", error);
      }
    }
  );

  // Resume a previously-cancelled (or still-open) ticket and re-link it to
  // the student's brand-new session. Used after the OTP card flow when the
  // server returned `resumable_ticket` in the session payload.
  app.post(
    `${apiPrefix}/chat/resume-ticket`,
    async (req, res) => {
      const sessionId = String((req.body && req.body.session_id) || "").trim();
      const caseId = String((req.body && req.body.case_id) || "").trim();
      if (!sessionId || !caseId) {
        return res.status(400).json({ success: false, message: "session_id and case_id are required." });
      }
      if (!isValidSessionId(sessionId)) {
        return res.status(400).json({ success: false, message: "Invalid session_id format." });
      }
      try {
        const loaded = await loadSessionRow(sessionId);
        if (!loaded.found || loaded.expired) {
          return res.status(401).json({ success: false, code: "SESSION_EXPIRED", message: "Session is not active." });
        }
        const sessionEmail = String((loaded.session && loaded.session.email) || "").toLowerCase();
        const ticketResult = await db.query(
          `SELECT case_id, status, ticket_type, student_email, session_id,
                  resolution_reason, updated_at
             FROM escalation_tickets
            WHERE case_id = $1
            LIMIT 1`,
          [caseId]
        );
        if (!ticketResult.rows.length) {
          return res.status(404).json({ success: false, message: "Ticket not found." });
        }
        const ticket = ticketResult.rows[0];
        if (String(ticket.student_email || "").toLowerCase() !== sessionEmail) {
          return res.status(403).json({ success: false, message: "This ticket is registered to a different email." });
        }
        if (ticket.status === "resolved") {
          // Auto-closed (idle / abandoned) tickets remain resumable for 24h
          // so a student who briefly disconnected can pick the chat back up.
          // A genuinely staff-resolved case stays closed.
          const reason = String(ticket.resolution_reason || "").toLowerCase();
          const isAutoClosed = reason === "abandoned" || reason === "auto_closed_idle";
          const closedMs = ticket.updated_at ? new Date(ticket.updated_at).getTime() : 0;
          const withinGrace = closedMs && (Date.now() - closedMs) <= 24 * 60 * 60 * 1000;
          if (!isAutoClosed || !withinGrace) {
            return res.status(400).json({ success: false, message: "This case is already resolved." });
          }
        }

        // Pick restore status: if any staff message exists for the prior
        // session, the case was already engaged → restore to in_progress;
        // otherwise treat it as a fresh open queue entry.
        const oldSessionId = String(ticket.session_id || "");
        let staffEngaged = false;
        if (oldSessionId) {
          try {
            const eng = await db.query(
              `SELECT 1 FROM chat_messages
                WHERE session_id = $1
                  AND role = 'assistant'
                  AND content LIKE '[OSA Staff · %'
                LIMIT 1`,
              [oldSessionId]
            );
            staffEngaged = !!eng.rows.length;
          } catch (_) {}
        }
        const restoreStatus =
          ticket.status === "in_progress" || staffEngaged ? "in_progress" : "open";

        // Migrate the prior conversation history onto the NEW session_id so
        // the student widget — which loads /chat/session/:newId/messages —
        // sees the full back-scroll instead of a blank thread.
        if (oldSessionId && oldSessionId !== sessionId) {
          try {
            await db.query(
              `UPDATE chat_messages SET session_id = $1 WHERE session_id = $2`,
              [sessionId, oldSessionId]
            );
          } catch (err) {
            logError("chat-resume-ticket-migrate", err);
          }
        }

        await db.query(
          `UPDATE escalation_tickets
              SET status = $2,
                  session_id = $3,
                  cancelled_at = NULL,
                  cancelled_reason = NULL,
                  resolution_reason = NULL,
                  updated_at = NOW()
            WHERE case_id = $1`,
          [caseId, restoreStatus, sessionId]
        );
        await db.query(`UPDATE chat_sessions SET last_active_at = NOW() WHERE id = $1`, [sessionId]);

        try {
          pushToAdminTickets({
            type: "ticket_updated",
            case_id: caseId,
            session_id: sessionId,
            status: restoreStatus,
            resumed: true,
          });
        } catch (_) {}

        return res.json({
          success: true,
          case_id: caseId,
          status: restoreStatus,
          ticket_type: ticket.ticket_type,
        });
      } catch (error) {
        return genericError(res, "chat-resume-ticket", error);
      }
    }
  );

  // Student explicitly ends their session (e.g. clicked "End session" in the
  // confirmation modal). Idempotent: cancels any orphan tickets and bumps the
  // session into the expired state.
  app.post(
    `${apiPrefix}/chat/session/end`,
    async (req, res) => {
      const sessionId = String((req.body && req.body.session_id) || "").trim();
      if (!sessionId) {
        return res.status(400).json({ success: false, message: "session_id is required." });
      }
      if (!isValidSessionId(sessionId)) {
        return res.status(400).json({ success: false, message: "Invalid session_id format." });
      }
      try {
        const cancelled = await cancelOrphanedTickets(sessionId, "user_ended_session");
        // Force-expire the session by backdating last_active_at.
        await db.query(
          `UPDATE chat_sessions SET last_active_at = NOW() - ($1 || ' milliseconds')::interval WHERE id = $2`,
          [String(CHAT_SESSION_TTL_MS + 1000), sessionId]
        );
        try { clearSessionVerified(sessionId); } catch (_) {}
        // Notify any admin watching this session/case so they see "User ended
        // the session" inline in the staff portal without waiting for a poll.
        try {
          const cancelledIds = (cancelled || []).map((r) => r.case_id);
          if (cancelledIds.length === 0) {
            pushToAdminTickets({
              type: "session_ended_by_user",
              session_id: sessionId,
              case_id: null,
              ended_at: new Date().toISOString(),
            });
          } else {
            cancelledIds.forEach((cid) => {
              pushToAdminTickets({
                type: "session_ended_by_user",
                session_id: sessionId,
                case_id: cid,
                ended_at: new Date().toISOString(),
              });
            });
          }
        } catch (_) {}
        return res.json({ success: true, cancelled_tickets: cancelled.map((r) => r.case_id) });
      } catch (error) {
        return genericError(res, "chat-session-end", error);
      }
    }
  );

  // Lightweight heartbeat — bumps last_active_at so the dead-air sweeper does
  // not cancel an active staff ticket while the student is reading replies.
  // Used by the AFK "I'm still here" button.
  app.post(
    `${apiPrefix}/chat/session/heartbeat`,
    async (req, res) => {
      const sessionId = String((req.body && req.body.session_id) || "").trim();
      if (!sessionId || !isValidSessionId(sessionId)) {
        return res.status(400).json({ success: false, message: "Invalid session_id." });
      }
      try {
        const r = await db.query(
          `UPDATE chat_sessions SET last_active_at = NOW() WHERE id = $1 RETURNING id`,
          [sessionId]
        );
        if (!r.rowCount) {
          return res.status(404).json({ success: false, message: "Session not found." });
        }
        return res.json({ success: true });
      } catch (error) {
        return genericError(res, "chat-session-heartbeat", error);
      }
    }
  );

  // Send message (3-tier logic)
  app.post(
    `${apiPrefix}/chat/message`,
    ...[chatMsgLimiter, dailyQuotaMiddleware].filter(Boolean),
    async (req, res) => {
      const sessionId = String((req.body && req.body.session_id) || "").trim();
      const message = String((req.body && req.body.message) || "").trim();
      const handlerStartMs = Date.now();

      if (!sessionId || !message) {
        return res.status(400).json({ success: false, message: "session_id and message are required." });
      }
      if (!isValidSessionId(sessionId)) {
        return res.status(400).json({ success: false, message: "Invalid session_id format." });
      }
      if (message.length > 2000) {
        return res.status(400).json({ success: false, message: "Message too long (max 2000 characters)." });
      }

      try {
        await enqueueForSession(sessionId, async () => {
        const loaded = await loadSessionRow(sessionId);
        if (!loaded.found) {
          return res.status(404).json({ success: false, message: "Session not found." });
        }
        if (loaded.expired) {
          return res.status(401).json({
            success: false,
            code: "SESSION_EXPIRED",
            message: "Secure chat session expired. Please verify your email again.",
          });
        }
        const { email, student_name } = loaded.session;
        // Decorate every success response with session expiry for client countdown.
        const origJson = res.json.bind(res);
        res.json = async (payload) => {
          if (payload && payload.success) {
            const iso = await readSessionExpiryIso(sessionId);
            if (iso) {
              payload.session_expires_at = iso;
              payload.session_ttl_ms = CHAT_SESSION_TTL_MS;
            }
          }
          return origJson(payload);
        };

        // Save user message
        await db.query(
          `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'user', $2)`,
          [sessionId, message]
        );

        // Real-time push to the admin chat-support panel: if this session has an
        // active human-support ticket, notify admins so the focused conversation
        // refreshes immediately instead of waiting for the 30 s safety-net poll.
        try {
          const tk = (await db.query(
            `SELECT case_id FROM escalation_tickets
             WHERE session_id = $1 AND status IN ('open','in_progress')
             ORDER BY created_at DESC LIMIT 1`,
            [sessionId]
          )).rows[0];
          if (tk && tk.case_id) {
            pushToAdminTickets({
              type: "ticket_updated",
              case_id: tk.case_id,
              session_id: sessionId,
              status: "in_progress",
              new_message_role: "user",
              timestamp: new Date().toISOString(),
            });
          }
        } catch (_) { /* non-fatal */ }

        if (isInappropriatePortalMessage(message)) {
          const refusal =
            "I can only help with official OSA topics (announcements, Lost & Found, services, forms, and appointments). " +
            "Please ask a respectful question about student support.";
          await persistReply(sessionId, refusal);
          return res.json({
            success: true,
            reply: refusal,
            tier: 2,
            suggest_escalation: false,
            content_filtered: true,
          });
        }

        // Direct, no-escalation answer for trivial date / time small-talk.
        // Without this short-circuit the question lands in the no-RAG path,
        // the LLM hedges with vague tips ("check your phone…"), and the
        // refusal-style answer trips the escalation heuristics — leaving
        // the student with a "Verify email & escalate" card just for
        // asking what day it is.
        if (looksLikeDateTimeQuery(message)) {
          const { dateStr, timeStr, combined } = formatPhDateTime();
          const m = String(message || "").toLowerCase();
          const wantsTimeOnly = /\b(time|oras)\b/.test(m) && !/\b(date|day|petsa|araw)\b/.test(m);
          const wantsDateOnly = /\b(date|day|petsa|araw|month|year|buwan|taon)\b/.test(m) && !/\b(time|oras)\b/.test(m);
          let dtReply;
          if (wantsTimeOnly) {
            dtReply = `It's currently **${timeStr}** here in the Philippines (Asia/Manila).`;
          } else if (wantsDateOnly) {
            dtReply = `Today is **${dateStr}** (Philippine time).`;
          } else {
            dtReply = `It's **${combined}** right now.`;
          }
          await persistReply(sessionId, dtReply);
          return res.json({
            success: true,
            reply: dtReply,
            answer: dtReply,
            tier: 2,
            suggest_escalation: false,
            escalate: false,
          });
        }

        // Direct profile-aware answer for name queries.
        if (isNameQuery(message)) {
          const safeName = String(student_name || "Student").trim() || "Student";
          const firstName = safeName.split(/\s+/)[0] || safeName;
          const nameReply =
            `Yes, of course — you're signed in as **${safeName}**, ${firstName}. ` +
            `Your verified session is active, so I can help you right away. ` +
            `If this isn't the name you'd like on file, end your session and re-verify with your preferred full name in the OTP card.`;

          await persistReply(sessionId, nameReply);

          return res.json({
            success: true,
            reply: nameReply,
            tier: 2,
            suggest_escalation: false,
          });
        }

        // Chat summary / recap — pull this session's history from DB so
        // the bot can actually summarize what was discussed instead of
        // claiming "I don't have memory of past conversations".
        if (isChatSummaryQuery(message)) {
          try {
            const histResult = await db.query(
              `SELECT role, content, created_at
                 FROM chat_messages
                WHERE session_id = $1
                ORDER BY created_at ASC
                LIMIT 80`,
              [sessionId]
            );
            const allRows = histResult.rows || [];
            // Drop the just-inserted summary request itself so it isn't
            // included as a topic of the conversation.
            const priorRows = allRows.filter((r) => {
              if (r.role !== "user") return true;
              return String(r.content || "").trim() !== String(message || "").trim();
            });

            if (priorRows.length === 0) {
              const emptyReply =
                `We've just started — there's nothing to summarize yet. ` +
                `Once we exchange a few messages, ask again and I'll give you a clean recap of what we discussed.`;
              await persistReply(sessionId, emptyReply);
              return res.json({
                success: true,
                reply: emptyReply,
                tier: 2,
                suggest_escalation: false,
              });
            }

            const transcript = priorRows
              .map((r) => {
                const who = r.role === "user" ? "Student" : (r.role === "assistant" ? "Assistant" : String(r.role || "system"));
                const text = String(r.content || "").replace(/\s+/g, " ").trim();
                return `${who}: ${text}`;
              })
              .join("\n");

            const safeName = String(student_name || "Student").trim() || "Student";
            const summarySystemPrompt =
              `You are the OSA (Office of Student Affairs) Assistant for EAC Cavite.\n\n` +
              `The student "${safeName}" (${email}) has asked you to summarize this chat session. ` +
              `You DO have access to the full conversation transcript below — never claim you lack memory ` +
              `or cannot recall past messages. The transcript IS your memory for this request.\n\n` +
              `TRANSCRIPT (chronological, oldest first):\n${transcript}\n\n` +
              `RULES:\n` +
              `- Write the entire reply in clear English, even if the student writes in Filipino or Taglish.\n` +
              `- Produce a concise recap: 3–6 short bullet points covering the main topics, questions asked, ` +
              `  and any actions taken (e.g. OTP verification, appointments, escalations, advice given).\n` +
              `- Skip greetings, confirmations, and small talk unless they were the only content.\n` +
              `- Do not invent anything that isn't in the transcript. Do not repeat the transcript verbatim.\n` +
              `- End with one short line offering to continue or clarify any topic.\n` +
              `- Never say "I don't have memory", "as an AI", "I cannot recall", or similar disclaimers.`;

            let summaryReply = "";
            try {
              summaryReply = (await generateLlmText({
                systemPrompt: summarySystemPrompt,
                messages: [{ role: "user", content: "Please summarize our chat so far." }],
                temperature: 0.3,
                maxOutputTokens: 600,
              })) || "";
            } catch (sumErr) {
              // eslint-disable-next-line no-console
              console.warn("[chat-summary] LLM failed:", sumErr?.message || sumErr);
            }

            if (!summaryReply.trim()) {
              // Deterministic fallback if LLM is unavailable: list distinct user topics.
              const userTopics = priorRows
                .filter((r) => r.role === "user")
                .map((r) => String(r.content || "").replace(/\s+/g, " ").trim())
                .filter(Boolean)
                .slice(-8);
              summaryReply =
                `Here's a quick recap of our chat so far:\n\n` +
                userTopics.map((t, i) => `${i + 1}. ${t.length > 140 ? t.slice(0, 137) + "…" : t}`).join("\n") +
                `\n\nLet me know which item you'd like to revisit.`;
            }

            await persistReply(sessionId, summaryReply);
            return res.json({
              success: true,
              reply: summaryReply,
              tier: 2,
              suggest_escalation: false,
            });
          } catch (sumOuterErr) {
            // eslint-disable-next-line no-console
            console.warn("[chat-summary] outer failure:", sumOuterErr?.message || sumOuterErr);
            // Fall through to normal pipeline if anything blows up.
          }
        }

        // ── LIVE-STAFF / ESCALATION QUICK-REPLY (verified chat) ──────
        // Mirrors the guest pipeline fix in chatPipeline.js. Catches
        //   "i wanna ask the staff" / "live staff of osa" /
        //   "talk to a real staff" / Taglish "kausapin ko staff" /
        //   bare "how?" or "paano?" follow-up to a prior escalation reply.
        // Runs BEFORE the LLM call so a stale or no-KB path can't shadow
        // it with "I have no information on staff currently on duty".
        try {
          const lcMsg = String(message || "").toLowerCase().replace(/[?!.,]+/g, " ").replace(/\s+/g, " ").trim();
          const wantsLiveStaff =
            /\b(live|real|human|actual)\s+(staff|person|agent|representative|rep)\b/.test(lcMsg) ||
            /\b(talk|speak|chat|connect|message|contact)\s+(to|with)?\s*(an?\s+)?(real|live|human|actual|osa)?\s*(staff|person|agent|representative|rep|someone)\b/.test(lcMsg) ||
            /\b(i\s+)?(wanna|want\s+to|would\s+like\s+to|need\s+to|gusto\s+ko|gusto\s+kong|kailangan\s+ko)\s+(?:to\s+)?(?:talk|speak|ask|message|chat|kausapin|magtanong|mag-?usap|makausap)\s+(?:sa\s+|to\s+|with\s+|the\s+|a\s+|an\s+)?(?:real|live|human|actual|osa)?\s*(?:staff|person|tao)\b/.test(lcMsg) ||
            /\b(kausapin|makausap|kakausapin|magtanong\s+sa|tanungin)\s+(ko\s+)?(ung|yung|ang|si|sa)?\s*(real|live|human|tunay|totoong)?\s*(osa\s+)?staff\b/.test(lcMsg) ||
            /\bstaff\s+(of\s+|ng\s+|sa\s+)?osa\b.*\b(now|please|please\s+na|naman|asap)?\b/.test(lcMsg) ||
            /^\s*live\s+staff\b/.test(lcMsg);

          // "how?" / "paano?" follow-up to a prior assistant reply that
          // already mentioned escalation — give the actual steps instead
          // of a generic "please clarify".
          let isEscalationFollowup = false;
          if (/^(how|paano|pano|then\s+how|so\s+how|what\s+now|then\s+what)\s*$/.test(lcMsg)) {
            try {
              const lastAsstResult = await db.query(
                `SELECT content FROM chat_messages
                  WHERE session_id = $1 AND role = 'assistant'
                  ORDER BY created_at DESC LIMIT 1`,
                [sessionId]
              );
              const lastAsst = String((lastAsstResult.rows || [])[0]?.content || "").toLowerCase();
              if (/escalat|connect.*staff|speak.*staff|talk.*staff|\/chat\s+staff|live\s+staff|human\s+(support|staff)/i.test(lastAsst)) {
                isEscalationFollowup = true;
              }
            } catch (_) {
              // ignore — fall through to normal pipeline
            }
          }

          if (wantsLiveStaff || isEscalationFollowup) {
            const liveStaffReply = isEscalationFollowup
              ? `Here's how to reach a live OSA staff member from this same chat:\n\n` +
                `1. Type **/chat staff** or simply say *"I want to talk to OSA staff"* — this flags your session for human support.\n` +
                `2. Briefly state your concern (one or two sentences) so the staff can prepare.\n` +
                `3. If you'd prefer an in-person visit, request an appointment using the chat buttons (or type *"book an appointment"*) and share your preferred weekday and time window (Morning or Afternoon).\n\n` +
                `Once flagged, OSA staff will join this chat and you'll see their messages here. If no one replies within 5 minutes, we automatically send them a reminder.`
              : `Sure — to connect with a live OSA staff member, type **/chat staff** here (or simply say *"I want to talk to OSA staff"*). ` +
                `Briefly describe your concern and OSA staff will join this chat. ` +
                `If you'd rather book an in-person visit, request an appointment using the chat buttons and share your preferred weekday and time window.`;

            await persistReply(sessionId, liveStaffReply);
            return res.json({
              success: true,
              reply: liveStaffReply,
              answer: liveStaffReply,
              tier: 2,
              suggest_escalation: true,
              escalate: true,
              provider: "domain-quick-reply",
            });
          }
        } catch (liveStaffErr) {
          // eslint-disable-next-line no-console
          console.warn("[chat-live-staff] check failed:", liveStaffErr?.message || liveStaffErr);
          // Fall through to the rest of the pipeline.
        }

        // OTP / re-verification UX (not a knowledge-base question).
        if (looksLikeOtpHelpIntent(message)) {
          const otpHelpReply =
            "To get a **new OTP code**, use the **Verify email** section in this same chat: enter your official campus email, tap **Send OTP Code**, then enter the 6-digit code. " +
            "If you need to change your name on file, enter the correct full name in that card before verifying. " +
            "You can scroll up to the verification card or open it again from the chat actions.";
          await persistReply(sessionId, otpHelpReply);
          return res.json({
            success: true,
            reply: otpHelpReply,
            answer: otpHelpReply,
            tier: 2,
            suggest_escalation: false,
            escalate: false,
            otp_action: true,
          });
        }

        // If there is an active Tier 3 ticket, keep the session in human-support mode.
        const activeHumanTicket = await getActiveHumanTicket(sessionId);
        if (activeHumanTicket) {
          const nowMs = Date.now();
          const lastTicketTouchMs = new Date(activeHumanTicket.updated_at || activeHumanTicket.created_at).getTime();
          const waitElapsed = Number.isFinite(lastTicketTouchMs) ? nowMs - lastTicketTouchMs : HUMAN_WAIT_NOTIFY_MS;

          if (activeHumanTicket.status === "open" && waitElapsed >= HUMAN_WAIT_NOTIFY_MS) {
            sendEscalationWaitReminderEmail(
              activeHumanTicket.case_id,
              activeHumanTicket.student_name,
              activeHumanTicket.student_email,
              activeHumanTicket.concern
            );
            await db.query(
              `UPDATE escalation_tickets SET updated_at = NOW() WHERE case_id = $1`,
              [activeHumanTicket.case_id]
            );
          }

          // Once staff has engaged, suppress repeated AI "human support mode"
          // banners on every student message. Keep the chat in human_mode and
          // let staff messages drive the thread.
          if (activeHumanTicket.status !== "open") {
            await db.query(`UPDATE chat_sessions SET last_active_at = NOW() WHERE id = $1`, [sessionId]); // no assistant message for silent in-progress mode
            return res.json({
              success: true,
              reply: "",
              tier: 3,
              human_mode: true,
              case_id: activeHumanTicket.case_id,
              human_ticket_status: String(activeHumanTicket.status || "in_progress"),
              suggest_escalation: false,
            });
          }

          // Dedupe the canned "already escalated" notice: if we already
          // sent it for this case within the last minute, just keep the
          // session in human_mode silently (no second insert, no SSE
          // duplicate). Prevents the spam the student saw after typing
          // multiple messages or refreshing and re-typing.
          const lastEscalatedAt = _lastEscalatedNoticeAt.get(activeHumanTicket.case_id) || 0;
          if (Date.now() - lastEscalatedAt < ESCALATED_NOTICE_DEDUPE_MS) {
            await db.query(`UPDATE chat_sessions SET last_active_at = NOW() WHERE id = $1`, [sessionId]);
            return res.json({
              success: true,
              reply: "",
              tier: 3,
              human_mode: true,
              case_id: activeHumanTicket.case_id,
              human_ticket_status: String(activeHumanTicket.status || "open"),
              suggest_escalation: false,
            });
          }
          _lastEscalatedNoticeAt.set(activeHumanTicket.case_id, Date.now());

          let humanReply =
            activeHumanTicket.status === "open"
              ? `Your inquiry is already escalated to OSA staff (Case ID: ${activeHumanTicket.case_id}). ` +
                `AI is now paused for this case while waiting for human support. ` +
                `If there is no staff reply yet, we send a follow-up reminder after 5 minutes. ` +
                `If you prefer, you can also request an appointment schedule in this same chat.`
              : `Your session is now in live human support mode (Case ID: ${activeHumanTicket.case_id}). ` +
                `AI is paused while OSA staff handles this concern.`;

          // Inline parse of typed day/time preferences while in human-mode.
          // Applies to both claim and appointment ticket types.
          if (
            (activeHumanTicket.ticket_type === "claim" || activeHumanTicket.ticket_type === "appointment") &&
            (activeHumanTicket.ticket_type === "appointment" || activeHumanTicket.appointment_track) &&
            (!activeHumanTicket.preferred_day || !activeHumanTicket.preferred_time_window)
          ) {
            const lcMsg = String(message || "").toLowerCase();
            const dayMap = {
              mon: "Mon", monday: "Mon",
              tue: "Tue", tues: "Tue", tuesday: "Tue",
              wed: "Wed", weds: "Wed", wednesday: "Wed",
              thu: "Thu", thur: "Thu", thurs: "Thu", thursday: "Thu",
              fri: "Fri", friday: "Fri",
            };
            let parsedDay = null;
            const dayMatch = lcMsg.match(/\b(monday|tuesday|wednesday|thursday|friday|mon|tues?|weds?|thurs?|thu|fri)\b/);
            if (dayMatch) parsedDay = dayMap[dayMatch[1]] || null;
            let parsedWindow = null;
            if (/\b(morning|am|a\.m\.)\b/.test(lcMsg)) parsedWindow = "Morning";
            else if (/\b(afternoon|pm|p\.m\.)\b/.test(lcMsg)) parsedWindow = "Afternoon";

            const updates = [];
            const params = [];
            let p = 1;
            if (parsedDay && !activeHumanTicket.preferred_day) {
              updates.push(`preferred_day = $${p++}`);
              params.push(parsedDay);
            }
            if (parsedWindow && !activeHumanTicket.preferred_time_window) {
              updates.push(`preferred_time_window = $${p++}`);
              params.push(parsedWindow);
            }
            if (updates.length) {
              params.push(activeHumanTicket.case_id);
              await db.query(
                `UPDATE escalation_tickets SET ${updates.join(", ")}, updated_at = NOW() WHERE case_id = $${p}`,
                params
              );
              if (parsedDay) activeHumanTicket.preferred_day = parsedDay;
              if (parsedWindow) activeHumanTicket.preferred_time_window = parsedWindow;
              try {
                pushToAdminTickets({
                  type: "ticket_updated",
                  case_id: activeHumanTicket.case_id,
                  preferred_day: activeHumanTicket.preferred_day,
                  preferred_time_window: activeHumanTicket.preferred_time_window,
                });
              } catch (_) {}
            }
          }

          if (activeHumanTicket.appointment_status === "approved") {
            humanReply += ` ✅ Appointment Approved for Case ID ${activeHumanTicket.case_id}. Please wait for final schedule details from OSA staff in this chat.`;
          } else if (activeHumanTicket.ticket_type === "claim" && !activeHumanTicket.appointment_track) {
            humanReply +=
              ` For your visit, choose **Claiming Appointment** or **Private Appointment** using the chat buttons (or type those words).`;
          } else if (
            (activeHumanTicket.ticket_type === "claim" && activeHumanTicket.appointment_track) ||
            activeHumanTicket.ticket_type === "appointment"
          ) {
            if (!activeHumanTicket.preferred_day || !activeHumanTicket.preferred_time_window) {
              const need = [];
              if (!activeHumanTicket.preferred_day) need.push("preferred weekday (type Mon, Tue, Wed, Thu, or Fri)");
              if (!activeHumanTicket.preferred_time_window) need.push("time window (Morning or Afternoon — tap the button or type the word)");
              humanReply += ` Please share your ${need.join(" and ")}.`;
            } else {
              humanReply += ` Recorded preferences — Day: **${activeHumanTicket.preferred_day}**, Time: **${activeHumanTicket.preferred_time_window}**. OSA staff will confirm the final schedule in this chat.`;
            }
          }

          await persistReply(sessionId, humanReply);

          return res.json({
            success: true,
            reply: humanReply,
            tier: 3,
            human_mode: true,
            case_id: activeHumanTicket.case_id,
            human_ticket_status: String(activeHumanTicket.status || "open"),
            suggest_escalation: false,
          });
        }

        // General/non-OSA factual queries in secure mode should still be answerable
        // without forcing escalation (e.g., simple math or harmless general facts).
        const mathReply = parseSimpleMath(message);
        if (mathReply) {
          await persistReply(sessionId, mathReply);
          return res.json({
            success: true,
            reply: mathReply,
            answer: mathReply,
            tier: 2,
            suggest_escalation: false,
            escalate: false,
            general_fact_mode: true,
          });
        }

        if (mayUseGeneralFactMode(message)) {
          let generalReply = "";
          try {
            generalReply = await generateGeneralFactReply(message);
          } catch (_) {
            generalReply = "";
          }
          if (generalReply) {
            await persistReply(sessionId, generalReply);
            return res.json({
              success: true,
              reply: generalReply,
              answer: generalReply,
              tier: 2,
              suggest_escalation: false,
              escalate: false,
              general_fact_mode: true,
            });
          }
        }

        // ── TIER 1: FAQ search (optional; default off for conversational Tier 2) ──
        if (CHAT_TIER1_FAQ_ENABLED) {
          const faqMatch = await searchFaq(message);
          if (faqMatch) {
            // eslint-disable-next-line no-console
            console.log(`[RAG:chat] TIER 1 FAQ hit → question="${String(faqMatch.question || "").slice(0, 80)}"`);
            const aiTier1Reply = TIER1_REWRITE
              ? await generateTier1FaqReply(student_name, message, faqMatch)
              : "";
            const reply = tidyOfficialLinks(cleanModelText(aiTier1Reply || faqMatch.answer));

            await persistReply(sessionId, reply);

            return res.json({
              success: true,
              reply,
              answer: reply,
              tier: 1,
              suggest_escalation: false,
              escalate: false,
            });
          }
        }

        // ── TIER 2: Gemini LLM ───────────────────────────────
        // Fetch the LAST 28 messages (not the first 28) so long conversations
        // still include recent context. The current user message was already
        // inserted above, so drop the trailing row and re-append `message`.
        const historyResult = await db.query(
          `SELECT role, content FROM chat_messages
             WHERE session_id = $1
             ORDER BY created_at DESC
             LIMIT 28`,
          [sessionId]
        );
        const historyRows = historyResult.rows.slice().reverse();

        const [osaCtx, manualRag] = await Promise.all([
          getOsaContext(email, sessionId),
          fetchRagResult(message),
        ]);

        const appointmentIntent = isAppointmentIntent(message);
        const explicitEscalationIntent = needsEscalation(message, "");
        const hasOsaCtx = Boolean(osaCtx && String(osaCtx).trim().length > 40);
        const hasRetrieval = manualRag.chunkCount > 0 || hasOsaCtx;
        const isGreeting = /^\s*(hi+|hello+|hey|kumusta|kamusta|kamustahan|good\s+(morning|afternoon|evening|day)|hoy|oi|yo|sup|helo|helow|ello|greetings)\b/i.test(String(message || ""));

        // ── RAG DEBUG (always-on console log for accuracy monitoring) ──
        // eslint-disable-next-line no-console
        console.log(
          `[RAG:chat] query="${String(message || "").slice(0, 100)}" ` +
          `chunks=${manualRag.chunkCount} confidence=${Number(manualRag.confidence || 0).toFixed(3)} ` +
          `tier=${manualRag.tier || "ESCALATE"} ` +
          `hasLiveCtx=${hasOsaCtx} apptIntent=${appointmentIntent} escalateIntent=${explicitEscalationIntent}`
        );

        // Do not block on weak RAG scores when the question can be answered from live
        // portal state (announcements / L&F / services) or hours·location from osa_services.
        const livePortalQuestion =
          looksLikeLivePortalListingIntent(message) ||
          (hasOsaCtx && looksLikePortalLogisticsIntent(message));

        const lowConfidenceFallback =
          manualRag.chunkCount > 0 &&
          Number(manualRag.confidence || 0) < CHAT_RAG_MIN_CONFIDENCE &&
          !isGreeting && !appointmentIntent && !explicitEscalationIntent && !livePortalQuestion;

        // No reliable retrieval and no actionable intent — use AI guidance instead of dead-end.
        const noRetrievalFallback =
          (!hasRetrieval && !appointmentIntent && !explicitEscalationIntent && !isGreeting) ||
          (CHAT_STRICT_NO_RAG_LLM &&
            manualRag.chunkCount === 0 &&
            !isGreeting && !appointmentIntent && !explicitEscalationIntent &&
            !looksLikeLivePortalListingIntent(message) &&
            !(hasOsaCtx && looksLikePortalLogisticsIntent(message)));

        const needsNoKbGuidance = lowConfidenceFallback || noRetrievalFallback;

        const systemPrompt = needsNoKbGuidance
          ? buildNoKbGuidancePrompt(student_name, email)
          : buildSystemPrompt(student_name, email, osaCtx, manualRag);

        let rawReply = "";
        try {
          rawReply = await generateLlmText({
            systemPrompt,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            temperature:
              manualRag.chunkCount > 0 ? CHAT_TEMPERATURE : CHAT_TEMPERATURE_NO_KB,
            messages: [
              ...historyRows.slice(0, -1).map((r) => ({
                role: r.role === "assistant" ? "assistant" : "user",
                content: r.content,
              })),
              { role: "user", content: message },
            ],
          });
        } catch (llmError) {
          // Keep provider failure details in server logs only.
          logError("chat-llm", llmError);
          rawReply = "";
        }
        if (!rawReply) {
          const staticFallback = needsNoKbGuidance
            ? "For this topic, I'd recommend reaching out to OSA directly for accurate and official information. You can visit the OSA office or type /chat staff to connect with a staff member."
            : NO_RELIABLE_KB_REPLY;
          await persistReply(sessionId, staticFallback);
          return res.json({
            success: true,
            reply: staticFallback,
            answer: staticFallback,
            tier: 2,
            suggest_escalation: true,
            escalate: true,
          });
        }
        let cleanedRaw = cleanModelText(rawReply);
        const looksLikeNoKb =
          /^\s*no relevant information found\b/i.test(String(cleanedRaw).trim()) ||
          /\bi have insufficient (data|information)\b/i.test(String(cleanedRaw).toLowerCase()) ||
          /\binsufficient data to answer\b/i.test(String(cleanedRaw).toLowerCase());
        if (looksLikeNoKb && !needsNoKbGuidance) {
          cleanedRaw = NO_RELIABLE_KB_REPLY;
        }
        const suggestEscalation =
          needsEscalation(message, rawReply) || looksLikeNoKb || cleanedRaw === NO_RELIABLE_KB_REPLY;
        const reply = tidyOfficialLinks(
          normalizeEscalationReply(cleanedRaw, suggestEscalation, { appointmentIntent })
        );
        // eslint-disable-next-line no-console
        console.log(
          `[RAG:chat:reply] tier=2 suggestEscalation=${suggestEscalation} ` +
          `replyPreview="${String(reply || "").slice(0, 120).replace(/\n/g, " ")}"`
        );
        let autoCaseId = "";

        // Auto-create a ticket only for explicit escalation intents or appointment flows.
        // For "no reliable answer" escalation hints, show UI guidance but keep ticket manual.
        const shouldAutoEscalate = suggestEscalation && (explicitEscalationIntent || appointmentIntent);
        if (shouldAutoEscalate) {
          const ticketType = detectTicketType(message);
          const resolvedToday = await findTodayResolvedTicketBySession(sessionId);
          if (resolvedToday) {
            const resolvedCaseId = String(resolvedToday.case_id || "");
            const blockedReply =
              `Your support case for today is already resolved (Case ID: ${resolvedCaseId}). ` +
              `For any follow-up, please email OSA directly.`;
            await persistReply(sessionId, blockedReply);
            return res.json({
              success: true,
              reply: blockedReply,
              tier: 3,
              suggest_escalation: false,
              auto_escalated: false,
              escalation_blocked_resolved: true,
              case_id: resolvedCaseId,
            });
          }
          const allowRepeatAppointment = ALLOW_REPEAT_APPOINTMENT_TEST && ticketType === "appointment";
          const sameDayAppointmentTicket =
            !allowRepeatAppointment && ticketType === "appointment"
              ? await findTodayAppointmentTicketByEmail(email)
              : null;
          const sameDayAppointmentCaseId = sameDayAppointmentTicket
            ? String(sameDayAppointmentTicket.case_id || "")
            : "";
          const sameDayAppointmentStatus = sameDayAppointmentTicket
            ? String(sameDayAppointmentTicket.status || "").toLowerCase()
            : "";
          if (sameDayAppointmentCaseId) {
            const blockedReply =
              `You can only request one appointment per day. ` +
              `Your appointment case today is already recorded (Case ID: ${sameDayAppointmentCaseId}, status: ${sameDayAppointmentStatus || "open"}). ` +
              `Please wait for OSA updates or email OSA for follow-up.`;
            await persistReply(sessionId, blockedReply);
            return res.json({
              success: true,
              reply: blockedReply,
              tier: 3,
              suggest_escalation: false,
              auto_escalated: false,
              appointment_locked_today: true,
              case_id: sameDayAppointmentCaseId,
            });
          }
          // One open ticket per (session, type): if the student already has
          // an appointment / human-support / claim / general ticket open,
          // reuse it instead of creating another.
          const existingCaseId = allowRepeatAppointment
            ? ""
            : await findOpenTicketByType(sessionId, ticketType);
          if (sameDayAppointmentCaseId) {
            autoCaseId = sameDayAppointmentCaseId;
          } else if (existingCaseId) {
            autoCaseId = existingCaseId;
          } else {
            const openCount = allowRepeatAppointment ? 0 : await countOpenTicketsForSession(sessionId);
            if (openCount >= MAX_OPEN_TICKETS_PER_SESSION) {
              // At the per-session cap: do not create more. Return the reply
              // without an auto-escalation flag so the UI won't show the
              // "forwarded" handoff card.
              autoCaseId = "";
            } else {
              autoCaseId = await createEscalationTicket(
                sessionId, email, student_name, message,
                { ticket_type: ticketType }
              );
            }
          }
        }

        await persistReply(sessionId, reply);

        return res.json({
          success: true,
          reply,
          answer: reply,
          tier: 2,
          suggest_escalation: suggestEscalation,
          escalate: !!suggestEscalation,
          auto_escalated: !!autoCaseId,
          case_id: autoCaseId || null,
        });
        }); // enqueueForSession
      } catch (error) {
        return genericError(res, "chat", error);
      }
    }
  );

  // ── TIER 3: Create escalation ticket ────────────────────────
  app.post(`${apiPrefix}/chat/escalate`, async (req, res) => {
    const sessionId = String((req.body && req.body.session_id) || "").trim();
    const rawConcern = String((req.body && req.body.concern) || "").trim();

    if (!sessionId || !rawConcern) {
      return res.status(400).json({ success: false, message: "session_id and concern are required." });
    }
    if (!isValidSessionId(sessionId)) {
      return res.status(400).json({ success: false, message: "Invalid session_id format." });
    }

    try {
      const loaded = await loadSessionRow(sessionId);
      if (!loaded.found) {
        return res.status(404).json({ success: false, message: "Session not found." });
      }
      if (loaded.expired) {
        return res.status(401).json({
          success: false,
          code: "SESSION_EXPIRED",
          message: "Secure chat session expired. Please verify your email again.",
        });
      }
      const { email, student_name } = loaded.session;
      const concern = await resolveEscalationConcern(sessionId, rawConcern);

      const ticketType = detectTicketType(concern);
      const resolvedToday = await findTodayResolvedTicketBySession(sessionId);
      if (resolvedToday) {
        const resolvedCaseId = String(resolvedToday.case_id || "");
        return res.status(409).json({
          success: false,
          code: "SESSION_ALREADY_RESOLVED_TODAY",
          message:
            `Your support case for today is already resolved (Case ID: ${resolvedCaseId}). ` +
            `For follow-up, please email OSA directly.`,
          case_id: resolvedCaseId,
        });
      }
      const allowRepeatAppointment = ALLOW_REPEAT_APPOINTMENT_TEST && ticketType === "appointment";
      const sameDayAppointmentTicket =
        !allowRepeatAppointment && ticketType === "appointment"
          ? await findTodayAppointmentTicketByEmail(email)
          : null;
      const sameDayAppointmentCaseId = sameDayAppointmentTicket
        ? String(sameDayAppointmentTicket.case_id || "")
        : "";
      const sameDayAppointmentStatus = sameDayAppointmentTicket
        ? String(sameDayAppointmentTicket.status || "").toLowerCase()
        : "";
      const existingCaseId = allowRepeatAppointment
        ? ""
        : await findOpenTicketByType(sessionId, ticketType);

      let caseId;
      let reused = false;
      if (sameDayAppointmentCaseId) {
        return res.status(409).json({
          success: false,
          code: "APPOINTMENT_LIMIT_DAILY",
          message:
            `You can only request one appointment per day. ` +
            `Your appointment case today is already recorded (Case ID: ${sameDayAppointmentCaseId}, status: ${sameDayAppointmentStatus || "open"}). ` +
            `Please wait for OSA updates or email OSA for follow-up.`,
          case_id: sameDayAppointmentCaseId,
        });
      } else if (existingCaseId) {
        caseId = existingCaseId;
        reused = true;
      } else {
        const openCount = allowRepeatAppointment ? 0 : await countOpenTicketsForSession(sessionId);
        if (openCount >= MAX_OPEN_TICKETS_PER_SESSION) {
          return res.status(429).json({
            success: false,
            code: "TOO_MANY_OPEN_TICKETS",
            message:
              `You already have ${openCount} open tickets. ` +
              `Please wait for OSA staff to respond to an existing one before opening another.`,
          });
        }
        caseId = await createEscalationTicket(
          sessionId, email, student_name, concern, { ticket_type: ticketType }
        );
      }

      const botMsg = reused
        ? `You already have an open ${ticketType.replace("_", " ")} ticket.\n\n` +
          `📋 Case ID: **${caseId}**\n\n` +
          `OSA staff will continue replying here in this same chat. ` +
          `If no one is able to respond right away, please wait — OSA may also follow up with you directly via email at your registered student address. No new ticket was created.`
        : `Your concern has been escalated to an OSA staff member.\n\n` +
          `📋 Case ID: **${caseId}** (type: ${ticketType.replace("_", " ")})\n\n` +
          `A staff member will reply here in this same chat as soon as one is available. ` +
          `If they are unable to respond in chat right away, please wait — OSA may follow up with you directly via email (please check your student email inbox). ` +
          `You will also be notified via email once the ticket is resolved.`;

      await db.query(
        `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
        [sessionId, botMsg]
      );
      // Bump session activity so the secure window does not expire mid-flow
      // right after the student just escalated.
      await db.query(`UPDATE chat_sessions SET last_active_at = NOW() WHERE id = $1`, [sessionId]);

      return res.json({
        success: true,
        case_id: caseId,
        ticket_type: ticketType,
        reused_case: reused,
        message: reused ? "Existing open ticket returned." : "Ticket created.",
      });
    } catch (error) {
      return genericError(res, "chat", error);
    }
  });

  // Current ticket status for this session — lets the widget restore the
  // "waiting for OSA staff" banner after a page refresh and decide whether
  // a cancel button should still be offered (cancellable only while status='open').
  app.get(`${apiPrefix}/chat/session/:sessionId/ticket`, async (req, res) => {
    const sessionId = String((req.params && req.params.sessionId) || "").trim();
    if (!sessionId) {
      return res.status(400).json({ success: false, message: "sessionId is required." });
    }
    if (!isValidSessionId(sessionId)) {
      return res.status(400).json({ success: false, message: "Invalid sessionId format." });
    }
    try {
      const loaded = await loadSessionRow(sessionId);
      if (!loaded.found) return res.status(404).json({ success: false, message: "Session not found." });
      if (loaded.expired) {
        return res.status(401).json({
          success: false,
          code: "SESSION_EXPIRED",
          message: "Secure chat session expired. Please verify your email again.",
        });
      }
      const ticket = await getActiveHumanTicket(sessionId);
      if (!ticket) return res.json({ success: true, ticket: null });
      // Surface appointment_status so the widget can decide whether to
      // re-show the "Waiting for OSA staff" banner on hydrate. Once the
      // visit ticket has been approved or fully scheduled by staff, the
      // banner must NOT come back on refresh — it would falsely tell the
      // student that staff hasn't responded yet.
      return res.json({
        success: true,
        ticket: {
          case_id: ticket.case_id,
          status: ticket.status,
          ticket_type: ticket.ticket_type,
          appointment_status: ticket.appointment_status || null,
          appointment_datetime: ticket.appointment_datetime || null,
          preferred_day: ticket.preferred_day || null,
          preferred_time_window: ticket.preferred_time_window || null,
          created_at: ticket.created_at,
          updated_at: ticket.updated_at,
          cancellable: ticket.status === "open",
        },
      });
    } catch (error) {
      return genericError(res, "chat-ticket-status", error);
    }
  });

  // Student-initiated cancel: only permitted while the ticket is still
  // 'open' (no staff reply yet). Once staff has engaged (in_progress), the
  // handoff is sticky and the student must wait it out or ask staff to end.
  app.post(`${apiPrefix}/chat/escalate/cancel`, async (req, res) => {
    const sessionId = String((req.body && req.body.session_id) || "").trim();
    const caseId = String((req.body && req.body.case_id) || "").trim();
    if (!sessionId) {
      return res.status(400).json({ success: false, message: "session_id is required." });
    }
    if (!isValidSessionId(sessionId)) {
      return res.status(400).json({ success: false, message: "Invalid session_id format." });
    }
    try {
      const loaded = await loadSessionRow(sessionId);
      if (!loaded.found) return res.status(404).json({ success: false, message: "Session not found." });
      if (loaded.expired) {
        return res.status(401).json({
          success: false,
          code: "SESSION_EXPIRED",
          message: "Secure chat session expired. Please verify your email again.",
        });
      }

      // If no caseId was supplied, target the current active ticket for the session.
      const target = caseId || (await (async () => {
        const r = await db.query(
          `SELECT case_id FROM escalation_tickets
            WHERE session_id = $1 AND status = 'open'
            ORDER BY created_at DESC LIMIT 1`,
          [sessionId]
        );
        return r.rows.length ? String(r.rows[0].case_id) : "";
      })());

      if (!target) {
        return res.status(404).json({ success: false, code: "NO_OPEN_TICKET", message: "No cancellable ticket for this session." });
      }

      const upd = await db.query(
        `UPDATE escalation_tickets
            SET status = 'resolved',
                staff_reply = '[system] Cancelled by student before staff response.',
                updated_at = NOW()
          WHERE case_id = $1
            AND session_id = $2
            AND status = 'open'
          RETURNING case_id`,
        [target, sessionId]
      );
      if (!upd.rows.length) {
        return res.status(409).json({
          success: false,
          code: "NOT_CANCELLABLE",
          message: "This request can no longer be cancelled — OSA staff is already handling it.",
        });
      }

      const botMsg =
        `You cancelled this escalation (Case ID: ${target}). ` +
        `AI assistance is back on. You can ask another question or escalate again if needed.`;
      await db.query(
        `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
        [sessionId, `[system] ${botMsg}`]
      );
      await db.query(`UPDATE chat_sessions SET last_active_at = NOW() WHERE id = $1`, [sessionId]);

      return res.json({ success: true, case_id: target, message: botMsg });
    } catch (error) {
      return genericError(res, "chat-escalate-cancel", error);
    }
  });

  // Lost & Found: create claim case (Tier 3) + immediate admin + student email
  app.post(
    `${apiPrefix}/chat/claim`,
    ...[chatMsgLimiter].filter(Boolean),
    async (req, res) => {
      const sessionId = String((req.body && req.body.session_id) || "").trim();
      const itemNumber = normalizeClaimItemNumber((req.body && req.body.item_number) || "");
      const itemTitle = String((req.body && req.body.item_title) || "").trim().slice(0, 200);

      if (!sessionId || !itemNumber) {
        return res.status(400).json({ success: false, message: "session_id and valid item_number (LF-####) are required." });
      }
      if (!isValidSessionId(sessionId)) {
        return res.status(400).json({ success: false, message: "Invalid session_id format." });
      }

      try {
        const loaded = await loadSessionRow(sessionId);
        if (!loaded.found) {
          return res.status(404).json({ success: false, message: "Session not found." });
        }
        if (loaded.expired) {
          return res.status(401).json({
            success: false,
            code: "SESSION_EXPIRED",
            message: "Secure chat session expired. Please verify your email again.",
          });
        }
        const { email, student_name } = loaded.session;

        // Server-authoritative item validation. The widget previously gated this
        // on a localStorage cache populated by the L&F page, which broke claims
        // for students who deep-linked into the chat without first visiting the
        // L&F page. The DB is the single source of truth.
        const itemLookup = await db.query(
          `SELECT item_number, title, status, is_active
             FROM lost_found_items
            WHERE upper(item_number) = upper($1)
            LIMIT 1`,
          [itemNumber]
        );
        if (!itemLookup.rows.length || itemLookup.rows[0].is_active === false) {
          return res.status(404).json({
            success: false,
            code: "LF_ITEM_NOT_FOUND",
            message: `Item ${itemNumber} was not found in Lost & Found. Double-check the item number on the Lost & Found page (format: LF-####).`,
          });
        }
        const dbItem = itemLookup.rows[0];
        if (String(dbItem.status || "").toLowerCase() === "claimed") {
          return res.status(409).json({
            success: false,
            code: "LF_ITEM_ALREADY_CLAIMED",
            message: `Item ${itemNumber} (${dbItem.title || "untitled"}) is already marked claimed.`,
          });
        }

        // Trust the DB title over what the client passed.
        const resolvedTitle = String(dbItem.title || itemTitle || "").trim().slice(0, 200);

        const existing = await findOpenClaimTicket(sessionId, itemNumber);
        let caseId = existing;
        const concern =
          `Lost & Found claim — Item ${itemNumber}${resolvedTitle ? ` (${resolvedTitle})` : ""}. ` +
          `Student requests an OSA visit to claim this item.`;

        if (!caseId) {
          caseId = await createEscalationTicket(sessionId, email, student_name, concern, {
            ticket_type: "claim",
            claim_item_number: itemNumber,
          });
        }

        const botMsg = existing
          ? `You already have an open Lost & Found claim for this item.\n\n` +
            `📋 Case ID: **${caseId}**\n\n` +
            `Use the buttons below to choose or update appointment preferences while staff schedules your visit.`
          : `Your Lost & Found claim was submitted.\n\n` +
            `📋 Case ID: **${caseId}**\n\n` +
            `OSA staff will confirm your visit schedule. Use the buttons below to choose appointment type and preferred day/time.`;

        await db.query(
          `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
          [sessionId, botMsg]
        );
        await db.query(`UPDATE chat_sessions SET last_active_at = NOW() WHERE id = $1`, [sessionId]);

        return res.json({
          success: true,
          case_id: caseId,
          assistant_message: botMsg,
          ticket_type: "claim",
          claim_item_number: itemNumber,
          reused_case: !!existing,
          message: existing ? "Existing open claim case returned." : "Claim ticket created.",
        });
      } catch (error) {
        return genericError(res, "chat", error);
      }
    }
  );

  // Student: submit / update appointment preferences for a claim ticket
  app.post(
    `${apiPrefix}/chat/claim/appointment-preference`,
    ...[chatMsgLimiter].filter(Boolean),
    async (req, res) => {
      const sessionId = String((req.body && req.body.session_id) || "").trim();
      const caseId = String((req.body && req.body.case_id) || "").trim();
      const track = normalizeAppointmentTrack((req.body && req.body.appointment_track) || "");
      const preferredDay = String((req.body && req.body.preferred_day) || "").trim().slice(0, 32);
      const preferredWindow = String((req.body && req.body.preferred_time_window) || "").trim().slice(0, 32);
      const scheduleNote = String((req.body && req.body.schedule_note) || "").trim().slice(0, 500);

      if (!sessionId || !caseId) {
        return res.status(400).json({ success: false, message: "session_id and case_id are required." });
      }
      if (!isValidSessionId(sessionId)) {
        return res.status(400).json({ success: false, message: "Invalid session_id format." });
      }

      try {
        const loaded = await loadSessionRow(sessionId);
        if (!loaded.found) {
          return res.status(404).json({ success: false, message: "Session not found." });
        }
        if (loaded.expired) {
          return res.status(401).json({
            success: false,
            code: "SESSION_EXPIRED",
            message: "Secure chat session expired. Please verify your email again.",
          });
        }

        const ticketRow = await db.query(
          `SELECT ticket_type, status FROM escalation_tickets WHERE case_id = $1 AND session_id = $2`,
          [caseId, sessionId]
        );
        if (!ticketRow.rows.length || ticketRow.rows[0].ticket_type !== "claim") {
          return res.status(404).json({ success: false, message: "Claim ticket not found for this session." });
        }
        if (ticketRow.rows[0].status === "resolved") {
          return res.status(400).json({ success: false, message: "This case is already resolved." });
        }

        const updates = [];
        const vals = [];
        let p = 1;

        if (track) {
          updates.push(`appointment_track = $${p++}`);
          vals.push(track);
        }
        if (preferredDay) {
          updates.push(`preferred_day = $${p++}`);
          vals.push(preferredDay);
        }
        if (preferredWindow) {
          updates.push(`preferred_time_window = $${p++}`);
          vals.push(preferredWindow);
        }
        if (scheduleNote) {
          updates.push(
            `appointment_notes = trim(both from coalesce(appointment_notes,'') || E'\\n' || $${p++})`
          );
          vals.push(`Student note: ${scheduleNote}`);
        }

        if (!updates.length) {
          return res.status(400).json({ success: false, message: "No preference fields provided." });
        }

        const whereCaseNum = p;
        const whereSessNum = p + 1;
        vals.push(caseId, sessionId);

        await db.query(
          `UPDATE escalation_tickets SET ${updates.join(", ")}, updated_at = NOW() WHERE case_id = $${whereCaseNum} AND session_id = $${whereSessNum}`,
          vals
        );

        const snap = await db.query(
          `SELECT appointment_track, preferred_day, preferred_time_window, appointment_notes
           FROM escalation_tickets WHERE case_id = $1`,
          [caseId]
        );
        const row = snap.rows[0] || {};

        let summary = "Appointment preference saved.";
        if (row.appointment_track === "claiming") summary = "Recorded: **Claiming Appointment**.";
        else if (row.appointment_track === "private") summary = "Recorded: **Private Appointment** (OSA will handle this discreetly).";
        if (preferredDay) summary += ` Preferred day: **${preferredDay}**.`;
        if (preferredWindow) summary += ` Time window: **${preferredWindow}**.`;
        if (scheduleNote) summary += ` Note stored for staff.`;

        await db.query(
          `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
          [sessionId, summary]
        );
        await db.query(`UPDATE chat_sessions SET last_active_at = NOW() WHERE id = $1`, [sessionId]);

        return res.json({ success: true, case_id: caseId, summary });
      } catch (error) {
        return genericError(res, "chat", error);
      }
    }
  );

  // Student: create a visit/appointment request ticket
  app.post(
    `${apiPrefix}/chat/visit`,
    ...[chatMsgLimiter].filter(Boolean),
    async (req, res) => {
      const sessionId = String((req.body && req.body.session_id) || "").trim();
      const purposeRaw = String((req.body && req.body.purpose) || "").trim().slice(0, 500);

      if (!sessionId) {
        return res.status(400).json({ success: false, message: "session_id is required." });
      }
      if (!isValidSessionId(sessionId)) {
        return res.status(400).json({ success: false, message: "Invalid session_id format." });
      }

      try {
        const loaded = await loadSessionRow(sessionId);
        if (!loaded.found) return res.status(404).json({ success: false, message: "Session not found." });
        if (loaded.expired) {
          return res.status(401).json({ success: false, code: "SESSION_EXPIRED", message: "Secure chat session expired. Please verify your email again." });
        }
        const { email, student_name } = loaded.session;

        // Per-session mutex: serializes concurrent visit POSTs (rapid
        // double-click, client-side network retry of an already-applied
        // request, etc.) so the second caller correctly sees the first
        // caller's just-created ticket and reuses it instead of
        // creating a duplicate.
        const result = await withKeyedLock(`visit:${sessionId}`, async () => {
          const existing = await findOpenTicketByType(sessionId, "appointment");
          let caseId = existing;
          const concern = purposeRaw
            ? `OSA visit request — Purpose: ${purposeRaw}`
            : `Student requests a visit or appointment with OSA.`;

          if (!caseId) {
            const sameDayTicket = await findTodayAppointmentTicketByEmail(email);
            if (sameDayTicket) {
              const lockedReply =
                `You already have an appointment request for today (Case ID: ${sameDayTicket.case_id}). ` +
                `Please wait for OSA to confirm your schedule, or email OSA for urgent follow-up.`;
              await db.query(
                `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
                [sessionId, lockedReply]
              );
              await db.query(`UPDATE chat_sessions SET last_active_at = NOW() WHERE id = $1`, [sessionId]);
              return { kind: "locked", case_id: sameDayTicket.case_id, message: lockedReply };
            }
            caseId = await createEscalationTicket(sessionId, email, student_name, concern, { ticket_type: "appointment" });
          }

          const botMsg = existing
            ? `You already have an open visit request.\n\n📋 Case ID: **${caseId}**\n\nUse the buttons below to update your preferred day and time. OSA staff will confirm the final schedule.`
            : `Your visit request has been submitted.\n\n📋 Case ID: **${caseId}**\n\nChoose your preferred day and time below. OSA staff will confirm the schedule.`;

          await db.query(
            `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
            [sessionId, botMsg]
          );
          await db.query(`UPDATE chat_sessions SET last_active_at = NOW() WHERE id = $1`, [sessionId]);

          return { kind: "ok", case_id: caseId, botMsg, reused: !!existing };
        });

        if (result.kind === "locked") {
          return res.json({ success: false, code: "VISIT_LOCKED_TODAY", message: result.message, case_id: result.case_id });
        }
        return res.json({
          success: true,
          case_id: result.case_id,
          assistant_message: result.botMsg,
          ticket_type: "appointment",
          reused_case: result.reused,
        });
      } catch (error) {
        return genericError(res, "chat-visit", error);
      }
    }
  );

  // Student: submit / update appointment preferences for a visit ticket
  app.post(
    `${apiPrefix}/chat/visit/appointment-preference`,
    ...[chatMsgLimiter].filter(Boolean),
    async (req, res) => {
      const sessionId = String((req.body && req.body.session_id) || "").trim();
      const caseId = String((req.body && req.body.case_id) || "").trim();
      const preferredDay = String((req.body && req.body.preferred_day) || "").trim().slice(0, 32);
      const preferredWindow = String((req.body && req.body.preferred_time_window) || "").trim().slice(0, 32);
      const scheduleNote = String((req.body && req.body.schedule_note) || "").trim().slice(0, 500);

      if (!sessionId || !caseId) {
        return res.status(400).json({ success: false, message: "session_id and case_id are required." });
      }
      if (!isValidSessionId(sessionId)) {
        return res.status(400).json({ success: false, message: "Invalid session_id format." });
      }

      try {
        const loaded = await loadSessionRow(sessionId);
        if (!loaded.found) return res.status(404).json({ success: false, message: "Session not found." });
        if (loaded.expired) {
          return res.status(401).json({ success: false, code: "SESSION_EXPIRED", message: "Secure chat session expired. Please verify your email again." });
        }

        const ticketRow = await db.query(
          `SELECT ticket_type, status, appointment_status FROM escalation_tickets WHERE case_id = $1 AND session_id = $2`,
          [caseId, sessionId]
        );
        if (!ticketRow.rows.length || ticketRow.rows[0].ticket_type !== "appointment") {
          return res.status(404).json({ success: false, message: "Visit ticket not found for this session." });
        }
        if (ticketRow.rows[0].status === "resolved") {
          return res.status(400).json({ success: false, message: "This case is already resolved." });
        }
        // Once OSA has approved or scheduled the visit, the day/time chips
        // must lock — otherwise a stale chip click on a refreshed page would
        // (a) overwrite the preference OSA already acted on, and (b) post a
        // duplicate "Preference saved" bubble even though nothing changed.
        const apptStatus = String(ticketRow.rows[0].appointment_status || "").toLowerCase();
        if (apptStatus === "approved" || apptStatus === "scheduled") {
          return res.status(409).json({
            success: false,
            code: "APPOINTMENT_LOCKED",
            message:
              apptStatus === "scheduled"
                ? "Your visit is already scheduled. Please check the confirmed date and time above."
                : "OSA has already approved this visit. The schedule will be sent in this chat shortly.",
          });
        }

        const updates = [];
        const vals = [];
        let p = 1;

        if (preferredDay) { updates.push(`preferred_day = $${p++}`); vals.push(preferredDay); }
        if (preferredWindow) { updates.push(`preferred_time_window = $${p++}`); vals.push(preferredWindow); }
        if (scheduleNote) {
          updates.push(`appointment_notes = trim(both from coalesce(appointment_notes,'') || E'\\n' || $${p++})`);
          vals.push(`Student note: ${scheduleNote}`);
        }

        if (!updates.length) {
          return res.status(400).json({ success: false, message: "No preference fields provided." });
        }

        vals.push(caseId, sessionId);
        await db.query(
          `UPDATE escalation_tickets SET ${updates.join(", ")}, updated_at = NOW() WHERE case_id = $${p} AND session_id = $${p + 1}`,
          vals
        );

        const snap = await db.query(
          `SELECT preferred_day, preferred_time_window FROM escalation_tickets WHERE case_id = $1`,
          [caseId]
        );
        const row = snap.rows[0] || {};

        // Wrap the captured values in **bold** so the student widget's
        // markdown renderer highlights them (Day: **Mon**, Time: **Morning**).
        const parts = [];
        if (row.preferred_day) parts.push(`Day: **${row.preferred_day}**`);
        if (row.preferred_time_window) parts.push(`Time: **${row.preferred_time_window}**`);

        let summary;
        if (parts.length === 2) {
          summary = `✅ Preference saved — ${parts.join(", ")}. OSA staff will review and confirm the final schedule.`;
        } else if (parts.length === 1) {
          summary = `Got it — ${parts[0]} noted. ${row.preferred_day ? "Choose a time window (**Morning** or **Afternoon**) below." : "Choose your preferred day below."}`;
        } else {
          summary = "Preference saved. OSA staff will confirm your schedule.";
        }
        if (scheduleNote) summary += " Your note was also saved for staff.";

        await db.query(
          `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
          [sessionId, summary]
        );
        await db.query(`UPDATE chat_sessions SET last_active_at = NOW() WHERE id = $1`, [sessionId]);

        return res.json({ success: true, case_id: caseId, summary });
      } catch (error) {
        return genericError(res, "chat-visit-pref", error);
      }
    }
  );

  // Staff: set final visit appointment for a ticket
  app.post(`${apiPrefix}/chat/tickets/:caseId/appointment`, requireAdminKey, async (req, res) => {
    const caseId = String((req.params && req.params.caseId) || "").trim();
    const staffName = String((req.body && req.body.staff_name) || "OSA Staff").trim();
    const location = String((req.body && req.body.appointment_location) || "OSA Office").trim().slice(0, 200);
    const notes = String((req.body && req.body.appointment_notes) || "").trim().slice(0, 2000);
    const whenRaw = String((req.body && req.body.appointment_datetime) || "").trim();

    if (!caseId || !whenRaw) {
      return res.status(400).json({ success: false, message: "caseId and appointment_datetime are required." });
    }

    const when = new Date(whenRaw);
    if (!Number.isFinite(when.getTime())) {
      return res.status(400).json({ success: false, message: "Invalid appointment_datetime." });
    }

    try {
      // Per-case mutex + short-window dedupe so a rapid double-confirm
      // (duplicate listener attachment, accidental double-click, panel
      // re-render, network retry) doesn't spam the student with two
      // "Your OSA visit is confirmed" messages for the same case.
      const result = await withKeyedLock(`appt:${caseId}`, async () => {
        const prevTicket = await db.query(
          `SELECT status FROM escalation_tickets WHERE case_id = $1 AND status IN ('open','in_progress')`,
          [caseId]
        );
        const wasOpen = prevTicket.rows.length > 0 && prevTicket.rows[0].status === "open";

        const ticketResult = await db.query(
          `UPDATE escalation_tickets
           SET appointment_datetime = $1,
               appointment_location = $2,
               appointment_notes = coalesce($3, appointment_notes),
               appointment_status = 'scheduled',
               status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
               updated_at = NOW()
           WHERE case_id = $4 AND status IN ('open','in_progress')
           RETURNING session_id, ticket_type`,
          [when.toISOString(), location, notes || null, caseId]
        );

        if (!ticketResult.rows.length) {
          return { kind: "notfound" };
        }

        const { session_id } = ticketResult.rows[0];

        // Suppress duplicate confirmation chat messages within a short
        // window — but the ticket UPDATE above is still applied so a
        // legitimate reschedule still persists the new datetime.
        const now = Date.now();
        const last = _lastApptConfirmAt.get(caseId) || 0;
        const APPT_CONFIRM_DEDUPE_MS = 8000;
        if (now - last < APPT_CONFIRM_DEDUPE_MS) {
          return { kind: "ok-deduped", session_id };
        }
        _lastApptConfirmAt.set(caseId, now);

        const dtLabel = when.toLocaleString("en-PH", {
          weekday: "long", year: "numeric", month: "long", day: "numeric",
          hour: "numeric", minute: "2-digit", hour12: true,
          timeZone: "Asia/Manila",
        });

        const msgContent =
          `[OSA Staff · ${staffName}]\n\n` +
          `Your OSA visit is confirmed:\n\n` +
          `When: ${dtLabel}\n` +
          `Where: ${location}\n` +
          (notes ? `Notes: ${notes}\n` : "") +
          `\nPlease arrive on time and bring your school ID and Case ID (${caseId}).`;

        await db.query(
          `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
          [session_id, msgContent]
        );

        await db.query(`UPDATE chat_sessions SET last_active_at = NOW() WHERE id = $1`, [session_id]);

        if (wasOpen) {
          const joinMsg = `OSA Staff ${staffName} has joined the chat.`;
          await db.query(
            `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
            [session_id, `[system] ${joinMsg}`]
          );
          pushToSession(session_id, {
            type: "staff_joined",
            content: joinMsg,
            staff_name: staffName,
            case_id: caseId,
            timestamp: new Date().toISOString(),
          });
        }

        const delivered = pushToSession(session_id, {
          type: "staff_message",
          content: msgContent,
          staff_name: staffName,
          case_id: caseId,
          timestamp: new Date().toISOString(),
        });
        pushToAdminTickets({
          type: "ticket_updated",
          case_id: caseId,
          status: "in_progress",
          appointment_status: "scheduled",
          timestamp: new Date().toISOString(),
        });

        return { kind: "ok", delivered };
      });

      if (result.kind === "notfound") {
        return res.status(404).json({ success: false, message: "Ticket not found or already resolved." });
      }
      if (result.kind === "ok-deduped") {
        return res.json({ success: true, delivered: false, deduped: true });
      }
      return res.json({ success: true, delivered: result.delivered });
    } catch (error) {
      return genericError(res, "chat", error);
    }
  });

  // Staff: approve ticket for appointment queue
  app.post(`${apiPrefix}/chat/tickets/:caseId/approve-appointment`, requireAdminKey, async (req, res) => {
    const caseId = String((req.params && req.params.caseId) || "").trim();
    const staffName = String((req.body && req.body.staff_name) || "OSA Staff").trim();
    const note = String((req.body && req.body.note) || "").trim().slice(0, 1200);

    if (!caseId) {
      return res.status(400).json({ success: false, message: "caseId is required." });
    }

    try {
      const prevTicket = await db.query(
        `SELECT status FROM escalation_tickets WHERE case_id = $1 AND status IN ('open','in_progress')`,
        [caseId]
      );
      const wasOpen = prevTicket.rows.length > 0 && prevTicket.rows[0].status === "open";

      const approved = await db.query(
        `UPDATE escalation_tickets
         SET appointment_status = 'approved',
             appointment_approved_at = NOW(),
             appointment_approved_by = $1,
             status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
             updated_at = NOW()
         WHERE case_id = $2
           AND status IN ('open','in_progress')
         RETURNING session_id, student_name, ticket_type, appointment_approved_at`,
        [staffName, caseId]
      );

      if (!approved.rows.length) {
        return res.status(404).json({ success: false, message: "Ticket not found or already resolved." });
      }

      const row = approved.rows[0];
      const isVisitTicket = String(row.ticket_type || "").toLowerCase() === "appointment";
      const msg =
        `[OSA Staff · ${staffName}]\n\n` +
        `✅ Your appointment request has been approved.\n\n` +
        (note ? `Note: ${note}\n\n` : "") +
        (isVisitTicket
          ? `OSA will send you the confirmed date, time, and location in this chat shortly.`
          : `An OSA staff member will confirm the exact schedule in this chat. Please keep this window open.`
        );

      if (wasOpen) {
        const joinMsg = `OSA Staff ${staffName} has joined the chat.`;
        await db.query(
          `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
          [row.session_id, `[system] ${joinMsg}`]
        );
        pushToSession(row.session_id, {
          type: "staff_joined",
          content: joinMsg,
          staff_name: staffName,
          case_id: caseId,
          timestamp: new Date().toISOString(),
        });
      }

      await db.query(
        `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
        [row.session_id, msg]
      );
      await db.query(`UPDATE chat_sessions SET last_active_at = NOW() WHERE id = $1`, [row.session_id]);

      const delivered = pushToSession(row.session_id, {
        type: "staff_message",
        content: msg,
        staff_name: staffName,
        case_id: caseId,
        timestamp: new Date().toISOString(),
        appointment_approved: true,
      });
      pushToAdminTickets({
        type: "ticket_updated",
        case_id: caseId,
        status: "in_progress",
        appointment_status: "approved",
        timestamp: new Date().toISOString(),
      });

      return res.json({
        success: true,
        case_id: caseId,
        appointment_status: "approved",
        appointment_approved_at: row.appointment_approved_at,
        delivered,
      });
    } catch (error) {
      return genericError(res, "chat", error);
    }
  });

  // ── Admin: Resolve ticket + optional self-learning ───────────
  app.put(`${apiPrefix}/chat/tickets/:caseId/resolve`, requireAdminKey, async (req, res) => {
    const caseId = String((req.params && req.params.caseId) || "").trim();
    const staffReply = String((req.body && req.body.staff_reply) || "").trim();
    const promoteToFaq = !!(req.body && req.body.promote_to_faq);
    const faqQuestion = String((req.body && req.body.faq_question) || "").trim();
    const faqAnswer = String((req.body && req.body.faq_answer) || staffReply).trim();
    const faqCategory = String((req.body && req.body.faq_category) || "General").trim();

    if (!caseId) {
      return res.status(400).json({ success: false, message: "case_id is required." });
    }
    if (promoteToFaq && !staffReply) {
      return res.status(400).json({ success: false, message: "staff_reply is required when promoting to FAQ." });
    }

    try {
      // Guard against double-resolve (staff double-click): only flip a ticket
      // that is still open/in_progress. Without this filter, a second click
      // re-runs the closing-message insert and the FAQ promotion insert,
      // duplicating both rows. Distinguish between "not found at all" (404)
      // and "already resolved" (409) so the UI can react cleanly.
      const ticketResult = await db.query(
        `UPDATE escalation_tickets
         SET status = 'resolved', staff_reply = $1, promote_to_faq = $2,
             faq_question = $3, faq_answer = $4, faq_category = $5, updated_at = NOW()
         WHERE case_id = $6 AND status IN ('open','in_progress')
         RETURNING session_id, student_email, student_name`,
        [staffReply || null, promoteToFaq, faqQuestion || null, faqAnswer || null, faqCategory, caseId]
      );

      if (!ticketResult.rows.length) {
        const exists = await db.query(
          `SELECT status FROM escalation_tickets WHERE case_id = $1`,
          [caseId]
        );
        if (!exists.rows.length) {
          return res.status(404).json({ success: false, message: "Ticket not found." });
        }
        return res.status(409).json({
          success: false,
          code: "ALREADY_RESOLVED",
          message: "This ticket has already been resolved.",
        });
      }

      const { session_id, student_name } = ticketResult.rows[0];
      const firstName = (student_name || "").split(" ")[0] || "there";

      // Staff reply is optional. Only prepend a personalized reply bubble when
      // staff actually wrote something; otherwise just end the session cleanly.
      const staffMsg = staffReply
        ? `[OSA Staff Reply — Case ${caseId}]\n\n` +
          `Hi ${firstName}, here is the response to your concern:\n\n${staffReply}`
        : '';

      if (staffMsg) {
        await db.query(
          `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
          [session_id, staffMsg]
        );
      }

      // Resolving a ticket also ends the live support session for the student.
      // Persist a closing system note so both the student widget and the admin
      // history make it clear that OSA staff has stepped out of the chat.
      const closingMsg =
        `[system] OSA staff has ended this live support session. ` +
        `Case ${caseId} is now marked resolved. ` +
        `You may open a new concern anytime if you need further help.`;
      await db.query(
        `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
        [session_id, closingMsg]
      );
      await db.query(`UPDATE chat_sessions SET last_active_at = NOW() WHERE id = $1`, [session_id]);

      // ── Self-learning loop: promote to FAQ ──────────────────
      if (promoteToFaq && faqAnswer) {
        const question = faqQuestion || `[From resolved ticket ${caseId}]`;
        const keywords = question
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length > 2)
          .slice(0, 10);

        await db.query(
          `INSERT INTO faq_entries (question, answer, category, keywords)
           VALUES ($1, $2, $3, $4)`,
          [question, faqAnswer, faqCategory, keywords]
        );
      }

      // Notify the student widget in real time that the session is closed so
      // it immediately switches back to AI mode and shows the closing banner.
      pushToSession(session_id, {
        type: "staff_message",
        content: staffMsg,
        staff_name: "OSA Staff",
        case_id: caseId,
        timestamp: new Date().toISOString(),
        session_closed: true,
      });

      pushToAdminTickets({
        type: "ticket_updated",
        case_id: caseId,
        status: "resolved",
        timestamp: new Date().toISOString(),
      });

      return res.json({
        success: true,
        message: "Ticket resolved." + (promoteToFaq ? " Answer added to FAQ." : ""),
        promoted_to_faq: promoteToFaq,
        session_closed: true,
      });
    } catch (error) {
      return genericError(res, "chat", error);
    }
  });

  // Admin: delete resolved ticket from admin list
  app.delete(`${apiPrefix}/chat/tickets/:caseId`, requireAdminKey, async (req, res) => {
    const caseId = String((req.params && req.params.caseId) || "").trim();
    if (!caseId) return res.status(400).json({ success: false, message: "caseId is required." });
    try {
      const removed = await db.query(
        `DELETE FROM escalation_tickets
         WHERE case_id = $1
           AND status = 'resolved'
         RETURNING case_id`,
        [caseId]
      );
      if (!removed.rows.length) {
        return res.status(404).json({
          success: false,
          message: "Resolved ticket not found.",
        });
      }
      pushToAdminTickets({
        type: "ticket_deleted",
        case_id: caseId,
        status: "deleted",
        timestamp: new Date().toISOString(),
      });
      return res.json({ success: true, case_id: caseId, deleted: true });
    } catch (error) {
      return genericError(res, "chat", error);
    }
  });

  // Admin: Get single ticket status (for polling)
  app.get(`${apiPrefix}/chat/tickets/:caseId/status`, requireAdminKey, async (req, res) => {
    const caseId = String((req.params && req.params.caseId) || "").trim();
    if (!caseId) return res.status(400).json({ success: false, message: "caseId is required." });
    try {
      const result = await db.query(
        `SELECT case_id, status, appointment_status, updated_at FROM escalation_tickets WHERE case_id = $1`,
        [caseId]
      );
      if (!result.rows.length) return res.status(404).json({ success: false, message: "Ticket not found." });
      const ticket = result.rows[0];
      const status = String(ticket.status || "").toLowerCase();
      const appointmentStatus = String(ticket.appointment_status || "").toLowerCase();
      const effectiveStatus =
        status !== "resolved" && appointmentStatus === "approved"
          ? "approved"
          : status;
      return res.json({
        success: true,
        ticket: {
          ...ticket,
          effective_status: effectiveStatus,
        },
      });
    } catch (error) {
      return genericError(res, "chat", error);
    }
  });

  // Admin: lightweight tab counters so new open requests stay visible
  // even while staff are browsing a different status tab.
  app.get(`${apiPrefix}/chat/tickets/counts`, requireAdminKey, async (_req, res) => {
    try {
      const [openResult, resolvedResult, inProgressResult] = await Promise.all([
        db.query(`SELECT count(*)::int AS c FROM escalation_tickets WHERE status = 'open'`),
        db.query(`SELECT count(*)::int AS c FROM escalation_tickets WHERE status = 'resolved'`),
        db.query(
          `SELECT session_id, appointment_status
             FROM escalation_tickets
            WHERE status = 'in_progress'`
        ),
      ]);

      const open = Number((openResult.rows[0] && openResult.rows[0].c) || 0);
      const resolved = Number((resolvedResult.rows[0] && resolvedResult.rows[0].c) || 0);
      const in_progress = inProgressResult.rows.filter((t) => {
        return (
          !!(sseClients.get(t.session_id) && sseClients.get(t.session_id).size > 0) ||
          String(t.appointment_status || "").toLowerCase() === "approved"
        );
      }).length;

      return res.json({
        success: true,
        counts: { open, in_progress, resolved },
      });
    } catch (error) {
      return genericError(res, "chat-ticket-counts", error);
    }
  });

  // Admin: List tickets
  app.get(`${apiPrefix}/chat/tickets`, requireAdminKey, async (req, res) => {
    const status = String((req.query && req.query.status) || "open").trim().toLowerCase();
    const searchQ = String((req.query && req.query.q) || "").trim().toLowerCase();

    // 'approved' is no longer a standalone tab. Approved-appointment tickets
    // now live under 'in_progress' until they are explicitly resolved. Any
    // legacy ?status=approved request is transparently treated as in_progress.
    const allowed = { open: 1, in_progress: 1, resolved: 1 };
    const requested = status === "approved" ? "in_progress" : status;
    const normalizedStatus = allowed[requested] ? requested : "open";

    const where = [];
    const vals = [];
    let p = 1;

    where.push(`t.status = $${p++}`);
    vals.push(normalizedStatus);

    if (searchQ) {
      where.push(
        `(lower(t.case_id) LIKE $${p} OR lower(t.student_name) LIKE $${p} OR lower(t.student_email) LIKE $${p})`
      );
      vals.push(`%${searchQ}%`);
      p += 1;
    }

    try {
      const result = await db.query(
        `SELECT t.case_id, t.session_id, t.student_name, t.student_email, t.concern, t.status, t.staff_reply, t.created_at,
                t.updated_at, sm.last_staff_at,
                t.ticket_type, t.claim_item_number, t.appointment_track, t.appointment_status,
                t.preferred_day, t.preferred_time_window,
                t.appointment_datetime, t.appointment_location, t.appointment_notes,
                t.appointment_approved_at, t.appointment_approved_by,
                t.arrived_at, t.visit_completed_at,
                t.resolution_reason
         FROM escalation_tickets t
         LEFT JOIN LATERAL (
           SELECT MAX(created_at) AS last_staff_at
           FROM chat_messages m
           WHERE m.session_id = t.session_id
             AND m.role = 'assistant'
             AND m.content LIKE '[OSA Staff · %'
         ) sm ON true
         WHERE ${where.join(" AND ")}
         ORDER BY
           CASE WHEN t.arrived_at IS NOT NULL AND t.visit_completed_at IS NULL THEN t.arrived_at END ASC NULLS LAST,
           CASE WHEN t.appointment_status = 'approved' THEN t.appointment_approved_at END DESC NULLS LAST,
           t.created_at ASC`,
        vals
      );
      let tickets = result.rows.map((t) => ({
        ...t,
        is_student_active: !!(sseClients.get(t.session_id) && sseClients.get(t.session_id).size > 0),
        needs_end_session_prompt: (() => {
          if (t.status !== "in_progress" || !t.last_staff_at) return false;
          const lastMs = new Date(t.last_staff_at).getTime();
          if (!Number.isFinite(lastMs)) return false;
          return Date.now() - lastMs >= STAFF_CHAT_IDLE_MS;
        })(),
      }));
      // Hide stale "in progress" rows whose student session is offline,
      // EXCEPT when the appointment has already been approved — those need
      // to remain visible (they live under In Progress until resolved) so
      // staff can find and close them out even after the student logs off.
      if (normalizedStatus === "in_progress") {
        tickets = tickets.filter(
          (t) =>
            t.is_student_active ||
            String(t.appointment_status || "").toLowerCase() === "approved"
        );
      }
      return res.json({ success: true, tickets });
    } catch (error) {
      return genericError(res, "chat", error);
    }
  });

  // SSE stream: student subscribes to receive real-time staff messages
  app.get(`${apiPrefix}/chat/stream/:sessionId`, async (req, res) => {
    const sessionId = String((req.params && req.params.sessionId) || "").trim();
    if (!sessionId) return res.status(400).end();
    if (!isValidSessionId(sessionId)) return res.status(400).end();

    try {
      const loaded = await loadSessionRow(sessionId);
      if (!loaded.found) return res.status(404).end();
      if (loaded.expired) return res.status(401).end();
    } catch (_) {
      return res.status(500).end();
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    res.write(":connected\n\n");

    if (!sseClients.has(sessionId)) sseClients.set(sessionId, new Set());
    sseClients.get(sessionId).add(res);

    const keepalive = setInterval(() => { try { res.write(":ping\n\n"); } catch (_) {} }, 25000);

    req.on("close", () => {
      clearInterval(keepalive);
      const clients = sseClients.get(sessionId);
      if (clients) {
        clients.delete(res);
        if (!clients.size) sseClients.delete(sessionId);
      }
    });
  });

  // SSE stream: admin subscribes for real-time ticket list refresh
  app.get(`${apiPrefix}/chat/admin/stream`, (req, res) => {
    const token = String((req.query && req.query.token) || "").trim();
    if (!isAdminTokenAuthorized(token)) {
      return res.status(401).end();
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    res.write(":connected\n\n");

    adminTicketClients.add(res);
    const keepalive = setInterval(() => { try { res.write(":ping\n\n"); } catch (_) {} }, 25000);

    req.on("close", () => {
      clearInterval(keepalive);
      adminTicketClients.delete(res);
    });
  });

  // Check if student is connected (for staff portal active indicator)
  app.get(`${apiPrefix}/chat/session/:sessionId/active`, async (req, res) => {
    const sessionId = String((req.params && req.params.sessionId) || "").trim();
    if (!sessionId || !isValidSessionId(sessionId)) {
      return res.json({ active: false });
    }
    try {
      const loaded = await loadSessionRow(sessionId);
      if (!loaded.found || loaded.expired) return res.json({ active: false });
    } catch (_) {
      return res.json({ active: false });
    }
    const clients = sseClients.get(sessionId);
    res.json({ active: !!(clients && clients.size > 0) });
  });

  async function closeTicketSession(caseId, staffName, sourceTag) {
    const ticketResult = await db.query(
      `SELECT session_id, status FROM escalation_tickets WHERE case_id = $1`,
      [caseId]
    );
    if (!ticketResult.rows.length) return { ok: false, notFound: true };

    const { session_id, status } = ticketResult.rows[0];
    if (status === "resolved") return { ok: false, alreadyClosed: true, session_id };

    const reason = sourceTag || "closed by OSA staff";
    const endMsg =
      `[OSA Staff · ${staffName}]\n\n` +
      `This live support session is now closed (${reason}). If you still need help, you may start a new concern.`;

    await db.query(
      `UPDATE escalation_tickets
       SET status = 'resolved', staff_reply = $1, updated_at = NOW()
       WHERE case_id = $2`,
      [endMsg, caseId]
    );
    await db.query(
      `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
      [session_id, endMsg]
    );
    await db.query(`UPDATE chat_sessions SET last_active_at = NOW() WHERE id = $1`, [session_id]);

    const delivered = pushToSession(session_id, {
      type: "staff_message",
      content: endMsg,
      staff_name: staffName,
      case_id: caseId,
      timestamp: new Date().toISOString(),
      session_closed: true,
    });
    pushToAdminTickets({
      type: "ticket_updated",
      case_id: caseId,
      status: "resolved",
      timestamp: new Date().toISOString(),
    });
    return { ok: true, delivered, session_id };
  }

  // Staff: close a live session manually from admin UI
  app.post(`${apiPrefix}/chat/tickets/:caseId/end-session`, requireAdminKey, async (req, res) => {
    const caseId = String((req.params && req.params.caseId) || "").trim();
    const staffName = String((req.body && req.body.staff_name) || "OSA Staff").trim();

    if (!caseId) {
      return res.status(400).json({ success: false, message: "caseId is required." });
    }
    try {
      const closed = await closeTicketSession(caseId, staffName, "ended by staff");
      if (closed.notFound) return res.status(404).json({ success: false, message: "Ticket not found." });
      if (closed.alreadyClosed) {
        return res.status(409).json({ success: false, message: "This session is already closed." });
      }
      return res.json({ success: true, delivered: closed.delivered, session_closed: true });
    } catch (error) {
      return genericError(res, "chat", error);
    }
  });

  // Staff: send live message to student
  app.post(`${apiPrefix}/chat/tickets/:caseId/staff-message`, requireAdminKey, async (req, res) => {
    const caseId   = String((req.params && req.params.caseId) || "").trim();
    const content  = String((req.body && req.body.content) || "").trim();
    const staffName = String((req.body && req.body.staff_name) || "OSA Staff").trim();

    if (!caseId || !content) {
      return res.status(400).json({ success: false, message: "caseId and content are required." });
    }

    try {
      const ticketResult = await db.query(
        `SELECT session_id, student_name, status FROM escalation_tickets WHERE case_id = $1`,
        [caseId]
      );
      if (!ticketResult.rows.length) {
        return res.status(404).json({ success: false, message: "Ticket not found." });
      }

      const { session_id, status: prevStatus } = ticketResult.rows[0];
      // Refuse to post staff messages into a resolved/closed ticket — the
      // session is already shut down and the student widget is back in AI
      // mode. Without this guard, staff can leak orphan bubbles into a
      // closed conversation thread.
      if (prevStatus === "resolved") {
        return res.status(409).json({
          success: false,
          code: "TICKET_RESOLVED",
          message: "This support session is already closed. Reopen a new ticket to continue.",
        });
      }
      const firstStaffReply = prevStatus === "open";
      const normalized = content.toLowerCase();
      const isEndSessionCmd = normalized === "/end session" || normalized === "/endsession";

      if (isEndSessionCmd) {
        const closed = await closeTicketSession(caseId, staffName, "ended by staff command");
        if (closed.notFound) return res.status(404).json({ success: false, message: "Ticket not found." });
        if (closed.alreadyClosed) {
          return res.status(409).json({ success: false, message: "This session is already closed." });
        }
        return res.json({ success: true, delivered: closed.delivered, session_closed: true });
      }

      const msgContent = `[OSA Staff · ${staffName}]\n\n${content}`;

      // On first staff reply, emit a join announcement to the student so the
      // UI can clearly mark "OSA Staff has joined the chat" as a system event.
      if (firstStaffReply) {
        const joinMsg = `OSA Staff ${staffName} has joined the chat.`;
        await db.query(
          `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
          [session_id, `[system] ${joinMsg}`]
        );
        pushToSession(session_id, {
          type: "staff_joined",
          staff_name: staffName,
          case_id: caseId,
          content: joinMsg,
          timestamp: new Date().toISOString(),
        });
      }

      await db.query(
        `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
        [session_id, msgContent]
      );
      await db.query(`UPDATE chat_sessions SET last_active_at = NOW() WHERE id = $1`, [session_id]);
      // Mark in_progress when staff first replies
      await db.query(
        `UPDATE escalation_tickets SET status = 'in_progress', updated_at = NOW()
         WHERE case_id = $1 AND status IN ('open','in_progress')`,
        [caseId]
      );

      const delivered = pushToSession(session_id, {
        type: "staff_message",
        content: msgContent,
        staff_name: staffName,
        case_id: caseId,
        timestamp: new Date().toISOString(),
      });
      pushToAdminTickets({
        type: "ticket_updated",
        case_id: caseId,
        status: "in_progress",
        timestamp: new Date().toISOString(),
      });

      return res.json({ success: true, delivered, first_staff_reply: firstStaffReply });
    } catch (error) {
      return genericError(res, "chat", error);
    }
  });

  // ── Real-time presence: typing + seen receipts ─────────────────
  // These are ephemeral signals that fan out via the existing SSE
  // streams (per-session for students, admin stream for staff).
  // They never touch the database — clients throttle/debounce.

  // Student → admin: "I am typing" / "I stopped typing"
  app.post(`${apiPrefix}/chat/typing`, async (req, res) => {
    const sessionId = String((req.body && req.body.session_id) || "").trim();
    const stopped = !!(req.body && req.body.stopped);
    if (!sessionId || !isValidSessionId(sessionId)) {
      return res.status(400).json({ success: false, message: "Invalid session_id." });
    }
    try {
      const loaded = await loadSessionRow(sessionId);
      if (!loaded.found || loaded.expired) {
        return res.status(401).json({ success: false, message: "Session not active." });
      }
      let caseId = "";
      try {
        const t = await db.query(
          `SELECT case_id FROM escalation_tickets
           WHERE session_id = $1 AND status IN ('open','in_progress')
           ORDER BY created_at DESC LIMIT 1`,
          [sessionId]
        );
        if (t.rows.length) caseId = String(t.rows[0].case_id || "");
      } catch (_) {}
      pushToAdminTickets({
        type: stopped ? "student_typing_stop" : "student_typing",
        session_id: sessionId,
        case_id: caseId || null,
        timestamp: new Date().toISOString(),
      });
      return res.json({ success: true });
    } catch (error) {
      return genericError(res, "chat", error);
    }
  });

  // Student → admin: "I have seen staff messages up to now"
  app.post(`${apiPrefix}/chat/seen`, async (req, res) => {
    const sessionId = String((req.body && req.body.session_id) || "").trim();
    if (!sessionId || !isValidSessionId(sessionId)) {
      return res.status(400).json({ success: false, message: "Invalid session_id." });
    }
    try {
      const loaded = await loadSessionRow(sessionId);
      if (!loaded.found || loaded.expired) {
        return res.status(401).json({ success: false, message: "Session not active." });
      }
      let caseId = "";
      try {
        const t = await db.query(
          `SELECT case_id FROM escalation_tickets
           WHERE session_id = $1 AND status IN ('open','in_progress')
           ORDER BY created_at DESC LIMIT 1`,
          [sessionId]
        );
        if (t.rows.length) caseId = String(t.rows[0].case_id || "");
      } catch (_) {}
      pushToAdminTickets({
        type: "student_seen",
        session_id: sessionId,
        case_id: caseId || null,
        timestamp: new Date().toISOString(),
      });
      return res.json({ success: true });
    } catch (error) {
      return genericError(res, "chat", error);
    }
  });

  // Staff → student: "I am typing"
  app.post(`${apiPrefix}/chat/tickets/:caseId/staff-typing`, requireAdminKey, async (req, res) => {
    const caseId = String((req.params && req.params.caseId) || "").trim();
    const staffName = String((req.body && req.body.staff_name) || "OSA Staff").trim();
    const stopped = !!(req.body && req.body.stopped);
    if (!caseId) {
      return res.status(400).json({ success: false, message: "caseId is required." });
    }
    try {
      const t = await db.query(
        `SELECT session_id FROM escalation_tickets WHERE case_id = $1`,
        [caseId]
      );
      if (!t.rows.length) {
        return res.status(404).json({ success: false, message: "Ticket not found." });
      }
      const sessionId = t.rows[0].session_id;
      const delivered = pushToSession(sessionId, {
        type: stopped ? "staff_typing_stop" : "staff_typing",
        case_id: caseId,
        staff_name: staffName,
        timestamp: new Date().toISOString(),
      });
      return res.json({ success: true, delivered });
    } catch (error) {
      return genericError(res, "chat", error);
    }
  });

  // Staff → student: "I have seen your messages up to now"
  app.post(`${apiPrefix}/chat/tickets/:caseId/staff-seen`, requireAdminKey, async (req, res) => {
    const caseId = String((req.params && req.params.caseId) || "").trim();
    const staffName = String((req.body && req.body.staff_name) || "OSA Staff").trim();
    if (!caseId) {
      return res.status(400).json({ success: false, message: "caseId is required." });
    }
    try {
      const t = await db.query(
        `SELECT session_id FROM escalation_tickets WHERE case_id = $1`,
        [caseId]
      );
      if (!t.rows.length) {
        return res.status(404).json({ success: false, message: "Ticket not found." });
      }
      const sessionId = t.rows[0].session_id;
      const delivered = pushToSession(sessionId, {
        type: "staff_seen",
        case_id: caseId,
        staff_name: staffName,
        timestamp: new Date().toISOString(),
      });
      return res.json({ success: true, delivered });
    } catch (error) {
      return genericError(res, "chat", error);
    }
  });

  // Get session messages
  app.get(`${apiPrefix}/chat/session/:sessionId/messages`, async (req, res) => {
    const sessionId = String((req.params && req.params.sessionId) || "").trim();
    if (!sessionId) {
      return res.status(400).json({ success: false, message: "sessionId is required." });
    }
    if (!isValidSessionId(sessionId)) {
      return res.status(400).json({ success: false, message: "Invalid sessionId format." });
    }
    // Admins (chat-support / chat-logs panels) need read-only access to the
    // historical thread of *any* ticket — including resolved cases whose
    // student session has since gone idle/expired or whose student has logged
    // out. Detect a valid admin key and bypass the student-side expiry guard.
    const adminProvided = String((req.headers && req.headers["x-admin-key"]) || "").trim();
    const isAdminCall =
      !String(process.env.ADMIN_KEY || "").trim() ||
      isAdminTokenAuthorized(adminProvided);
    try {
      const loaded = await loadSessionRow(sessionId);
      if (!loaded.found) {
        return res.status(404).json({ success: false, message: "Session not found." });
      }
      if (loaded.expired && !isAdminCall) {
        return res.status(401).json({
          success: false,
          code: "SESSION_EXPIRED",
          message: "Secure chat session expired. Please verify your email again.",
        });
      }
      const msgs = await db.query(
        `SELECT role, content, created_at FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC`,
        [sessionId]
      );
      // Normalize stored `[system] …` notices (the "OSA Staff has joined the
      // chat" banner is persisted as a role=assistant row with a [system]
      // prefix) into proper role='system' rows so both the student widget
      // and the admin thread can render them as a system event instead of
      // an ugly raw assistant bubble. The DB record is left untouched for
      // backward compatibility — the projection only happens in the API.
      const SYSTEM_PREFIX = "[system] ";
      const normalizedMessages = (msgs.rows || []).map((row) => {
        const content = String(row.content || "");
        if (row.role === "assistant" && content.startsWith(SYSTEM_PREFIX)) {
          return { ...row, role: "system", content: content.slice(SYSTEM_PREFIX.length).trim() };
        }
        return row;
      });
      const sessionPayload = loaded.session || (isAdminCall ? { id: sessionId, expired: true } : null);
      return res.json({ success: true, session: sessionPayload, messages: normalizedMessages });
    } catch (error) {
      return genericError(res, "chat", error);
    }
  });

  // ── Background cleanup: idle / abandoned tickets ──────────────────
  // Runs every 5 minutes. Tickets are NEVER hard-deleted by this sweep
  // — they are closed with a distinguishing resolution_reason so admins
  // can tell at a glance what happened in the Resolved tab.
  //
  //   • UNAPPROVED + no staff engagement + idle
  //         → status='resolved', resolution_reason='abandoned'
  //         (student walked away before any admin replied)
  //   • Engaged general escalation + idle
  //         → status='resolved', resolution_reason='auto_closed_idle'
  //         (admin replied at least once, then both sides went silent)
  //   • Approved appointment / claim tickets are LEFT ALONE — they hold
  //     a future scheduled date that must remain visible until manual
  //     resolution after the visit / pickup.
  const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
  const idleCleanupTimer = setInterval(async () => {
    try {
      const idleSec = Math.max(60, Math.floor(STAFF_CHAT_IDLE_MS / 1000));

      // 1) Mark abandoned (unapproved, no staff reply ever) → resolved + 'abandoned'
      const abandoned = await db.query(
        `WITH activity AS (
           SELECT t.case_id, t.session_id,
                  COALESCE((SELECT MAX(created_at) FROM chat_messages m
                            WHERE m.session_id = t.session_id), t.created_at) AS last_at,
                  EXISTS (SELECT 1 FROM chat_messages m
                          WHERE m.session_id = t.session_id
                            AND m.role = 'assistant'
                            AND m.content LIKE '[OSA Staff · %') AS staff_engaged
           FROM escalation_tickets t
           WHERE t.status IN ('open', 'in_progress')
             AND COALESCE(t.appointment_status, '') <> 'approved'
             AND COALESCE(t.resolution_reason, '') = ''
         )
         UPDATE escalation_tickets
         SET status = 'resolved',
             resolution_reason = 'abandoned',
             updated_at = NOW()
         WHERE case_id IN (
           SELECT case_id FROM activity
           WHERE staff_engaged = false
             AND last_at < NOW() - ($1 || ' seconds')::interval
         )
         RETURNING case_id`,
        [String(idleSec)]
      );

      // 2) Auto-close idle general escalations that the admin engaged
      //    but went quiet on → resolved + 'auto_closed_idle'
      const idleClosed = await db.query(
        `WITH activity AS (
           SELECT t.case_id, t.session_id,
                  COALESCE((SELECT MAX(created_at) FROM chat_messages m
                            WHERE m.session_id = t.session_id), t.created_at) AS last_at
           FROM escalation_tickets t
           WHERE t.status = 'in_progress'
             AND COALESCE(t.ticket_type, 'general') = 'general'
             AND COALESCE(t.appointment_status, '') <> 'approved'
             AND COALESCE(t.resolution_reason, '') = ''
         )
         UPDATE escalation_tickets
         SET status = 'resolved',
             resolution_reason = 'auto_closed_idle',
             updated_at = NOW()
         WHERE case_id IN (
           SELECT case_id FROM activity
           WHERE last_at < NOW() - ($1 || ' seconds')::interval
         )
         RETURNING case_id`,
        [String(idleSec)]
      );

      if (abandoned.rows.length || idleClosed.rows.length) {
        console.log(
          `[chat-cleanup] idle sweep: abandoned=${abandoned.rows.length} auto_closed_idle=${idleClosed.rows.length}`
        );
        abandoned.rows.forEach((r) => {
          pushToAdminTickets({
            type: "ticket_updated",
            case_id: r.case_id,
            status: "resolved",
            resolution_reason: "abandoned",
            timestamp: new Date().toISOString(),
          });
        });
        idleClosed.rows.forEach((r) => {
          pushToAdminTickets({
            type: "ticket_updated",
            case_id: r.case_id,
            status: "resolved",
            resolution_reason: "auto_closed_idle",
            timestamp: new Date().toISOString(),
          });
        });
      }
    } catch (err) {
      logError("chat-cleanup", err);
    }
  }, CLEANUP_INTERVAL_MS);
  if (idleCleanupTimer && typeof idleCleanupTimer.unref === "function") {
    idleCleanupTimer.unref();
  }
}

module.exports = { registerChatRoutes };
