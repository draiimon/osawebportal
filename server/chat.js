const { GoogleGenAI } = require("@google/genai");
const crypto = require("crypto");
const db = require("./db");

const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY || "").trim();
const GROQ_API_KEY = String(process.env.GROQ_API_KEY || "").trim();
const gemini = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
const GEMINI_MODEL = String(process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
const GROQ_MODEL = String(process.env.GROQ_MODEL || "qwen/qwen3-32b").trim();
const GROQ_BASE_URL = String(process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1")
  .trim()
  .replace(/\/+$/, "");
const GROQ_FINAL_ONLY_INSTRUCTION =
  "Return only the final user-facing answer. Do not include reasoning traces or <think> tags.";
const CHAT_PRIMARY_PROVIDER = String(process.env.CHAT_PRIMARY_PROVIDER || "gemini").trim().toLowerCase();
const CHAT_FALLBACK_PROVIDER = String(process.env.CHAT_FALLBACK_PROVIDER || "groq").trim().toLowerCase();
const MAX_OUTPUT_TOKENS = Number(process.env.CHAT_MAX_OUTPUT_TOKENS || 220);
const TIER1_MAX_OUTPUT_TOKENS = Number(process.env.CHAT_TIER1_MAX_OUTPUT_TOKENS || 170);
const CHAT_TEMPERATURE = Number(process.env.CHAT_TEMPERATURE || 0.4);
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

function pushUnique(values, value) {
  const next = String(value || "").trim().toLowerCase();
  if (!next || values.includes(next)) return;
  values.push(next);
}

function getLlmProviderOrder() {
  const order = [];
  pushUnique(order, CHAT_PRIMARY_PROVIDER);
  pushUnique(order, CHAT_FALLBACK_PROVIDER);
  pushUnique(order, "gemini");
  pushUnique(order, "groq");

  return order.filter((provider) => {
    if (provider === "gemini") return !!gemini;
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

async function generateWithGemini(options) {
  if (!gemini) throw new Error("Gemini is not configured.");

  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    config: {
      ...(options.systemPrompt ? { systemInstruction: options.systemPrompt } : {}),
      ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
      temperature: CHAT_TEMPERATURE,
    },
    contents: mapMessagesToGemini(options.messages),
  });

  return String((response && response.text) || "").trim();
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
      reasoning_format: "hidden",
      reasoning_effort: "none",
      temperature: CHAT_TEMPERATURE > 0 ? CHAT_TEMPERATURE : 0.00000001,
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
    throw new Error("No LLM provider configured. Set GEMINI_API_KEY or GROQ_API_KEY.");
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

function requireAdminKey(req, res, next) {
  const expected = String(process.env.ADMIN_KEY || "").trim();
  if (!expected) {
    // Dev-mode fallback: allow when unset, but warn loudly so prod doesn't ship open.
    // eslint-disable-next-line no-console
    console.warn("[admin] ADMIN_KEY is not set — admin routes are unauthenticated (dev only).");
    return next();
  }
  const provided = String((req.headers && req.headers["x-admin-key"]) || "").trim();
  if (provided !== expected) {
    return res.status(401).json({ success: false, message: "Unauthorized." });
  }
  return next();
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

function pushToSession(sessionId, payload) {
  const clients = sseClients.get(sessionId);
  if (!clients || !clients.size) return false;
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  clients.forEach((res) => { try { res.write(line); } catch (_) {} });
  return true;
}

// Non-fatal email to OSA staff when a ticket is escalated
async function sendStaffNotificationEmail(caseId, studentName, studentEmail, concern, variant) {
  try {
    const staffEmail = (process.env.OSA_STAFF_EMAIL || "").trim();
    const apiKey    = (process.env.Brevo_API_KEY || "").trim();
    const sender    = (process.env.BREVO_SENDER_EMAIL || "").trim();
    if (!staffEmail || !apiKey || !sender) return;

    const portalUrl  = (process.env.PORTAL_URL || "").replace(/\/$/, "");
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

    await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        sender: { name: process.env.BREVO_SENDER_NAME || "OSA System", email: sender },
        to: [{ email: staffEmail }],
        subject: variant === "claim"
          ? `[OSA] LF Claim — ${caseId} · ${studentName}`
          : `[OSA] New Escalation — ${caseId} · ${studentName}`,
        htmlContent: html,
      }),
    });
  } catch (_) {
    // Non-fatal: ticket is already created, email failure shouldn't block
  }
}

async function sendStudentEscalationEmail(caseId, studentName, studentEmail, concern, variant) {
  try {
    const apiKey = (process.env.Brevo_API_KEY || "").trim();
    const sender = (process.env.BREVO_SENDER_EMAIL || "").trim();
    if (!apiKey || !sender || !studentEmail) return;

    const isClaim = variant === "claim";
    const portalUrl = (process.env.PORTAL_URL || "").replace(/\/$/, "");
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
      `<p style="font-size:13px;color:#191412;margin:0 0 10px">Keep this Case ID for reference. An OSA staff member will respond in chat as soon as available.</p>` +
      `<div style="background:#fff8f0;border-left:4px solid #c79a49;padding:14px 16px;font-size:14px;line-height:1.6;white-space:pre-wrap">${concern}</div>` +
      btnHtml +
      `<p style="font-size:12px;color:#65574d;margin-top:16px">This is an automated message from the OSA Transaction Guide Portal.</p>` +
      `</div>`;

    await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        sender: { name: process.env.BREVO_SENDER_NAME || "OSA System", email: sender },
        to: [{ email: studentEmail }],
        subject: isClaim ? `[OSA] Lost & Found Claim — ${caseId}` : `[OSA] Support Escalation Received — ${caseId}`,
        htmlContent: html,
      }),
    });
  } catch (_) {
    // Non-fatal.
  }
}

