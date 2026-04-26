const { preprocessUserInput, looksLikeOtpHelpIntent } = require("../utils/preprocessor");
const { cleanModelText, ensureUserFacingFallback, NO_RELIABLE_KB_REPLY } = require("../utils/responseCleaner");
const { buildPortalPageContext, looksLikePortalPageIntent } = require("../utils/portalPageContext");
const { searchFaq } = require("../../faqSearch");
const { buildCacheKey } = require("../utils/hash");
const { getCachedResponse, saveCachedResponse } = require("../cache/postgresCache");
const { appendMemory, getRecentMemory } = require("../memory/postgresMemory");
const { buildProviderChain } = require("../router/smartRouter");
const { executeProvider } = require("./providers");
const { searchRag } = require("./ragService");
const db = require("../../db");
const POLICY_VERSION = "v17-portal-page-aware-live-context";
const CHATBOT_DEBUG = String(process.env.CHATBOT_DEBUG || "false").trim().toLowerCase() === "true";
/**
 * FAQ tier for the guest widget — OFF by default so AI (RAG + LLM) is always
 * the primary responder. FAQ is only the last resort when ALL Gemini keys are
 * dead or RAG returns zero chunks with no live context.
 */
const CHAT_TIER1_FAQ_ENABLED =
  String(process.env.CHAT_TIER1_FAQ_ENABLED || "false").trim().toLowerCase() === "true";
/** Minimum RAG confidence before guest LLM may use retrieved chunks; below → escalation message. */
const CHATBOT_RAG_MIN_CONFIDENCE = Math.max(
  0,
  Math.min(1, Number(process.env.CHATBOT_RAG_MIN_CONFIDENCE ?? process.env.CHAT_RAG_MIN_CONFIDENCE ?? 0.52))
);
const _recentAssistantRepliesByConversation = new Map();

function getRecentAssistantReplyMemory(conversationId) {
  const key = String(conversationId || "").trim();
  if (!key) return [];
  return Array.isArray(_recentAssistantRepliesByConversation.get(key))
    ? _recentAssistantRepliesByConversation.get(key)
    : [];
}

function rememberAssistantReply(conversationId, replyText) {
  const key = String(conversationId || "").trim();
  const text = String(replyText || "").trim();
  if (!key || !text) return;
  const current = getRecentAssistantReplyMemory(key);
  const next = [...current, text].slice(-3);
  _recentAssistantRepliesByConversation.set(key, next);
}

function logError(scope, error) {
  try {
    // eslint-disable-next-line no-console
    console.error(`[chatbot:${scope}]`, error?.stack || error?.message || error);
  } catch (_) {}
}

/**
 * Pulls live portal data (announcements, L&F, services) so the guest widget
 * can answer "what are the latest announcements?" or "is LF-1025 available?"
 * without being a verified student.
 */
async function getPublicLiveContext() {
  try {
    const [contentR, annR, lfR, svcR] = await Promise.all([
      db.query(
        `SELECT page_name, content_key, content_value
         FROM portal_content
         WHERE page_name IN ('home', 'about')
         ORDER BY page_name ASC, content_key ASC`
      ),
      db.query(
        `SELECT title, category, urgency, details, date_label
         FROM announcements
         WHERE is_active = true
         ORDER BY created_at DESC
         LIMIT 5`
      ),
      db.query(
        `SELECT item_number, title, tag, status, date_label
         FROM lost_found_items
         WHERE is_active = true
         ORDER BY created_at DESC
         LIMIT 20`
      ),
      db.query(
        `SELECT name, description, requirements, fees, processing_time, office_location
         FROM osa_services
         WHERE is_active = true
         ORDER BY name ASC
         LIMIT 15`
      ),
    ]);

    let ctx = "";
    const pageCtx = buildPortalPageContext(contentR.rows);

    if (pageCtx) {
      ctx += pageCtx;
    }

    if (annR.rows.length) {
      ctx += "\n\nCURRENT OSA ANNOUNCEMENTS (live):\n";
      annR.rows.forEach((a) => {
        const urgency = a.urgency ? ` [${a.urgency}]` : "";
        const date = a.date_label ? ` (${a.date_label})` : "";
        ctx += `- [${a.category || "General"}]${urgency}${date} ${a.title}: ${a.details || "No details."}\n`;
      });
    }

    if (lfR.rows.length) {
      ctx += "\n\nLOST & FOUND REGISTRY (live):\n";
      lfR.rows.forEach((i) => {
        ctx += `- ${i.item_number}: ${i.title} (${i.tag || "Other"}) — STATUS: ${i.status || "Unclaimed"}${i.date_label ? `, posted ${i.date_label}` : ""}\n`;
      });
    }

    if (svcR.rows.length) {
      ctx += "\n\nOSA SERVICES CATALOG (live):\n";
      svcR.rows.forEach((s) => {
        const reqs = Array.isArray(s.requirements) && s.requirements.length
          ? ` | Requirements: ${s.requirements.join(", ")}` : "";
        const fees = s.fees ? ` | Fee: ${s.fees}` : "";
        const time = s.processing_time ? ` | Processing: ${s.processing_time}` : "";
        const loc = s.office_location ? ` | Office: ${s.office_location}` : "";
        ctx += `- ${s.name}: ${s.description}${reqs}${fees}${time}${loc}\n`;
      });
    }

    if (ctx) {
      ctx = "\n\nCURRENT PORTAL DATA (authoritative live data from the OSA database):" + ctx;
    }
    // Always append the official downloadable references / forms list so the
    // LLM can cite their URLs verbatim instead of refusing.
    ctx += buildOfficialFormsContextBlock();
    return ctx;
  } catch (_err) {
    return buildOfficialFormsContextBlock();
  }
}

/** Build the base identity + strict rules block shared by all guest prompt variants. */
function makeSystemPrompt(meta) {
  return (
    `You are the OSA Assistant of Emilio Aguinaldo College (EAC) Cavite for the OSA Transaction Guide Portal.\n\n` +
    `LANGUAGE AND STYLE:\n` +
    `- Write in clear, natural English.\n` +
    `- Keep the reply concise, helpful, and easy to follow.\n` +
    `- Use bullets or numbered steps only when they improve clarity.\n` +
    `- Match the student's phrasing level while staying respectful and professional.\n` +
    `- LINK FORMATTING: When you cite an official URL, ALWAYS wrap it in markdown link form using a short friendly label, e.g. \`[Scholarship Application Form](https://...)\` — never paste a long bare URL inline next to prose. Place each downloadable form link on its own line/paragraph (with a blank line above and below) so it never runs into the surrounding sentence.\n\n` +
    `OFFICIAL INFORMATION RULES:\n` +
    `- For EAC-specific policies, procedures, fees, schedules, requirements, office services, contact details, announcements, forms, and institutional facts, answer only from the CONTEXT EXCERPTS and CURRENT PORTAL DATA blocks below.\n` +
    `- For questions about what is shown on the portal dashboard, home page, about page, guide cards, manual/forms block, or module pages, prioritize CURRENT PORTAL DATA over generic summary chunks.\n` +
    `- Never invent EAC facts, deadlines, fees, office processes, or policy details.\n` +
    `- Never paste localhost URLs, raw internal URLs, or unsafe external links in replies.\n` +
    `- You MAY cite the URLs listed in the "OFFICIAL OSA DOWNLOADABLE REFERENCES & FORMS" block verbatim — these are the safe, official portal links for the Student Manual and OSA forms, so include the matching URL when a student asks for the manual, a form, or its link.\n` +
    `- Do not mention retrieval, chunks, providers, or internal tooling in user-facing text.\n` +
    `- Speak as if you simply know this information — never say "based on my knowledge", "according to my data", "based on the information provided", "from what I know", "ayon sa aming data", or any phrase that reveals internal processes.\n\n` +
    `WHEN GENERAL AI HELP IS ALLOWED:\n` +
    `- If the student's prompt is a harmless conversational or simple common-sense question that does not require official EAC information, you may answer briefly in your own words.\n` +
    `- Never present a general AI reply as an official school policy, school record, or confirmed institutional fact.\n` +
    `- If the user asks for current events, live outside facts, or anything requiring verified up-to-date information beyond the portal, do not guess.\n\n` +
    `GROUNDING AND RELEVANCE:\n` +
    `- Use only the excerpts that actually match the student's question.\n` +
    `- If several excerpts clearly belong to the same topic, you may combine them into one natural answer.\n` +
    `- If the excerpts answer only part of the question, provide the supported part first, then briefly say what specific detail is not stated.\n` +
    `- If the student asks what a policy says about a specific case (for example "manual about lost ID"), give the actual supported policy details first (steps/requirements/process). Use links only as supporting references, not as the whole answer.\n` +
    `- If no relevant official information is available for an EAC-specific question, say you don't have that specific detail and direct the student to contact OSA.\n\n` +
    `KNOWLEDGE FRESHNESS:\n` +
    `- EAC Cavite policies as documented may change each academic year.\n` +
    `- If the student asks specifically about "current", "latest", "updated", or a specific academic year, provide the supported answer and add: "Please verify with OSA that this is still current, as policies may be updated each academic year."\n` +
    `Detected intent: ${meta.intent}. Complexity: ${meta.complexity}.`
  );
}