async function sendEscalationWaitReminderEmail(caseId, studentName, studentEmail, concern) {
  try {
    const staffEmail = (process.env.OSA_STAFF_EMAIL || "").trim();
    const apiKey = (process.env.Brevo_API_KEY || "").trim();
    const sender = (process.env.BREVO_SENDER_EMAIL || "").trim();
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

    await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        sender: { name: process.env.BREVO_SENDER_NAME || "OSA System", email: sender },
        to: toList,
        subject: `[OSA] Reminder: Pending Response — ${caseId}`,
        htmlContent: html,
      }),
    });
  } catch (_) {
    // Non-fatal.
  }
}

// Keywords that trigger Tier 3 escalation
const ESCALATION_TRIGGERS = [
  "escalate",
  "human support",
  "human agent",
  "talk to staff",
  "speak to staff",
  "live agent",
  "representative",
  "create ticket",
  "file ticket",
  "complaint",
  "report concern",
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

  // On expiry, remove both the session and its messages so stale rows don't keep
  // returning `expired: true` forever. ON DELETE CASCADE clears chat_messages.
  await db.query(`DELETE FROM chat_sessions WHERE id = $1`, [sessionId]);
  return { found: true, expired: true, session: null };
}

// ── Tier 1: FAQ keyword match ─────────────────────────────────
async function searchFaq(message) {
  try {
    const words = message
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);

    if (!words.length) return null;

    // Match by keywords array overlap OR question similarity
    const result = await db.query(
      `SELECT id, question, answer, category
       FROM faq_entries
       WHERE is_active = true
         AND (
           keywords && $1::text[]
           OR lower(question) LIKE ANY($2::text[])
         )
       ORDER BY times_matched DESC
       LIMIT 1`,
      [
        words,
        words.map((w) => `%${w}%`),
      ]
    );

    if (result.rows.length) {
      const faq = result.rows[0];
      // Increment match counter
      await db.query(
        `UPDATE faq_entries SET times_matched = times_matched + 1, updated_at = NOW() WHERE id = $1`,
        [faq.id]
      );
      return faq;
    }
    return null;
  } catch (_e) {
    return null;
  }
}