function makeGeneralFallbackPrompt(meta) {
  return (
    `You are the OSA Assistant of Emilio Aguinaldo College (EAC) Cavite.\n\n` +
    `This mode is only for harmless non-official prompts such as simple conversational questions, assistant-identity questions, and basic common-sense queries.\n\n` +
    `RULES:\n` +
    `- Reply briefly in natural English.\n` +
    `- Do not invent any EAC-specific policy, fee, deadline, schedule, requirement, office record, or institutional fact.\n` +
    `- If the user shifts into an official school matter, say you can answer it only when it is supported by the OSA portal or Student Manual.\n` +
    `- Do not mention internal tools or providers.\n` +
    `- Do not refuse unless the request is unsafe or clearly needs official school data.\n\n` +
    `Detected intent: ${meta.intent}. Complexity: ${meta.complexity}.`
  );
}

function makeNoKbGuidancePrompt(meta) {
  return (
    `You are the OSA Assistant of Emilio Aguinaldo College (EAC) Cavite.\n\n` +
    `The student asked something where no official EAC records are available right now. ` +
    `Your job is to give a brief, genuinely helpful general response — practical tips or general guidance ` +
    `about the topic — without inventing any specific EAC policy, fee, deadline, or institutional data.\n\n` +
    `RULES:\n` +
    `- Give 2–4 short, practical general tips related to what the student is asking about.\n` +
    `- Never invent specific EAC figures, dates, names, or requirements.\n` +
    `- End every response by directing the student to contact OSA directly for official confirmation. ` +
    `Suggest they visit the OSA office or use the secure chat by verifying their campus email.\n` +
    `- Keep the tone helpful and warm, not dismissive.\n` +
    `- Reply in the same language/mix the student used (Filipino, English, or Taglish).\n` +
    `- Do not mention internal tools, providers, or that you are using a fallback mode.\n\n` +
    `Detected intent: ${meta.intent}. Complexity: ${meta.complexity}.`
  );
}

/**
 * Full guest system prompt — includes KB excerpts and live portal data.
 * This is what gets sent to the LLM for every guest widget message.
 */
function makeGuestSystemPromptWithRag(meta, rag, liveCtx) {
  const chunkCount = rag && Array.isArray(rag.chunks) ? rag.chunks.length : 0;
  const ragText = rag && String(rag.context || "").trim();
  const confidence = rag ? Number(rag.confidence) || 0 : 0;
  const hasLiveCtx = Boolean(liveCtx && String(liveCtx).trim().length > 20);

  const base = makeSystemPrompt(meta);

  const ragBlock = chunkCount > 0 && ragText
    ? (
        `\n\nCONTEXT EXCERPTS (official EAC Student Manual / portal knowledge base — use ONLY these for policy and procedural answers):\n` +
        ragText + `\n`
      )
    : `\n\nCONTEXT EXCERPTS: No manual or policy chunks matched this query.\n`;

  const liveBlock = hasLiveCtx
    ? `\n${String(liveCtx).trim()}\n`
    : "";

  let groundingRules = "";

  if (chunkCount > 0 && ragText) {
    const lowConf = confidence > 0 && confidence < 0.60;
    groundingRules =
      `\n\nGROUNDING INSTRUCTIONS:\n` +
      `- The CONTEXT EXCERPTS block above is non-empty. Answer from it in natural assistant phrasing.\n` +
      (hasLiveCtx ? `- When the question is about the portal dashboard, home page, about page, guide sections, or manual/forms blocks, prefer the CURRENT PORTAL DATA block for the exact public-facing wording.\n` : "") +
      `- Do not say you lack access or tell the student to visit the college website.\n` +
      `- If multiple excerpts clearly address the same topic, combine them into one coherent answer.\n` +
      `- For broad handbook questions, give the best supported summary first, then list the key supported details.\n` +
      `- Do not add facts that are not present in the excerpts.\n` +
      (lowConf
        ? `- Match confidence is moderate (${confidence.toFixed(2)}). If the excerpts only partially answer the question, answer the supported part and briefly state what is not clearly stated.\n`
        : "") +
      `- If the excerpts do not address the question at all, say you don't have that specific detail and suggest contacting OSA directly.\n`;
  } else if (hasLiveCtx) {
    groundingRules =
      `\n\nGROUNDING INSTRUCTIONS:\n` +
      `- No manual/policy chunks matched this query. You MAY answer ONLY from CURRENT PORTAL DATA above (announcements, Lost & Found items, services catalog).\n` +
      `- Do NOT invent any policy, requirement, fee, deadline, or office procedure not present in CURRENT PORTAL DATA.\n` +
      `- If the prompt is just harmless small talk or a simple non-official question, you may answer briefly without presenting it as official school information.\n` +
      `- For any official policy or handbook question not answered by CURRENT PORTAL DATA, say you don't have that detail and suggest contacting OSA.\n`;
  } else {
    groundingRules =
      `\n\nGROUNDING INSTRUCTIONS:\n` +
      `- No official knowledge sources matched this query.\n` +
      `- For harmless conversational or simple common-sense prompts, you may answer briefly in natural language.\n` +
      `- Do NOT invent any EAC rules, fees, deadlines, dress codes, forms, or office processes.\n` +
      `- For any official school-specific question not supported here, say you don't have that specific detail and suggest contacting OSA.\n`;
  }

  if (CHATBOT_DEBUG) {
    // eslint-disable-next-line no-console
    console.log(
      `[chatbot:prompt] chunks=${chunkCount} conf=${confidence.toFixed(3)} hasLiveCtx=${hasLiveCtx} ` +
      `intent=${meta.intent}`
    );
  }

  return base + ragBlock + liveBlock + groundingRules;
}


function providerFailureHint(err) {
  const msg = String(err?.message || err?.error?.message || err || "");
  if (/429|RESOURCE_EXHAUSTED|quota exceeded/i.test(msg)) return "429-quota";
  if (/503|502|timeout/i.test(msg)) return "upstream";
  if (/401|403|invalid api key/i.test(msg)) return "auth";
  return "error";
}

/**
 * Returns either a string (legacy: appointment quick-reply, no escalate flag)
 * or an object `{ text, escalate }` for triggers that should also surface the
 * "Verify email & escalate" button in the widget.
 *
 * The `memory` argument (recent conversation, oldest→newest) lets us catch
 * short follow-ups like "how?", "yes", or "the live staff" by inspecting the
 * previous assistant turn.
 */
function buildDomainQuickReply(cleanedText, memory) {
  const text = String(cleanedText || "").toLowerCase().trim();

  // ── 1. Direct request to talk to a real OSA staff member ───────────
  // Triggers when the student asks for live staff, a real person, a human
  // agent, or wants to "ask/talk/speak to" staff in English, Filipino, or
  // Taglish. Returns clear how-to steps AND escalate=true so the widget
  // renders the OTP verification button — no more robotic "I recommend
  // escalating" with zero next steps.
  const liveStaffPattern =
    /\b(live|real|actual|human)\s+(staff|agent|person|representative|admin|adviser)\b/i.test(text) ||
    /\b(talk|speak|chat|message|kausap(in)?|makausap|magtanong|tanong(in)?|ask)\s+(?:po\s+)?(?:to\s+|sa\s+|with\s+|kay\s+|kayo\s+|the\s+)?(live\s+|real\s+|actual\s+|human\s+|osa\s+)?(staff|agent|person|adviser|admin|representative|tao)\b/i.test(text) ||
    /\b(i\s+)?(want|wanna|need|gusto(\s+ko)?|kailangan(\s+ko)?)\s+(to\s+)?(talk|speak|chat|message|ask|kausapin|makausap|magtanong)\s+(?:to\s+|sa\s+|with\s+|kay\s+)?(?:the\s+|a\s+|an\s+)?(live\s+|real\s+|actual\s+|human\s+|osa\s+)?(staff|agent|person|adviser|admin|representative|tao)\b/i.test(text) ||
    /\b(connect|transfer|forward|endorse|i-?endorse|ipasa)\s+(me\s+)?(to\s+|sa\s+)?(a\s+|the\s+|an\s+)?(live\s+|real\s+|human\s+|osa\s+)?(staff|agent|person|adviser|admin|representative|tao)\b/i.test(text) ||
    /\b(may\s+(katao|tao|staff|admin|adviser)\s+ba|may\s+nakaduty\s+ba|sino\s+(?:ang\s+)?(staff|nakaduty|on\s+duty|naka-?duty))\b/i.test(text);

  if (liveStaffPattern) {
    return {
      text: [
        "Of course — you can reach a live OSA staff member through the portal's **secure (OTP-verified) chat**. Here's how:",
        "",
        "1. Tap **Verify email & escalate** below.",
        "2. Enter your **EAC campus email** to receive a one-time code (OTP).",
        "3. Type the code to open the secure chat thread.",
        "4. State your concern — an OSA staff member will join and reply in that same thread.",
        "",
        "I'll stay here in the meantime if you'd like to ask anything else.",
      ].join("\n"),
      escalate: true,
    };
  }

  // ── 2. "How?" / "paano?" follow-up after we already mentioned escalation ──
  // The model often replies "I recommend escalating to OSA staff" without
  // explaining HOW. When the student then asks "how?", the model loses
  // context and asks for clarification. We catch that pattern here.
  const isHowFollowUp =
    /^(how|how\?|how\s+do\s+i|how\s+to|paano|paano\?|pano|pano\?|paano\s+po|panu)$/i.test(text);
  if (isHowFollowUp && Array.isArray(memory) && memory.length > 0) {
    // Look at the most recent assistant turn for an escalation hint.
    const lastAssistant = [...memory].reverse().find((m) => m && m.role === "assistant");
    const prevText = String(lastAssistant?.content || "").toLowerCase();
    const mentionedEscalation =
      /\bescalat/i.test(prevText) ||
      /\bosa\s+(staff|office|adviser|admin)/i.test(prevText) ||
      /\b(speak|talk|reach\s+out)\s+to\s+(?:an?\s+)?osa\b/i.test(prevText) ||
      /\bcontact\s+osa\b/i.test(prevText);
    if (mentionedEscalation) {
      return {
        text: [
          "Here's how to escalate to a live OSA staff member:",
          "",
          "1. Tap **Verify email & escalate** below.",
          "2. Enter your **EAC campus email** — you'll get a one-time code (OTP).",
          "3. Type that code to open the secure chat thread.",
          "4. State your concern there — an OSA staff member will reply in the same thread.",
        ].join("\n"),
        escalate: true,
      };
    }
  }

  // ── 3. Appointment booking quick-reply (legacy, no escalate flag) ──
  if (/\b(appointment|book\s+(an?\s+)?(appointment|visit|meeting)|schedule\s+(an?\s+)?(appointment|visit|meeting)|meet\s+with\s+osa|face\s+to\s+face)\b/i.test(text)) {
    return [
      "To request an OSA appointment with staff, open the portal's **verified-student (OTP) chat** from the main navigation.",
      "- Sign in with your campus email and the one-time code.",
      "- State your concern and preferred weekday plus Morning or Afternoon.",
      "OSA staff will confirm the schedule in that same thread.",
    ].join("\n");
  }
  return "";
}