/** Tier 2 RAG-lite: retrieve Student Manual / policy excerpts by keyword overlap. */
async function searchManualKnowledge(message) {
  try {
    const words = String(message || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);

    if (!words.length) return "";

    const result = await db.query(
      `SELECT section_title, chunk_text
       FROM student_manual_chunks
       WHERE is_active = true
         AND (
           keywords && $1::text[]
           OR lower(chunk_text) LIKE ANY ($2::text[])
         )
       ORDER BY section_title ASC
       LIMIT 5`,
      [words, words.map((w) => `%${w}%`)]
    );

    if (!result.rows.length) return "";

    return result.rows
      .map((row) => {
        const title = String(row.section_title || "Section").trim();
        const body = String(row.chunk_text || "").trim();
        return title ? `### ${title}\n${body}` : body;
      })
      .join("\n\n");
  } catch (_e) {
    return "";
  }
}

// ── Tier 2: Gemini context ────────────────────────────────────
async function getOsaContext() {
  try {
    const [ann, items] = await Promise.all([
      db.query(
        `SELECT title, category, details FROM announcements WHERE is_active = true ORDER BY created_at DESC LIMIT 6`
      ),
      db.query(
        `SELECT item_number, title, tag FROM lost_found_items WHERE is_active = true AND status = 'Unclaimed' ORDER BY created_at DESC LIMIT 10`
      ),
    ]);
    let ctx = "";
    if (ann.rows.length) {
      ctx += "\n\nCURRENT OSA ANNOUNCEMENTS:\n";
      ann.rows.forEach((a) => {
        ctx += `- [${a.category}] ${a.title}: ${a.details || "No details."}\n`;
      });
    }
    if (items.rows.length) {
      ctx += "\n\nUNCLAIMED LOST & FOUND ITEMS:\n";
      items.rows.forEach((i) => {
        ctx += `- ${i.item_number}: ${i.title} (${i.tag})\n`;
      });
    }
    return ctx;
  } catch (_e) {
    return "";
  }
}

function buildSystemPrompt(name, email, ctx, manualRag) {
  const ragBlock =
    manualRag && String(manualRag).trim()
      ? `\n\nSTUDENT MANUAL / POLICY EXCERPTS (retrieved for this question — treat as authoritative for campus rules; do not contradict them):\n${manualRag.trim()}\n`
      : "";

  return (
    `You are the OSA (Office of Student Affairs) AI Transaction Guide Assistant for Emilio Aguinaldo College (EAC) Cavite Campus. ` +
    `You operate in Tier 2: your answers may be grounded in the retrieved context below (announcements, lost-and-found snapshot, and manual excerpts).\n\n` +
    `You help students navigate OSA services using a 3-tier approach.\n\n` +
    `You assist with:\n` +
    `- Scholarship applications and eligibility requirements\n` +
    `- Good Moral Certificate requests (step-by-step process)\n` +
    `- Lost and Found item inquiries and claims\n` +
    `- Appointments and scheduling with OSA staff\n` +
    `- OSA policies, announcements, and general student affairs inquiries\n\n` +
    `Guidelines:\n` +
    `- Be warm, friendly, and professional.\n` +
    `- For simple greetings (e.g., "hi"), reply in 1-2 short sentences only.\n` +
    `- Do not guess or invent the student's real name from email username.\n` +
    `- Keep answers concise by default (2-4 short sentences unless user asks for detail).\n` +
    `- Prefer practical steps over long explanations.\n` +
    `- Provide clear, step-by-step guidance.\n\n` +
    `APPOINTMENTS / SCHEDULING — IMPORTANT:\n` +
    `- This chat itself can create an appointment request for the student.\n` +
    `- When a student wants to schedule a meeting or visit OSA, DO NOT tell them to:\n` +
    `    * email OSA\n` +
    `    * call OSA\n` +
    `    * visit the office to book\n` +
    `    * check the website for contact info\n` +
    `- Instead, ask them for: (1) purpose of the visit, (2) preferred weekday, (3) preferred time window (Morning or Afternoon), then say exactly:\n` +
    `    "I recommend escalating this to an OSA staff member."\n` +
    `  so the system can open a ticket and let staff confirm the slot in this same chat.\n\n` +
    `ESCALATION:\n` +
    `- If the concern is complex, sensitive, or you are unsure, suggest escalation to OSA staff.\n` +
    `- When suggesting escalation, say exactly: "I recommend escalating this to an OSA staff member."\n` +
    `- If escalation is needed, tell the student we can escalate directly in this same chat.\n` +
    `- Do not claim that you cannot connect them to staff through this chat.\n` +
    `- Keep responses focused on EAC OSA services only.\n\n` +
    `Current student: ${name} (${email})` +
    ctx +
    ragBlock
  );
}

async function generateTier1FaqReply(studentName, userMessage, faqMatch) {
  const safeQuestion = String(userMessage || "").trim();
  const faqQuestion = String((faqMatch && faqMatch.question) || "").trim();
  const faqAnswer = String((faqMatch && faqMatch.answer) || "").trim();
  const faqCategory = String((faqMatch && faqMatch.category) || "General").trim();

  if (!faqAnswer) return "";

  try {
    return await generateLlmText({
      maxOutputTokens: TIER1_MAX_OUTPUT_TOKENS,
      messages: [
        {
          role: "user",
          content:
            `You are responding to a student using an approved OSA FAQ answer.\n` +
            `Rewrite naturally and clearly, but do not change policy meaning.\n` +
            `Keep it concise and actionable (2-5 short paragraphs or bullets when helpful).\n` +
            `Avoid guessing or using a personal name unless explicitly provided by the user.\n\n` +
            `Student asked:\n${safeQuestion}\n\n` +
            `Approved FAQ category: ${faqCategory}\n` +
            `Approved FAQ question: ${faqQuestion}\n` +
            `Approved FAQ answer:\n${faqAnswer}\n\n` +
            `Important:\n` +
            `- Use only the approved answer as source of truth\n` +
            `- Do not invent requirements, fees, schedules, or deadlines\n` +
            `- If details are missing, explicitly say the student should confirm with official OSA posting/admin\n`,
        },
      ],
    });
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

  // Human support / general concern routing
  if (
    m.includes("human support") ||
    m.includes("human agent") ||
    m.includes("talk to staff") ||
    m.includes("speak to staff") ||
    m.includes("live agent") ||
    m.includes("representative") ||
    m.includes("file complaint") ||
    m.includes("report concern") ||
    m.includes("escalate")
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
      "We can do that directly in this same chat—share your concern details and I will forward it for staff review.";
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
  const m = String(message || "").toLowerCase();
  if (m.includes("sino ako") || m.includes("who am i")) return true;
  if (m.includes("anong name ko") || m.includes("ano pangalan ko")) return true;
  if (m.includes("kilala mo ba ko") || m.includes("do you know me")) return true;
  return (
    m.includes("ano name ko") ||
    m.includes("what is my name") ||
    m.includes("what's my name") ||
    m.includes("my name?")
  );
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
  const m = String(raw || "").match(/\bLF[-\s]?(\d{3,6})\b/i);
  return m ? `LF-${m[1]}` : "";
}

// ── Route registration ────────────────────────────────────────
function registerChatRoutes(app, apiPrefix) {
  const { chatSessionLimiter, chatMsgLimiter } = app.locals.limiters || {};

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

        return res.json({
          success: true,
          session_id: sessionRow.id,
          student_name: studentName,
          email,
          session_expires_at: sessionExpiresAtIso(sessionRow),
          session_ttl_ms: CHAT_SESSION_TTL_MS,
        });
      } catch (error) {
        return genericError(res, "chat", error);
      }
    }
  );

  // Send message (3-tier logic)
  app.post(
    `${apiPrefix}/chat/message`,
    ...[chatMsgLimiter].filter(Boolean),
    async (req, res) => {
      const sessionId = String((req.body && req.body.session_id) || "").trim();
      const message = String((req.body && req.body.message) || "").trim();

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

        // Direct profile-aware answer for name queries.
        if (isNameQuery(message)) {
          const safeName = String(student_name || "Student").trim() || "Student";
          const nameReply =
            `You are currently signed in as ${safeName}. ` +
            `If this is not your preferred name, re-verify and enter your full name in the OTP card.`;

          await db.query(
            `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
            [sessionId, nameReply]
          );
          await db.query(`UPDATE chat_sessions SET last_active_at = NOW() WHERE id = $1`, [sessionId]);

          return res.json({
            success: true,
            reply: nameReply,
            tier: 2,
            suggest_escalation: false,
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

          let humanReply =
            activeHumanTicket.status === "open"
              ? `Your inquiry is already escalated to OSA staff (Case ID: ${activeHumanTicket.case_id}). ` +
                `AI is now paused for this case while waiting for human support. ` +
                `If there is no staff reply yet, we send a follow-up reminder after 5 minutes. ` +
                `If you prefer, you can also request an appointment schedule in this same chat.`
              : `Your session is now in live human support mode (Case ID: ${activeHumanTicket.case_id}). ` +
                `AI is paused while OSA staff handles this concern.`;

          if (activeHumanTicket.appointment_status === "approved") {
            humanReply += ` ✅ Appointment Approved for Case ID ${activeHumanTicket.case_id}. Please wait for final schedule details from OSA staff in this chat.`;
          } else if (activeHumanTicket.ticket_type === "claim" && !activeHumanTicket.appointment_track) {
            humanReply +=
              ` For your visit, choose **Claiming Appointment** or **Private Appointment** using the chat buttons (or type those words).`;
          } else if (activeHumanTicket.ticket_type === "claim" && activeHumanTicket.appointment_track && (!activeHumanTicket.preferred_day || !activeHumanTicket.preferred_time_window)) {
            humanReply += ` Please pick a preferred weekday and Morning or Afternoon using the buttons.`;
          }

          await db.query(
            `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
            [sessionId, humanReply]
          );
          await db.query(`UPDATE chat_sessions SET last_active_at = NOW() WHERE id = $1`, [sessionId]);

          return res.json({
            success: true,
            reply: humanReply,
            tier: 3,
            human_mode: true,
            case_id: activeHumanTicket.case_id,
            suggest_escalation: false,
          });
        }

        // ── TIER 1: FAQ search ───────────────────────────────
        const faqMatch = await searchFaq(message);
        if (faqMatch) {
          // Rewrite via LLM only when CHAT_TIER1_REWRITE=true; otherwise return the
          // curated answer directly for a fast, deterministic response.
          const aiTier1Reply = TIER1_REWRITE
            ? await generateTier1FaqReply(student_name, message, faqMatch)
            : "";
          const reply = aiTier1Reply || faqMatch.answer;

          await db.query(
            `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
            [sessionId, reply]
          );
          await db.query(`UPDATE chat_sessions SET last_active_at = NOW() WHERE id = $1`, [sessionId]);

          return res.json({
            success: true,
            reply,
            tier: 1,
            suggest_escalation: false,
          });
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
          getOsaContext(),
          searchManualKnowledge(message),
        ]);
        const systemPrompt = buildSystemPrompt(student_name, email, osaCtx, manualRag);

        const appointmentIntent = isAppointmentIntent(message);
        let rawReply = "";
        try {
          rawReply = await generateLlmText({
            systemPrompt,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
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
          const fallback =
            "I'm having trouble generating a response right now. " +
            "Please try rephrasing, or type 'human support' to reach OSA staff.";
          await db.query(
            `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
            [sessionId, fallback]
          );
          await db.query(`UPDATE chat_sessions SET last_active_at = NOW() WHERE id = $1`, [sessionId]);
          return res.json({ success: true, reply: fallback, tier: 2, suggest_escalation: true });
        }
        const suggestEscalation = needsEscalation(message, rawReply);
        const reply = normalizeEscalationReply(rawReply, suggestEscalation, { appointmentIntent });
        let autoCaseId = "";

        if (suggestEscalation) {
          const ticketType = detectTicketType(message);
          // One open ticket per (session, type): if the student already has
          // an appointment / human-support / claim / general ticket open,
          // reuse it instead of creating another.
          const existingCaseId = await findOpenTicketByType(sessionId, ticketType);
          if (existingCaseId) {
            autoCaseId = existingCaseId;
          } else {
            const openCount = await countOpenTicketsForSession(sessionId);
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

        await db.query(
          `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
          [sessionId, reply]
        );
        await db.query(`UPDATE chat_sessions SET last_active_at = NOW() WHERE id = $1`, [sessionId]);

        return res.json({
          success: true,
          reply,
          tier: 2,
          suggest_escalation: suggestEscalation,
          auto_escalated: !!autoCaseId,
          case_id: autoCaseId || null,
        });
      } catch (error) {
        return genericError(res, "chat", error);
      }
    }
  );

  // ── TIER 3: Create escalation ticket ────────────────────────
  app.post(`${apiPrefix}/chat/escalate`, async (req, res) => {
    const sessionId = String((req.body && req.body.session_id) || "").trim();
    const concern = String((req.body && req.body.concern) || "").trim();

    if (!sessionId || !concern) {
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
          message: "Secure chat session expired after 5 minutes. Please verify your email again.",
        });
      }
      const { email, student_name } = loaded.session;

      const ticketType = detectTicketType(concern);
      const existingCaseId = await findOpenTicketByType(sessionId, ticketType);

      let caseId;
      let reused = false;
      if (existingCaseId) {
        caseId = existingCaseId;
        reused = true;
      } else {
        const openCount = await countOpenTicketsForSession(sessionId);
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
          `OSA staff will respond in this same chat. No new ticket was created.`
        : `Your concern has been escalated to an OSA staff member.\n\n` +
          `📋 Case ID: **${caseId}** (type: ${ticketType.replace("_", " ")})\n\n` +
          `A staff member will respond in this same chat. You will also be notified via email once resolved.`;

      await db.query(
        `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
        [sessionId, botMsg]
      );

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
      return res.json({
        success: true,
        ticket: {
          case_id: ticket.case_id,
          status: ticket.status,
          ticket_type: ticket.ticket_type,
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
            message: "Secure chat session expired after 5 minutes. Please verify your email again.",
          });
        }
        const { email, student_name } = loaded.session;

        const existing = await findOpenClaimTicket(sessionId, itemNumber);
        let caseId = existing;
        const concern =
          `Lost & Found claim — Item ${itemNumber}${itemTitle ? ` (${itemTitle})` : ""}. ` +
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
            message: "Secure chat session expired after 5 minutes. Please verify your email again.",
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
      const ticketResult = await db.query(
        `UPDATE escalation_tickets
         SET appointment_datetime = $1,
             appointment_location = $2,
             appointment_notes = coalesce($3, appointment_notes),
             appointment_status = 'scheduled',
             status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
             updated_at = NOW()
         WHERE case_id = $4 AND status IN ('open','in_progress')
         RETURNING session_id`,
        [when.toISOString(), location, notes || null, caseId]
      );

      if (!ticketResult.rows.length) {
        return res.status(404).json({ success: false, message: "Ticket not found or already resolved." });
      }

      const session_id = ticketResult.rows[0].session_id;
      const dtLabel = when.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });

      const msgContent =
        `[OSA Staff · ${staffName}]\n\n` +
        `Your OSA visit is scheduled:\n\n` +
        `When: ${dtLabel}\n` +
        `Where: ${location}\n` +
        (notes ? `\nNotes: ${notes}\n` : "") +
        `\nPlease arrive on time and bring your school ID and Case ID **${caseId}**.`;

      await db.query(
        `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
        [session_id, msgContent]
      );
      await db.query(`UPDATE chat_sessions SET last_active_at = NOW() WHERE id = $1`, [session_id]);

      const delivered = pushToSession(session_id, {
        type: "staff_message",
        content: msgContent,
        staff_name: staffName,
        case_id: caseId,
        timestamp: new Date().toISOString(),
      });

      return res.json({ success: true, delivered });
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
      const msg =
        `[OSA Staff · ${staffName}]\n\n` +
        `✅ Appointment Approved\n\n` +
        `Case ID: ${caseId}\n` +
        `Ticket type: ${String(row.ticket_type || "general").replace("_", " ")}\n` +
        (note ? `\nNote: ${note}\n` : "\n") +
        `\nAn OSA staff member will provide your final schedule details in this chat.`;

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

    if (!caseId || !staffReply) {
      return res.status(400).json({ success: false, message: "case_id and staff_reply are required." });
    }

    try {
      const ticketResult = await db.query(
        `UPDATE escalation_tickets
         SET status = 'resolved', staff_reply = $1, promote_to_faq = $2,
             faq_question = $3, faq_answer = $4, faq_category = $5, updated_at = NOW()
         WHERE case_id = $6
         RETURNING session_id, student_email, student_name`,
        [staffReply, promoteToFaq, faqQuestion || null, faqAnswer || null, faqCategory, caseId]
      );

      if (!ticketResult.rows.length) {
        return res.status(404).json({ success: false, message: "Ticket not found." });
      }

      const { session_id, student_name } = ticketResult.rows[0];
      const firstName = student_name.split(" ")[0];

      // Add staff reply to chat history
      const staffMsg =
        `[OSA Staff Reply — Case ${caseId}]\n\n` +
        `Hi ${firstName}, here is the response to your concern:\n\n${staffReply}`;

      await db.query(
        `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
        [session_id, staffMsg]
      );

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

      return res.json({
        success: true,
        message: "Ticket resolved." + (promoteToFaq ? " Answer added to FAQ." : ""),
        promoted_to_faq: promoteToFaq,
      });
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
      return res.json({ success: true, ticket: result.rows[0] });
    } catch (error) {
      return genericError(res, "chat", error);
    }
  });

  // Admin: List tickets (supports active statuses + approved appointments queue)
  app.get(`${apiPrefix}/chat/tickets`, requireAdminKey, async (req, res) => {
    const status = String((req.query && req.query.status) || "open").trim().toLowerCase();
    const searchQ = String((req.query && req.query.q) || "").trim().toLowerCase();

    const allowed = { open: 1, in_progress: 1, resolved: 1, approved: 1 };
    const normalizedStatus = allowed[status] ? status : "open";

    const where = [];
    const vals = [];
    let p = 1;

    if (normalizedStatus === "approved") {
      where.push(`t.appointment_status = 'approved'`);
    } else {
      where.push(`t.status = $${p++}`);
      vals.push(normalizedStatus);
    }

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
                t.appointment_approved_at, t.appointment_approved_by
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
           CASE WHEN t.appointment_status = 'approved' THEN t.appointment_approved_at END DESC NULLS LAST,
           t.created_at ASC`,
        vals
      );
      const tickets = result.rows.map((t) => ({
        ...t,
        is_student_active: !!(sseClients.get(t.session_id) && sseClients.get(t.session_id).size > 0),
        needs_end_session_prompt: (() => {
          if (t.status !== "in_progress" || !t.last_staff_at) return false;
          const lastMs = new Date(t.last_staff_at).getTime();
          if (!Number.isFinite(lastMs)) return false;
          return Date.now() - lastMs >= STAFF_CHAT_IDLE_MS;
        })(),
      }));
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

      return res.json({ success: true, delivered, first_staff_reply: firstStaffReply });
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
    try {
      const loaded = await loadSessionRow(sessionId);
      if (!loaded.found) {
        return res.status(404).json({ success: false, message: "Session not found." });
      }
      if (loaded.expired) {
        return res.status(401).json({
          success: false,
          code: "SESSION_EXPIRED",
          message: "Secure chat session expired after 5 minutes. Please verify your email again.",
        });
      }
      const msgs = await db.query(
        `SELECT role, content, created_at FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC`,
        [sessionId]
      );
      return res.json({ success: true, session: loaded.session, messages: msgs.rows });
    } catch (error) {
      return genericError(res, "chat", error);
    }
  });
}

module.exports = { registerChatRoutes };