function withAnswerFields(obj) {
  const text = String(obj.response || "").trim();
  return {
    ...obj,
    response: text,
    answer: text,
    escalate: obj.escalate === true,
  };
}

function looksLikeDateTimeQuery(message) {
  const m = String(message || "")
    .toLowerCase()
    .replace(/['`’]/g, "")
    .replace(/[?!.,;:¿¡()\[\]{}"~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!m) return false;
  if (m.length > 80) return false;
  if (/\b(office|business|operating|open)\s+hours\b/.test(m)) return false;
  if (/\bwhat\s+(are\s+)?(the\s+)?hours\b/.test(m)) return false;
  if (/^(time|date|day|year|month|today|oras|petsa|araw|buwan|taon|ngayon)$/.test(m)) return true;
  if (/^(full|todays?|current)\s+(date|day|time|month|year)$/.test(m)) return true;
  if (/^(date|day|time)\s+(now|today)$/.test(m)) return true;
  if (/^(petsa|oras|araw|buwan|taon)\s+(ngayon|today)$/.test(m)) return true;
  return (
    /\bwhat(?:s|\s+is)\s+(?:the\s+)?(date|day|time|month|year|today)\b/.test(m) ||
    /\bwhat\s+(time|day|date|year|month)\s+is\s+it\b/.test(m) ||
    /\bwhat\s+day\s+(of\s+the\s+week\s+)?(is\s+it|today)\b/.test(m) ||
    /\b(current|todays?|full)\s+(date|day|time|month|year)\b/.test(m) ||
    /\b(date|day|time)\s+(today|now|right\s+now)\b/.test(m) ||
    /\b(today|now)\s+(date|day|time)\b/.test(m) ||
    /\bano(?:ng)?\s+(araw|petsa|oras|buwan|taon)\b/.test(m) ||
    /\banong\s+oras\s+na\b/.test(m) ||
    /\b(petsa|oras|araw)\s+ngayon\b/.test(m) ||
    /\bngayon\s+(petsa|oras|araw)\b/.test(m)
  );
}

function formatPhDateTime(now) {
  const d = now instanceof Date ? now : new Date();
  const tz = "Asia/Manila";
  const dateStr = new Intl.DateTimeFormat("en-PH", {
    timeZone: tz,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
  const timeStr = new Intl.DateTimeFormat("en-PH", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return { dateStr, timeStr, combined: `${dateStr}, ${timeStr} (PHT)` };
}

/**
 * Authoritative list of OSA downloadable forms / references shown on the
 * portal home page ("Student Manual and Forms" section). Keeping the list
 * here lets the chat pipeline answer link/form questions deterministically
 * — the LLM is no longer asked to guess (and refuse) URLs.
 *
 * Keep this list in sync with public/preview.html and public/index.html
 * (the manual-highlight + manual-forms-grid blocks).
 */
const OFFICIAL_FORMS = [
  {
    key: "manual",
    name: "EAC-C Student Manual",
    description: "Primary handbook for student rights, responsibilities, and academic norms.",
    url: "https://drive.google.com/file/d/1Sk4s2GnO7SGkEaDnmXNBqjZP1a10Y9qR/view?usp=sharing",
    matchers: [/\b(student\s+)?manual\b/, /\bhandbook\b/, /\bstudent[-\s]+handbook\b/],
  },
  {
    key: "scholarship",
    name: "Scholarship Application Form",
    description: "Application form for OSA-handled scholarships.",
    url: "https://www.eac.edu.ph/wp-content/uploads/2021/08/QF-OSA-010-07.15.2021-Rev.01-Scholarship-Application-OSA-FORMS-2021-2.doc",
    matchers: [/\bscholarship\b.*\b(form|application|app|apply|link|download|file)\b/, /\b(form|application|apply)\b.*\bscholarship\b/, /\bscholarship\s+form\b/, /\bscholarship\s+application\b/],
  },
  {
    key: "incident",
    name: "Incident Report Form",
    description: "Use for conduct-related filing.",
    url: "https://www.eac.edu.ph/wp-content/uploads/2021/08/QF-OSA-012-07.15.2021-Rev.01-Incident-Report.doc",
    matchers: [/\bincident\s+report\b/, /\bincident\s+form\b/, /\breport\s+form\b/],
  },
  {
    key: "academic_leave",
    name: "Academic Leave of Absence Form",
    description: "Leave of absence application.",
    url: "https://www.eac.edu.ph/wp-content/uploads/2021/08/QF-OSA-013-07.15.2021-Rev.0Academic-Leave-of-Absence-Application-Form.doc",
    matchers: [/\bacademic\s+leave\b/, /\bleave\s+of\s+absence\b/, /\b(loa|aloa)\b/, /\bleave\s+form\b/],
  },
];

function looksLikeFormsLinkQuery(message) {
  const raw = String(message || "")
    .toLowerCase()
    .replace(/['`’]/g, "")
    .replace(/[?!.,;:¿¡()\[\]{}"~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return null;
  if (raw.length > 220) return null;

  const asksManualPolicyDetails =
    /\b(student\s+)?manual\b/.test(raw) &&
    (
      /\b(ano\s+sabi|what\s+does|what\s+says?|according\s+to|elaborate|explain|full\s+details?|detail|policy|policies|rule|rules|section|about|regarding|tungkol)\b/.test(raw) ||
      /\b(lost\s+(my\s+)?(school\s+)?id|school\s+id|student\s+id|good\s+moral|incident|organization|event|clearance|discipline|uniform|attendance|grading)\b/.test(raw)
    ) &&
    !/\b(link|url|download|file|pdf|doc|docx|send|share|copy|kopya)\b/.test(raw);
  if (asksManualPolicyDetails) return null;

  // Words that signal "give me the file/URL/where can I get it".
  const wantsArtifact =
    /\b(link|links|url|urls|pdf|doc|docx|file|files|download|downloads|downloadable|downloadables|copy|share|send|kopya|share\s+mo)\b/.test(raw) ||
    /\b(give|show|provide|send|share|list|kunin|saan|where|paano\s+(makuha|ma-?download))\b/.test(raw);

  if (!wantsArtifact) return null;

  // Catch-all "all forms / list of forms / list ng forms" ask.
  if (
    /\b(all|list|complete|every|lahat)\b.*\b(forms?|manuals?|references?)\b/.test(raw) ||
    /\b(forms?|manuals?|references?)\b.*\b(all|list|complete|every|lahat)\b/.test(raw) ||
    /\b(forms?\s+(and|at)\s+manuals?|manuals?\s+(and|at)\s+forms?)\b/.test(raw) ||
    /\b(downloadable|downloadables)\b/.test(raw)
  ) {
    return { type: "all", forms: OFFICIAL_FORMS };
  }

  const matched = OFFICIAL_FORMS.filter((f) => f.matchers.some((rx) => rx.test(raw)));
  if (!matched.length) return null;
  return { type: matched.length === 1 ? "single" : "multi", forms: matched };
}

function buildFormsLinkReply(match) {
  if (!match || !Array.isArray(match.forms) || !match.forms.length) return "";
  if (match.type === "single") {
    const f = match.forms[0];
    return `Here is the official link for the **${f.name}**:\n\n[${f.name}](${f.url})\n\n${f.description} You can also open it any time from the portal's "Student Manual and Forms" section on the home page.`;
  }
  const lines = match.forms.map((f) => `- [${f.name}](${f.url})`);
  const heading =
    match.type === "all"
      ? "Here are the official OSA downloadable references and forms from the portal:"
      : "Here are the official OSA links you asked about:";
  return `${heading}\n\n${lines.join("\n")}\n\nYou can also open these any time from the "Student Manual and Forms" section on the portal home page.`;
}

function buildOfficialFormsContextBlock() {
  const lines = OFFICIAL_FORMS.map(
    (f) => `- ${f.name}: ${f.description} Markdown link to use verbatim: [${f.name}](${f.url})`
  );
  return (
    "\n\nOFFICIAL OSA DOWNLOADABLE REFERENCES & FORMS (safe public URLs — when a student asks for one of these, cite it using the exact markdown link form shown below; never paste the bare URL inline):\n" +
    lines.join("\n") +
    "\n"
  );
}

/**
 * Defense-in-depth post-processor.
 *
 * Even with explicit prompt instructions, smaller free-tier models sometimes
 * still emit bare URLs glued to the next sentence, like:
 *   "...download it here: https://very/long/.doc For complete steps..."
 * which the chat widget renders with no breathing room and a giant link
 * label. This pass:
 *   1. Replaces every known OFFICIAL_FORMS URL with `[Friendly Label](url)`.
 *   2. Promotes every markdown link OR bare URL to its own paragraph (blank
 *      line above + below), so it never collides with surrounding prose.
 */
function tidyOfficialLinks(text) {
  if (!text) return text;
  let out = String(text);

  // 1. Replace bare OFFICIAL_FORMS URLs with markdown labels.
  for (const f of OFFICIAL_FORMS) {
    if (!f.url) continue;
    const escapedUrl = f.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Skip if the URL is already inside a markdown link `](url)` — we do this
    // by replacing only occurrences NOT preceded by `](`.
    const bareRx = new RegExp(`(?<!\\]\\()${escapedUrl}`, "g");
    out = out.replace(bareRx, `[${f.name}](${f.url})`);
  }

  // 2. Promote any markdown link `[label](http...)` to its own paragraph.
  //    Inserts blank line BEFORE if preceded by non-blank text on the same
  //    line, and AFTER if followed by non-blank text on the same line.
  out = out.replace(/([^\n])\s*(\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g, "$1\n\n$2");
  out = out.replace(/(\[[^\]]+\]\(https?:\/\/[^)\s]+\))\s*([^\n])/g, "$1\n\n$2");

  // 3. Same treatment for any remaining bare URLs (defense in depth).
  out = out.replace(/([^\s\n(])(https?:\/\/[^\s)]+)/g, "$1 $2");
  out = out.replace(/(https?:\/\/[^\s)]+)([^\s\n).,;!?])/g, "$1 $2");

  // 4. Collapse runaway 3+ newlines to a max of 2 (one blank line).
  out = out.replace(/\n{3,}/g, "\n\n");

  return out.trim();
}

function buildDateTimeReply(rawMessage) {
  const { dateStr, timeStr, combined } = formatPhDateTime();
  const m = String(rawMessage || "").toLowerCase();
  const wantsTimeOnly = /\b(time|oras)\b/.test(m) && !/\b(date|day|petsa|araw)\b/.test(m);
  const wantsDateOnly =
    /\b(date|day|petsa|araw|month|year|buwan|taon)\b/.test(m) && !/\b(time|oras)\b/.test(m);
  if (wantsTimeOnly) return `It's ${timeStr} (Philippine Time) right now.`;
  if (wantsDateOnly) return `Today is ${dateStr} (Philippine Time).`;
  return `Right now in the Philippines it's ${combined}.`;
}

function hasSubstantialLiveCtx(liveCtx) {
  return Boolean(liveCtx && String(liveCtx).trim().length > 40);
}

function otpHelperReply() {
  return "To get a new OTP code, use the Verify email section in this same chat: enter your official campus email, tap Send OTP Code, then enter the 6-digit code. If you need to change your name on file, enter the correct full name in that card before verifying. You can scroll up to the verification card or open it again from the chat actions.";
}

function looksLikeIdentityQuery(message) {
  const m = String(message || "").toLowerCase();
  return (
    m.includes("who am i") ||
    m.includes("who is me") ||
    m.includes("what is my name") ||
    m.includes("what's my name") ||
    m.includes("sino ako") ||
    m.includes("kilala mo ba ko")
  );
}

function looksLikeOutOfScopeMath(message) {
  const m = String(message || "").trim().toLowerCase();
  if (!m) return false;
  if (/^\s*\d+\s*[\+\-\*\/]\s*\d+\s*$/.test(m)) return true;
  if (/\b(what is|calculate|solve)\b/.test(m) && /\d+\s*[\+\-\*\/]\s*\d+/.test(m)) return true;
  return false;
}


const OFFICIAL_EAC_INTENTS = new Set([
  "institutional_info",
  "osa_hours",
  "scholarship",
  "clearance",
  "payment",
  "enrollment",
  "document",
  "discipline",
  "lost_found",
  "id_card",
  "uniform",
  "attendance",
  "grading",
  "announcement",
  "appointment",
  "health",
]);

function buildAssistantQuickReply(message) {
  const m = String(message || "").toLowerCase().trim();
  if (!m) return "";

  if (/\b(who are you|what are you|what is your name|what's your name|your name|anong pangalan mo|sino ka)\b/i.test(m)) {
    return "I am Ask OSA, the OSA Transaction Guide Portal assistant for Emilio Aguinaldo College Cavite. I can help explain services, forms, announcements, Lost & Found, and Student Manual topics.";
  }

  if (/\b(what can you do|how can you help|what do you do|anong kaya mong gawin)\b/i.test(m)) {
    return "I can guide you through official OSA services, forms, announcements, Lost & Found concerns, and Student Manual questions. If a request needs secure verification or staff action, I will point you to the proper next step.";
  }

  if (/\b(how are you|kumusta ka|kamusta ka)\b/i.test(m)) {
    return "I am ready to help. You can ask about OSA services, forms, announcements, Lost & Found items, or Student Manual rules.";
  }

  if (/^(thanks|thank you|salamat|ty)\b/i.test(m)) {
    return "You are welcome. If you need anything else, send your next question here.";
  }

  if (/^(bye|goodbye|see you|paalam)\b/i.test(m)) {
    return "Take care. You can return here anytime if you need help with OSA-related concerns or a quick portal guide.";
  }

  return "";
}

function looksLikeManualPolicyDetailQuery(message) {
  const m = String(message || "")
    .toLowerCase()
    .replace(/['`’]/g, "")
    .replace(/[?!.,;:¿¡()\[\]{}"~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!m) return false;
  if (!/\b(student\s+)?manual\b|\bhandbook\b/.test(m)) return false;
  if (/\b(link|url|download|file|pdf|doc|docx|copy|kopya|send|share)\b/.test(m)) return false;

  return (
    /\b(ano\s+sabi|what\s+does|what\s+says?|according\s+to|elaborate|explain|full\s+details?|detail|policy|policies|rule|rules|section|about|regarding|tungkol)\b/.test(m) ||
    /\b(lost\s+(my\s+)?(school\s+)?id|school\s+id|student\s+id|good\s+moral|incident|organization|event|clearance|discipline|uniform|attendance|grading)\b/.test(m)
  );
}

function normalizeForDupCheck(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g, "$1")
    .replace(/https?:\/\/[^\s)]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNearDuplicateReply(candidate, recentReplies) {
  const normCandidate = normalizeForDupCheck(candidate);
  if (!normCandidate || normCandidate.length < 24) return false;
  return (recentReplies || []).some((entry) => {
    const normPrev = normalizeForDupCheck(entry);
    if (!normPrev) return false;
    if (normPrev === normCandidate) return true;
    if (normCandidate.includes(normPrev) || normPrev.includes(normCandidate)) return true;
    return false;
  });
}

function isLinkOnlyLikeReply(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  const urlCount = (raw.match(/https?:\/\/[^\s)]+/g) || []).length;
  const mdUrlCount = (raw.match(/\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g) || []).length;
  const sentenceCount = raw
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .length;
  const hasDetailSignals = /\b(step|requirement|process|submit|bring|office|timeline|working day|approve|confirm)\b/i.test(raw);
  return (urlCount > 0 || mdUrlCount > 0) && sentenceCount <= 3 && !hasDetailSignals;
}

function looksLikeMissingDetailReply(text) {
  const raw = String(text || "").toLowerCase();
  if (!raw) return false;
  return (
    /\bi don'?t have (the )?specific detail/i.test(raw) ||
    /\bdo not have (the )?specific detail/i.test(raw) ||
    /\bno relevant information found\b/i.test(raw) ||
    /\binsufficient (data|information)\b/i.test(raw)
  );
}

function buildStructuredPolicyFallback(message) {
  const m = String(message || "").toLowerCase();
  if (/\b(lost\s+(my\s+)?(school\s+)?id|school\s+id|student\s+id)\b/.test(m)) {
    return (
      "If your school ID is lost, follow this process:\n\n" +
      "1. Prepare a notarized affidavit of loss.\n" +
      "2. Return to OSA for clearance/endorsement.\n" +
      "3. Proceed to the Cashier for replacement fee payment.\n" +
      "4. Bring your receipt to MIS for photo capture and ID reprocessing.\n\n" +
      "For exact fee amount and release timeline for your current term, confirm with OSA before filing."
    );
  }
  if (/\b(good\s+moral)\b/.test(m)) {
    return (
      "For a Good Moral Certificate, request it through OSA with your valid student ID/student number and required request form/letter. " +
      "Submit complete requirements first, then wait for OSA processing (typically a few working days, depending on queue and current policy updates). " +
      "If you have a deadline, tell OSA immediately so they can advise the best filing schedule."
    );
  }
  if (/\b(incident\s+report)\b/.test(m)) {
    return (
      "For incident filing, use the official Incident Report Form and complete all factual details (date, time, location, persons involved, and narrative). " +
      "Submit it to OSA for review and case handling. " +
      "If the incident is urgent or safety-related, report directly to OSA immediately before waiting for normal processing."
    );
  }
  if (/\b(student\s+org|student\s+organization|organization|org)\b.*\b(event|register|approval|laap)\b/.test(m)) {
    return (
      "Student organization events are coordinated through OSA under student activity governance (including LAAP-related workflow where applicable). " +
      "Prepare your event details first (purpose, schedule, venue, participants, and required signatories), then submit to OSA for review/approval window and final compliance checks."
    );
  }
  return "";
}

function isDeterministicPortalQuery(message) {
  const m = String(message || "").toLowerCase().trim();
  if (!m) return false;
  return (
    /\b(7|seven)\s+services\b/i.test(m) ||
    /\bservices?\s+(ng|of)\s+osa\b/i.test(m) ||
    /\bservices?\s+sa\s+page\b/i.test(m) ||
    /\blatest\s+announcements?\b/i.test(m) ||
    /\bcurrent\s+announcements?\b/i.test(m) ||
    /\bannouncements?\s+sa\s+page\b/i.test(m) ||
    looksLikePortalPageIntent(m)
  );
}

function hasOfficialScopeSignals(message) {
  return (
    /\b(eac|osa|student manual|manual|scholarship|tuition|clearance|enrollment|enroll|lost\s*(and|&)?\s*found|announcement|good moral|discipline|attendance|grading|uniform|cashier|registrar|brightspace|class suspension|school id|student id|office hours|campus pass|portal|dashboard|about\s+portal)\b/i.test(String(message || "")) ||
    looksLikePortalPageIntent(message)
  );
}

function hasDynamicExternalFactSignals(message) {
  return /\b(today|latest|current|currently|as of|news|weather|forecast|price|stock|score|election|president of|prime minister|ceo|breaking)\b/i.test(String(message || ""));
}

function hasUnsafeGeneralTopicSignals(message) {
  return /\b(kill myself|suicide|harm myself|bomb|weapon|gun|hack|hacking|steal password|drugs|shabu|meth|porn)\b/i.test(String(message || ""));
}

// Off-topic ("harmless general AI") fallback is ON by default so the assistant
// can respond naturally to simple non-OSA prompts without sounding robotic.
// Set CHATBOT_ALLOW_GENERAL_FACTS=false to force strict OSA/EAC-only scope.
const CHATBOT_ALLOW_GENERAL_FACTS =
  String(process.env.CHATBOT_ALLOW_GENERAL_FACTS || "true").trim().toLowerCase() === "true";

function mayUseHarmlessGeneralAiFallback(message, meta) {
  if (!CHATBOT_ALLOW_GENERAL_FACTS) return false;
  const m = String(message || "").trim();
  if (!m) return false;
  if (OFFICIAL_EAC_INTENTS.has(meta.intent)) return false;
  if (hasOfficialScopeSignals(m)) return false;
  if (hasDynamicExternalFactSignals(m)) return false;
  if (hasUnsafeGeneralTopicSignals(m)) return false;
  if (buildAssistantQuickReply(m)) return false;
  if (looksLikeIdentityQuery(m) || looksLikeOutOfScopeMath(m) || looksLikeOtpHelpIntent(m)) return false;

  const wordCount = m.split(/\s+/).filter(Boolean).length;
  if (wordCount > 14) return false;

  return (
    /^(who|what|when|where|why|how|can|could|would|define|explain|tell me)\b/i.test(m) ||
    /\b(joke|fun fact|meaning of|what is|what's|who made you)\b/i.test(m) ||
    meta.intent === "general" ||
    meta.intent === "question" ||
    meta.intent === "support"
  );
}

// Strict OSA/EAC scope check — used to short-circuit obvious off-topic prompts.
function looksOnTopicForOsa(message) {
  const m = String(message || "").toLowerCase();
  if (!m.trim()) return true;
  if (m.length <= 3) return true;
  if (/^(hi+|hello+|hey|kumusta|kamusta|good\s+(morning|afternoon|evening|day)|hoy|oi|yo|sup|helo|helow|ello|greetings|thanks?|thank\s+you|salamat|ok|okay|sige|noted|bye+|goodbye)\b/.test(m)) return true;
  // "Emilio Aguinaldo" alone is treated as off-topic (the historical figure).
  // It only counts as on-topic when paired with college/university/school terms.
  if (/\bemilio aguinaldo\s+(college|university|school|institute|cavite)\b/.test(m)) return true;
  return /\b(eac|osa|student\s*affairs|student\s*manual|manual|handbook|scholarship|tuition|clearance|enrollment|enroll|enrol(?:l|led|ling|ment)?|lost\s*(and|&)?\s*found|announcement|good\s*moral|discipline|disciplinary|attendance|tardiness|tardy|absence|absences|grading|grade|grades|uniform|cashier|registrar|register|registration|school\s*id|student\s*id|office\s*hours|campus|appointment|ticket|case|lf-?\d|incident|brightspace|residency|graduation|graduate|transferee|exam|exams|examination|examinations|prelim|midterm|final|finals|semester|term|summer|class\s*size|policy|policies|rule|rules|regulation|requirement|complaint|concern|chat|portal|form|certificate|claim|item|backpack|wallet|id\s*card|lecture|class|classes|teacher|professor|faculty|subject|course|curriculum|guidance|counseling|counselling|sanction|fee|fees|payment|deadline|schedule|drop|dropped|cheating|plagiarism|behavior|behaviour|conduct|residence|organization|organisation|organizations|organisations|\borg\b|\borgs\b|event|events|activity|activities|club|clubs|society|societies|laap|college|university|school|library|clinic|laboratory|laboratories|computer\s*lab|service|services|department|college\s*of|program|programs|programme|programmes|application|applications|apply|requirements?|deadline|deadlines|process|procedure|procedures|step|steps|how\s+to|where\s+(can|do|to)|register\s+for|wash\s*day|dress\s*code|prescribed|prohibited|allowed|emili?an\s+(culture|formation)|loa|leave\s+of\s+absence|grievance)\b/.test(m);
}

const OFF_TOPIC_REFUSALS = [
  "Hi! I focus on OSA services here at EAC Cavite — announcements, lost & found, " +
  "scholarships, appointments, good moral, forms, and any student concern. " +
  "Anything I can help you with on that side? I'd love to assist!",

  "That's a little outside my OSA wheelhouse, but I'm here for anything EAC Cavite student-life " +
  "related — announcements, lost & found claims, scholarships, appointments, your good moral " +
  "request, forms, you name it. Just tell me what you need!",

  "Hmm, not quite my area — but I'm your OSA buddy for EAC Cavite! Ask me about announcements, " +
  "lost & found, scholarships, appointments, certificates, or anything OSA staff handles, and " +
  "I'll walk you through it. What's on your mind?",

  "Friendly heads-up: I'm built around OSA at EAC Cavite, so I'm best with student services, " +
  "announcements, lost & found, scholarships, appointments, and forms. Pop me a question on any " +
  "of those and we're good to go!",
];

function pickOffTopicReply() {
  return OFF_TOPIC_REFUSALS[Math.floor(Math.random() * OFF_TOPIC_REFUSALS.length)];
}

const CASUAL_FILIPINO_REPLIES = [
  "Kumusta! I'm your OSA assistant here at EAC Cavite — happy to help kahit anong OSA-related " +
  "concern: announcements, lost & found, scholarships, appointments, forms, good moral cert, " +
  "or any student service. Ano'ng maitutulong ko ngayon?",

  "Hello! I'm doing great, salamat sa pagtatanong! I'm here to help with anything OSA at EAC " +
  "Cavite — announcements, lost & found, scholarships, appointments, certificates, and student " +
  "concerns. Anong gusto mong itanong?",

  "Hi! Always ready to help with OSA matters — student services, announcements, scholarships, " +
  "appointments, lost & found, good moral, anything OSA-related at EAC Cavite. Ano'ng kailangan mo today?",
];

function pickCasualReply() {
  return CASUAL_FILIPINO_REPLIES[Math.floor(Math.random() * CASUAL_FILIPINO_REPLIES.length)];
}

// Friendly Filipino/Taglish casual chat — greet back warmly with a soft pivot
// to OSA topics rather than a stiff scope refusal.
function looksLikeCasualSocial(message) {
  const m = String(message || "").toLowerCase().trim();
  if (!m) return false;
  if (m.length > 80) return false;
  return /\b(kumain|kain|kakain|nakakain|kumain\s*ka|kumusta|kamusta|musta|mustha|mustha?\s*ka|how\s*are\s*you|pano\s*ka|ano\s*kaya|bakit\s*ganon|kasi\s*kasi|ano\s*ka|ano\s*ba|ako\s*ay|pwede\s*ba|grabe|ang\s*galing|nice|cool|lol|haha|hehe|kewl|love\s*you|miss\s*you|tagal)\b/.test(m);
}

function effectiveGuestRagMinConfidence(meta, ragResult) {
  let threshold = CHATBOT_RAG_MIN_CONFIDENCE;
  const method = String(ragResult?.method || "");
  const chunkCount = Array.isArray(ragResult?.chunks) ? ragResult.chunks.length : 0;

  if (meta.intent === "institutional_info" || meta.intent === "scholarship") threshold -= 0.05;
  if (meta.intent === "clearance" || meta.intent === "enrollment" || meta.intent === "document") threshold -= 0.04;
  if (method.includes("static-local")) threshold -= 0.04;
  if (method.includes("hybrid") || method.includes("keyword-boost")) threshold -= 0.03;
  if (chunkCount >= 3) threshold -= 0.02;

  return Math.max(0.42, Number(threshold.toFixed(2)));
}

/** Guest may use LLM with live DB only (no manual chunks) for these intents — not for open policy guesses. */
function guestMayAnswerFromLivePortalOnly(message) {
  const m = String(message || "").toLowerCase();
  if (!m.trim()) return false;
  return (
    /\b(announcement|announcements|posted|latest\s+news|what\s+is\s+new|anong\s+bago)\b/i.test(m) ||
    /\b(lost\s*(and|&)?\s*found|\blf[-\s]?\d|\bunclaimed|claimed|pick\s*up|retrieve)\b/i.test(m) ||
    /\b(osa\s+)?services?\b/i.test(m) ||
    /\b(list|how\s+many|count|ilang)\b.*\b(services|announcements)\b/i.test(m) ||
    /\b\d+\s+services\b/i.test(m) ||
    /\bservices?\s+of\s+(the\s+)?(this\s+)?system\b/i.test(m) ||
    looksLikePortalPageIntent(m)
  );
}

async function runChatPipeline({ message, conversationId, userId }) {
  const processed = preprocessUserInput(message);
  const otpIntent = looksLikeOtpHelpIntent(processed.cleanedText);
  const deterministicPortalQuery = isDeterministicPortalQuery(processed.cleanedText);
  if (!processed.cleanedText) {
    return withAnswerFields({
      response: "Please type your question so I can help you.",
      provider: "none",
      cached: false,
      escalate: false,
      intent: processed.intent,
      complexity: processed.complexity,
      conversationId: conversationId || null,
      userId: userId || null,
    });
  }

  // Direct, no-escalation answer for "give me the link to the student manual /
  // scholarship application form / etc." The LLM was previously refusing to
  // share URLs ("I cannot provide direct links here"), so we bypass it
  // entirely with the authoritative list from OFFICIAL_FORMS.
  {
    const formsMatch =
      looksLikeFormsLinkQuery(processed.cleanedText) || looksLikeFormsLinkQuery(message);
    if (formsMatch) {
      const reply = buildFormsLinkReply(formsMatch);
      if (reply) {
        try {
          await appendMemory(conversationId, "user", processed.cleanedText);
        } catch (err) { logError("memory-write-user-forms", err); }
        try {
          await appendMemory(conversationId, "assistant", reply);
        } catch (err) { logError("memory-write-assistant-forms", err); }
        rememberAssistantReply(conversationId, reply);
        return withAnswerFields({
          response: reply,
          provider: "forms-shortcircuit",
          cached: false,
          escalate: false,
          intent: processed.intent,
          complexity: processed.complexity,
          conversationId: conversationId || null,
          userId: userId || null,
        });
      }
    }
  }

  // Direct, no-escalation answer for trivial date/time small-talk so the LLM
  // never hallucinates ("Today is Friday, May 17, 2024") and the response
  // never trips the "Verify email & escalate" card.
  if (looksLikeDateTimeQuery(processed.cleanedText) || looksLikeDateTimeQuery(message)) {
    const reply = buildDateTimeReply(processed.cleanedText || message);
    try {
      await appendMemory(conversationId, "user", processed.cleanedText);
    } catch (err) { logError("memory-write-user-datetime", err); }
    try {
      await appendMemory(conversationId, "assistant", reply);
    } catch (err) { logError("memory-write-assistant-datetime", err); }
    rememberAssistantReply(conversationId, reply);
    return withAnswerFields({
      response: reply,
      provider: "datetime-shortcircuit",
      cached: false,
      escalate: false,
      intent: processed.intent,
      complexity: processed.complexity,
      conversationId: conversationId || null,
      userId: userId || null,
    });
  }

  // ── Off-topic short-circuit ─────────────────────────────────────
  // Refuse questions that are clearly outside OSA / EAC scope (translations,
  // trivia, dating advice, profanity, etc.) before they reach the LLM.
  // Skipped when CHATBOT_ALLOW_GENERAL_FACTS=true.
  if (
    !CHATBOT_ALLOW_GENERAL_FACTS &&
    !otpIntent &&
    !deterministicPortalQuery &&
    !looksOnTopicForOsa(processed.cleanedText) &&
    !looksOnTopicForOsa(message) &&
    !looksLikePortalPageIntent(processed.cleanedText)
  ) {
    const isCasualSocial =
      looksLikeCasualSocial(processed.cleanedText) || looksLikeCasualSocial(message);
    const lcRaw = String(message || "").toLowerCase();
    const isComplaintOrProfanity =
      /\b(fuck|fucking|bitch|shit|asshole|putang|tangina|gago|gaga|tanga|bobo|ulol|hayop|oa|tagal|di\s*na\s*makausap|hindi\s*na\s*makausap|wala\s*ka|useless|stupid\s*ai|annoying|inis|bakit\s*ganon|ang\s*hirap)\b/.test(lcRaw);
    const offTopicReply = isComplaintOrProfanity
      ? ("Sorry kung nakakapagod — let's start fresh. I'm your OSA assistant for EAC Cavite and I'd really like to help. " +
         "Try asking me about anything OSA-related: announcements, lost & found claims, scholarships, your appointment, good moral certificate, " +
         "or any concern you'd like staff to look into. I'm here for you!")
      : isCasualSocial
        ? pickCasualReply()
        : pickOffTopicReply();
    try {
      await appendMemory(conversationId, "user", processed.cleanedText);
    } catch (err) { logError("memory-write-user-offtopic", err); }
    try {
      await appendMemory(conversationId, "assistant", offTopicReply);
    } catch (err) { logError("memory-write-assistant-offtopic", err); }
    rememberAssistantReply(conversationId, offTopicReply);
    return withAnswerFields({
      response: offTopicReply,
      provider: isCasualSocial ? "casual-social-reply" : "off-topic-refusal",
      cached: false,
      escalate: false,
      intent: processed.intent,
      complexity: processed.complexity,
      conversationId: conversationId || null,
      userId: userId || null,
    });
  }

  // ── Early live-staff / escalation quick-reply ───────────────────
  // Done BEFORE the cache lookup so a previous generic "How can I help?"
  // cached for the bare word "how?" can never overwrite the proper
  // step-by-step escalation guidance. Memory is loaded eagerly here
  // because the "how?" follow-up branch needs the prior assistant turn.
  {
    const earlyMemory = await getRecentMemory(conversationId).catch((error) => {
      logError("memory-read-early", error);
      return [];
    });
    const earlyQuick = buildDomainQuickReply(processed.cleanedText, earlyMemory);
    const earlyText =
      typeof earlyQuick === "string"
        ? ""  // legacy string path (appointment) is handled later, after cache
        : (earlyQuick && earlyQuick.text) || "";
    const earlyEscalate =
      typeof earlyQuick === "object" && earlyQuick !== null
        ? earlyQuick.escalate === true
        : false;
    if (earlyText && earlyEscalate) {
      try {
        await appendMemory(conversationId, "user", processed.cleanedText);
      } catch (err) { logError("memory-write-user-early-quick", err); }
      try {
        await appendMemory(conversationId, "assistant", earlyText);
      } catch (err) { logError("memory-write-assistant-early-quick", err); }
      rememberAssistantReply(conversationId, earlyText);
      return withAnswerFields({
        response: earlyText,
        provider: "domain-quick-reply",
        cached: false,
        escalate: true,
        intent: processed.intent,
        complexity: processed.complexity,
        conversationId: conversationId || null,
        userId: userId || null,
      });
    }
  }

  const cacheKey = buildCacheKey({
    policy: POLICY_VERSION,
    text: processed.cleanedText.toLowerCase(),
    intent: processed.intent,
    routeHint: processed.routeHint,
  });

  // Deterministic portal intents should not be shadowed by stale cache.
  const shouldBypassCache =
    otpIntent ||
    deterministicPortalQuery ||
    looksLikeManualPolicyDetailQuery(processed.cleanedText);
  if (!shouldBypassCache) {
    try {
      const cached = await getCachedResponse(cacheKey);
      if (cached && cached.response) {
        const provider = String(cached.provider || "cache");
        const staleEscalationProvider =
          provider === "no-reliable-kb-no-sources" ||
          provider === "no-reliable-kb-low-confidence" ||
          provider === "fallback-static" ||
          provider === "no-kb-guidance-static";
        const cleanedCached = cleanModelText(cached.response);
        const cachedIsDeadEnd = cleanedCached === NO_RELIABLE_KB_REPLY ||
          /^\s*i couldn'?t find a reliable answer/i.test(String(cleanedCached).trim());
        if ((staleEscalationProvider || cachedIsDeadEnd) && isDeterministicPortalQuery(processed.cleanedText)) {
          // Ignore stale escalation cache for service/announcement listing questions.
        } else if (staleEscalationProvider || cachedIsDeadEnd) {
          // Never serve a cached dead-end fallback — always re-try live with AI guidance.
        } else {
        const text = cleanedCached || ensureUserFacingFallback();
        const esc =
          text === NO_RELIABLE_KB_REPLY ||
          /no relevant information found/i.test(text) ||
          /\binsufficient (data|information)\b/i.test(String(text).toLowerCase());
        return withAnswerFields({
          response: text,
          provider,
          cached: true,
          escalate: esc,
          intent: processed.intent,
          complexity: processed.complexity,
          conversationId: conversationId || null,
          userId: userId || null,
        });
        }
      }
    } catch (error) {
      logError("cache-read", error);
    }
  }

  const memory = await getRecentMemory(conversationId).catch((error) => {
    logError("memory-read", error);
    return [];
  });
  const recentAssistantReplies = (memory || [])
    .filter((m) => m && m.role === "assistant" && String(m.content || "").trim())
    .slice(-3)
    .map((m) => String(m.content || ""));
  const recentAssistantRepliesMerged = [
    ...recentAssistantReplies,
    ...getRecentAssistantReplyMemory(conversationId),
  ].slice(-6);

  // Late-stage quick-reply path — handles the legacy string returns
  // from buildDomainQuickReply (currently: appointment booking). The
  // escalation/live-staff branches were already handled BEFORE the
  // cache lookup above so a stale cached "How can I help?" reply for
  // bare "how?" can't shadow them.
  const domainQuickReplyRaw = buildDomainQuickReply(processed.cleanedText, memory);
  const domainQuickReplyText =
    typeof domainQuickReplyRaw === "string" ? domainQuickReplyRaw : "";
  if (domainQuickReplyText) {
    await appendMemory(conversationId, "user", processed.cleanedText).catch((error) => logError("memory-write-user", error));
    await appendMemory(conversationId, "assistant", domainQuickReplyText).catch((error) => logError("memory-write-assistant", error));
    rememberAssistantReply(conversationId, domainQuickReplyText);
    try {
      await saveCachedResponse(cacheKey, processed.cleanedText, domainQuickReplyText, "domain-quick-reply");
    } catch (error) {
      logError("cache-write-quick-reply", error);
    }
    return withAnswerFields({
      response: domainQuickReplyText,
      provider: "domain-quick-reply",
      cached: false,
      escalate: false,
      intent: processed.intent,
      complexity: processed.complexity,
      conversationId: conversationId || null,
      userId: userId || null,
    });
  }

  if (processed.intent === "greeting") {
    const greet =
      "Hello! I can help with OSA services, forms, Lost & Found, and policies. How can I help today?";
    await appendMemory(conversationId, "user", processed.cleanedText).catch((error) => logError("memory-write-user", error));
    await appendMemory(conversationId, "assistant", greet).catch((error) => logError("memory-write-assistant", error));
    rememberAssistantReply(conversationId, greet);
    try {
      await saveCachedResponse(cacheKey, processed.cleanedText, greet, "greeting-static");
    } catch (error) {
      logError("cache-write-greeting", error);
    }
    return withAnswerFields({
      response: greet,
      provider: "greeting-static",
      cached: false,
      escalate: false,
      intent: processed.intent,
      complexity: processed.complexity,
      conversationId: conversationId || null,
      userId: userId || null,
      retrieval: { chunkCount: 0, tier: "N/A", confidence: 0 },
    });
  }

  if (looksLikeIdentityQuery(processed.cleanedText)) {
    const idReply =
      "I can identify your profile only after secure verification. Use the Verify email card in this chat, then ask again and I will show the signed-in name.";
    await appendMemory(conversationId, "user", processed.cleanedText).catch((error) => logError("memory-write-user", error));
    await appendMemory(conversationId, "assistant", idReply).catch((error) => logError("memory-write-assistant", error));
    rememberAssistantReply(conversationId, idReply);
    try {
      await saveCachedResponse(cacheKey, processed.cleanedText, idReply, "identity-gated");
    } catch (error) {
      logError("cache-write-identity-gated", error);
    }
    return withAnswerFields({
      response: idReply,
      provider: "identity-gated",
      cached: false,
      escalate: false,
      otp_action: true,
      intent: processed.intent,
      complexity: processed.complexity,
      conversationId: conversationId || null,
      userId: userId || null,
      retrieval: { chunkCount: 0, tier: "N/A", confidence: 0 },
    });
  }

  const assistantQuickReply = buildAssistantQuickReply(processed.cleanedText);
  if (assistantQuickReply) {
    await appendMemory(conversationId, "user", processed.cleanedText).catch((error) => logError("memory-write-user", error));
    await appendMemory(conversationId, "assistant", assistantQuickReply).catch((error) => logError("memory-write-assistant", error));
    rememberAssistantReply(conversationId, assistantQuickReply);
    try {
      await saveCachedResponse(cacheKey, processed.cleanedText, assistantQuickReply, "assistant-quick-reply");
    } catch (error) {
      logError("cache-write-assistant-quick-reply", error);
    }
    return withAnswerFields({
      response: assistantQuickReply,
      provider: "assistant-quick-reply",
      cached: false,
      escalate: false,
      intent: processed.intent,
      complexity: processed.complexity,
      conversationId: conversationId || null,
      userId: userId || null,
      retrieval: { chunkCount: 0, tier: "N/A", confidence: 0 },
    });
  }

  if (looksLikeOutOfScopeMath(processed.cleanedText)) {
    const match = String(processed.cleanedText).match(/(-?\d+(?:\.\d+)?)\s*([\+\-\*\/])\s*(-?\d+(?:\.\d+)?)/);
    let mathReply = "I can help with OSA concerns and portal information. For simple math, 1 + 1 = 2.";
    if (match) {
      const a = Number(match[1]);
      const op = match[2];
      const b = Number(match[3]);
      let answer = null;
      if (op === "+") answer = a + b;
      if (op === "-") answer = a - b;
      if (op === "*") answer = a * b;
      if (op === "/") answer = b === 0 ? null : a / b;
      if (answer !== null && Number.isFinite(answer)) {
        mathReply = `${a} ${op} ${b} = ${answer}`;
      } else if (op === "/" && b === 0) {
        mathReply = "Division by zero is undefined.";
      }
    }
    await appendMemory(conversationId, "user", processed.cleanedText).catch((error) => logError("memory-write-user", error));
    await appendMemory(conversationId, "assistant", mathReply).catch((error) => logError("memory-write-assistant", error));
    rememberAssistantReply(conversationId, mathReply);
    try {
      await saveCachedResponse(cacheKey, processed.cleanedText, mathReply, "math-quick-reply");
    } catch (error) {
      logError("cache-write-math-quick-reply", error);
    }
    return withAnswerFields({
      response: mathReply,
      provider: "math-quick-reply",
      cached: false,
      escalate: false,
      intent: processed.intent,
      complexity: processed.complexity,
      conversationId: conversationId || null,
      userId: userId || null,
      retrieval: { chunkCount: 0, tier: "N/A", confidence: 0 },
    });
  }

  if (otpIntent) {
    const otpReply = otpHelperReply();
    await appendMemory(conversationId, "user", processed.cleanedText).catch((error) => logError("memory-write-user", error));
    await appendMemory(conversationId, "assistant", otpReply).catch((error) => logError("memory-write-assistant", error));
    rememberAssistantReply(conversationId, otpReply);
    try {
      await saveCachedResponse(cacheKey, processed.cleanedText, otpReply, "otp-help");
    } catch (error) {
      logError("cache-write-otp-help", error);
    }
    return withAnswerFields({
      response: otpReply,
      provider: "otp-help",
      cached: false,
      escalate: false,
      otp_action: true,
      intent: processed.intent,
      complexity: processed.complexity,
      conversationId: conversationId || null,
      userId: userId || null,
      retrieval: { chunkCount: 0, tier: "N/A", confidence: 0 },
    });
  }

  let ragResult = null;
  let liveCtx = "";
  try {
    [ragResult, liveCtx] = await Promise.all([
      searchRag(processed.cleanedText),
      getPublicLiveContext(),
    ]);
  } catch (error) {
    logError("rag-retrieval", error);
    ragResult = { context: "", chunks: [], tier: "ESCALATE", confidence: 0, method: "error" };
  }

  const chunkCount = ragResult && Array.isArray(ragResult.chunks) ? ragResult.chunks.length : 0;
  const confidence = Number(ragResult?.confidence || 0);
  const liveOk = hasSubstantialLiveCtx(liveCtx);
  const retrievalMeta = {
    chunkCount,
    tier: ragResult?.tier || "ESCALATE",
    confidence,
  };

  if (CHATBOT_DEBUG) {
    // eslint-disable-next-line no-console
    console.log(
      `[chatbot:rag] query="${processed.cleanedText.slice(0, 100)}" ` +
      `chunks=${chunkCount} conf=${confidence.toFixed(3)} ` +
      `tier=${ragResult?.tier || "ESCALATE"} hasLiveCtx=${liveOk}`
    );
  }

  async function persistTurn(response, provider) {
    await appendMemory(conversationId, "user", processed.cleanedText).catch((error) => logError("memory-write-user", error));
    await appendMemory(conversationId, "assistant", response).catch((error) => logError("memory-write-assistant", error));
    rememberAssistantReply(conversationId, response);
    try {
      await saveCachedResponse(cacheKey, processed.cleanedText, response, provider);
    } catch (error) {
      logError("cache-write", error);
    }
  }

  if (CHAT_TIER1_FAQ_ENABLED && !looksLikeManualPolicyDetailQuery(processed.cleanedText)) {
    const faq = await searchFaq(processed.cleanedText);
    if (faq) {
      const rawFaqAnswer = cleanModelText(String((faq && faq.answer) || "").trim());
      let reply = rawFaqAnswer || NO_RELIABLE_KB_REPLY;

      // Try to have the LLM rephrase the FAQ answer naturally — if it fails,
      // fall back to the raw answer so the user still gets a response.
      if (rawFaqAnswer) {
        try {
          const faqSystemPrompt =
            `You are the OSA Assistant of Emilio Aguinaldo College (EAC) Cavite.\n` +
            `Answer the student's question using ONLY the approved answer below. Do not add, invent, or omit any policy detail.\n` +
            `Write in clear, natural, helpful English. Keep it concise (2–4 sentences or bullets when needed).\n` +
            `Output only the reply — no labels, no scaffolding, no echoing these instructions.\n\n` +
            `Approved answer:\n${rawFaqAnswer}`;
          const draft = await executeProvider(
            processed.routeHint === "groq" ? "groq" : "gemini",
            { systemPrompt: faqSystemPrompt, messages: [{ role: "user", content: processed.cleanedText }] }
          );
          const aiPhrased = cleanModelText(draft);
          if (aiPhrased && !/no relevant information/i.test(aiPhrased)) {
            reply = aiPhrased;
          }
        } catch (_) {
          // LLM unavailable — raw FAQ answer is the safe fallback
        }
      }

      if (isNearDuplicateReply(reply, recentAssistantRepliesMerged)) {
        const structured = buildStructuredPolicyFallback(processed.cleanedText);
        if (structured) reply = structured;
      }

      await persistTurn(reply, "faq-tier1-ai");
      return withAnswerFields({
        response: reply,
        provider: "faq-tier1-ai",
        cached: false,
        escalate: false,
        intent: processed.intent,
        complexity: processed.complexity,
        conversationId: conversationId || null,
        userId: userId || null,
        retrieval: retrievalMeta,
      });
    }
  }

  const messages = [
    ...memory,
    { role: "user", content: processed.cleanedText },
  ];
  const allowGeneralAiFallback = mayUseHarmlessGeneralAiFallback(processed.cleanedText, processed);
  const minConfidence = effectiveGuestRagMinConfidence(processed, ragResult);
  const useGeneralFallbackMode =
    allowGeneralAiFallback &&
    (
      chunkCount === 0 ||
      (chunkCount > 0 && confidence < minConfidence)
    );

  const needsNoKbGuidance =
    !useGeneralFallbackMode &&
    !(liveOk && guestMayAnswerFromLivePortalOnly(processed.cleanedText)) &&
    (chunkCount === 0 || (chunkCount > 0 && confidence < minConfidence));

  const providers = buildProviderChain(processed);
  let selectedProvider = "none";
  let responseText = "";
  let failedProvider = null;
  let failedHint = "";
  const systemPrompt = needsNoKbGuidance
    ? makeNoKbGuidancePrompt(processed)
    : useGeneralFallbackMode
      ? makeGeneralFallbackPrompt(processed)
      : makeGuestSystemPromptWithRag(processed, ragResult, liveCtx);

  for (const provider of providers) {
    try {
      const draft = await executeProvider(provider, {
        systemPrompt,
        messages,
      });
      let cleaned = cleanModelText(draft);
      if (!cleaned) throw new Error("Empty response");
      const looksLikeNoKb =
        /^\s*no relevant information found\b/i.test(String(cleaned).trim()) ||
        /\bi have insufficient (data|information)\b/i.test(String(cleaned).toLowerCase()) ||
        /\binsufficient data to answer\b/i.test(String(cleaned).toLowerCase());
      if (looksLikeNoKb && !needsNoKbGuidance) {
        cleaned = useGeneralFallbackMode
          ? "I can help with simple questions and official OSA topics. For school-specific policies or transactions, please ask about the exact service, form, announcement, or Student Manual topic you need."
          : NO_RELIABLE_KB_REPLY;
      }
      if (failedProvider) {
        // eslint-disable-next-line no-console
        console.warn(
          `[chatbot:provider-fallback] "${failedProvider}" failed (${failedHint}) → reply from "${provider}"`
        );
      }
      selectedProvider = needsNoKbGuidance
        ? `${provider}-no-kb-guidance`
        : useGeneralFallbackMode ? `${provider}-general-fallback` : provider;
      responseText = cleaned;
      break;
    } catch (error) {
      failedProvider = provider;
      failedHint = providerFailureHint(error);
      if (provider === "gemini" && error?.geminiAllKeysFailed && providers.includes("groq")) {
        // eslint-disable-next-line no-console
        console.warn("[chatbot:provider-fallback] all Gemini API keys failed; attempting Groq emergency fallback.");
      }
      logError(`provider-${provider}`, error);
    }
  }

  if (!responseText) {
    if (failedProvider) {
      // eslint-disable-next-line no-console
      console.warn(
        `[chatbot:provider-fallback] exhausted provider chain (last="${failedProvider}" ${failedHint}) → escalation`
      );
    }
    responseText = needsNoKbGuidance
      ? "For this topic, I'd recommend reaching out to the OSA directly for accurate and official information. You can visit the OSA office or verify your campus email to continue in secure chat with our staff."
      : useGeneralFallbackMode
        ? "I can help with simple questions and official OSA topics. For school-specific policies or transactions, please ask about the specific service, form, announcement, or Student Manual topic you need."
        : NO_RELIABLE_KB_REPLY;
    selectedProvider = needsNoKbGuidance
      ? "no-kb-guidance-static"
      : useGeneralFallbackMode ? "general-fallback-static" : "fallback-static";
  }

  const escalateFlag =
    needsNoKbGuidance ||
    responseText === NO_RELIABLE_KB_REPLY ||
    /^\s*no relevant information found\b/im.test(String(responseText).trim());

  // Final formatting pass: enforce friendly link labels + paragraph spacing
  // around any URLs the model emitted (or that came from static replies).
  responseText = tidyOfficialLinks(responseText);
  if (
    isNearDuplicateReply(responseText, recentAssistantRepliesMerged) ||
    (looksLikeManualPolicyDetailQuery(processed.cleanedText) &&
      (isLinkOnlyLikeReply(responseText) || looksLikeMissingDetailReply(responseText)))
  ) {
    const structured = buildStructuredPolicyFallback(processed.cleanedText);
    if (structured) responseText = structured;
  }

  await persistTurn(responseText, selectedProvider);

  return withAnswerFields({
    response: responseText,
    provider: selectedProvider,
    cached: false,
    escalate: escalateFlag,
    intent: processed.intent,
    complexity: processed.complexity,
    conversationId: conversationId || null,
    userId: userId || null,
    retrieval: retrievalMeta,
  });
}

module.exports = {
  runChatPipeline,
  tidyOfficialLinks,
};
