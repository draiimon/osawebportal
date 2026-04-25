/**
 * Input preprocessor — cleans, classifies intent, and estimates complexity.
 *
 * Intent categories (ordered from most specific to least):
 *   OSA-specific: osa_hours, scholarship, clearance, payment, enrollment,
 *                 document, discipline, lost_found, id_card, uniform,
 *                 attendance, grading, announcement, appointment, health
 *   Generic:      greeting, support, coding, question, general, empty
 *
 * Tagalog / Taglish / slang variants are mapped to canonical intent so the
 * router and RAG pipeline can make the right provider and threshold choices.
 */

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .replace(/([a-z])\1{2,}/g, "$1$1")
    .trim();
}

function tokenizeForIntent(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);
}

function levenshteinDistance(a, b) {
  const s = String(a || "");
  const t = String(b || "");
  const m = s.length;
  const n = t.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function fuzzyTokenMatches(inputToken, hintToken) {
  const a = normalizeToken(inputToken);
  const b = normalizeToken(hintToken);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  if (a.includes(b) || b.includes(a)) return true;
  if (Math.abs(a.length - b.length) > 2) return false;
  const dist = levenshteinDistance(a, b);
  if (dist <= 1) return true;
  return dist === 2 && Math.min(a.length, b.length) >= 6;
}

// ── Intent patterns ───────────────────────────────────────────────────────────
// Each pattern is tested against the lower-cased, whitespace-normalised text.
// First match wins — order matters (most specific first).

const INTENT_PATTERNS = [
  // Institutional identity / manual front matter / leadership
  {
    intent: "institutional_info",
    pattern: /\b(president'?s?\s+message|chairman'?s?\s+message|president\s+of\s+eac|presidente\s+ng\s+eac|sino\s+ang\s+president|sino\s+president|sino\s+ang\s+presidente|sino\s+presidente|board of directors|philosophy|vision|mission|core values|educational objectives|quality policy|quality objectives)\b/i,
  },
  // OSA office hours / location / open-close
  {
    intent: "osa_hours",
    pattern: /\b(open|close|bukas|sarado|hours|oras|office hours|anong oras|what time|business hours|operating hours|lunch break|available|saturday|linggo|holiday|holiday open|sched|schedule ng office)\b/i,
  },
  // Scholarship / financial aid / discount
  {
    intent: "scholarship",
    pattern: /\b(scholarship|scholar|scholastic|financial aid|tuition discount|pioneer discount|sap|safe|pvao|ched scholarship|unifast|sibling discount|pwd discount|bayarin|libre|merit|academic award|grant)\b/i,
  },
  // Clearance
  {
    intent: "clearance",
    pattern: /\b(clearance|i-clear|ma-clear|clear na|clearance form|clearance process|sign clearance|get clearance|clearance release|hold clearance|pending clearance|clearance requirements|mag clearance|kumuha ng clearance)\b/i,
  },
  // Payment / fees / cashier
  {
    intent: "payment",
    pattern: /\b(payment|pay|bayad|magbayad|cashier|tuition|fee|installment|partial payment|gcash|online payment|receipt|official receipt|cut.?off|deadline ng bayad|late payment|down payment|refund|balance|utang|account payable|reflection ng payment)\b/i,
  },
  // Enrollment / registration
  {
    intent: "enrollment",
    pattern: /\b(enroll|enrollment|mag-enroll|pag-enroll|registration|mag-register|adding|dropping|change subjects|load|subjects|units|pre-requisite|schedule of classes|class schedule|first day|pasok na|semester start|academic calendar|when enroll|when to enroll)\b/i,
  },
  // Documents / certificates / records
  {
    intent: "document",
    pattern: /\b(good moral|good moral certificate|certificate|certification|transcript|tor|records|student records|diploma|form 137|form 138|document request|release ng document|processing ng document|rush release|ilang days|processing time|request form|official document)\b/i,
  },
  // Discipline / violations / conduct
  {
    intent: "discipline",
    pattern: /\b(disciplinary|offense|violation|major offense|minor offense|sanction|penalty|suspension|expelled|expulsion|misconduct|case|complaint|appeal|hearing|probation|cheating|plagiarism|hazing|bullying|harassment|fight|misconduct|misbehavior|summon|investigation)\b/i,
  },
  // Lost and found
  {
    intent: "lost_found",
    pattern: /\b(lost|found|lf-|lost and found|lost item|found item|claim|nawala|nakita|natagpuan|item number|unclaimed|claimed|missing|missing item|return item|lfnumber|lf\d)\b/i,
  },
  // ID card
  {
    intent: "id_card",
    pattern: /\b(id card|school id|student id|id replacement|lost id|new id|id process|id release|temporary id|campus pass|id validation|id renewal|id requirements|id policy|wear id)\b/i,
  },
  // Uniform / dress code
  {
    intent: "uniform",
    pattern: /\b(uniform|dress code|school uniform|type a|washday|attire|shoes|hair|earring|leggings|sando|mini skirt|sandals|slippers|proper attire|wearing)\b/i,
  },
  // Attendance / absences / tardiness
  {
    intent: "attendance",
    pattern: /\b(attendance|absent|absences|tardy|tardiness|late|uwaw|authorized absence|unexcused|attendance policy|80 percent|percentage|max absences|attendance record)\b/i,
  },
  // Grading / GWA / marks
  {
    intent: "grading",
    pattern: /\b(grade|grading|gwa|gpa|grade point|passing grade|incomplete|inc|ow|uw|official withdrawal|unauthorized withdrawal|failed|5\.0|failing|mark|computation ng grade|how grades|grade computation)\b/i,
  },
  // Announcements / events / news
  {
    intent: "announcement",
    pattern: /\b(announcement|announcements|notice|advisory|event|activity|schedule|class suspension|no classes|suspendedin|news|update|bulletin|post|latest news|osa news|what's new|anong bago|meron bang)\b/i,
  },
  // Appointment / scheduling with OSA staff
  {
    intent: "appointment",
    pattern: /\b(appointment|schedule a visit|schedule a meeting|book a visit|book a meeting|meet with osa|set a meeting|set an appointment|pa-schedule|magpa-appointment|visit osa|face to face|in person)\b/i,
  },
  // Health / clinic / medical
  {
    intent: "health",
    pattern: /\b(health|medical|clinic|doctor|nurse|sick|medical certificate|health clearance|physical exam|medical exam|vaccination|communicable disease|health requirement|mental health|psychological|wellness|medical record)\b/i,
  },
  // Generic greeting
  {
    intent: "greeting",
    pattern: /^(hi|hello|hey|good (morning|afternoon|evening)|yo|kumusta|kamusta|hoy|oi)\b/i,
  },
  // Support / help request
  {
    intent: "support",
    pattern: /\b(help|assist|support|guide|patulong|tulungan|saan|how to start)\b/i,
  },
  // Informational / question words
  {
    intent: "question",
    pattern: /\b(what|how|why|when|where|can|could|should|pwede|paano|ano|bakit|kailan|saan|sino|ilan)\b/i,
  },
];

const FUZZY_INTENT_HINTS = {
  institutional_info: ["president", "presidente", "message", "chairman", "mission", "vision", "philosophy", "quality", "values"],
  scholarship: ["scholarship", "scholar", "grant", "discount", "unifast", "pvao", "merit"],
  clearance: ["clearance", "clear", "pending", "hold"],
  payment: ["payment", "bayad", "cashier", "tuition", "refund", "receipt", "installment"],
  enrollment: ["enroll", "enrollment", "registration", "subjects", "units", "prerequisite"],
  document: ["certificate", "transcript", "records", "diploma", "document", "goodmoral"],
  discipline: ["offense", "violation", "sanction", "penalty", "bullying", "hazing", "cheating"],
  lost_found: ["lost", "found", "missing", "claim", "unclaimed"],
  id_card: ["id", "campuspass", "validation", "replacement"],
  uniform: ["uniform", "attire", "washday", "shoes", "hair", "earring"],
  attendance: ["attendance", "absent", "tardy", "late", "absence"],
  grading: ["grade", "grading", "gwa", "gpa", "incomplete", "failed"],
  announcement: ["announcement", "advisory", "event", "news", "update"],
  appointment: ["appointment", "schedule", "meeting", "visit"],
  health: ["health", "medical", "clinic", "wellness", "clearance"],
};

function detectIntentFuzzy(text) {
  const tokens = tokenizeForIntent(text);
  if (!tokens.length) return "general";

  let bestIntent = "general";
  let bestScore = 0;

  for (const [intent, hints] of Object.entries(FUZZY_INTENT_HINTS)) {
    let score = 0;
    for (const token of tokens) {
      if (token.length < 4) continue;
      if (hints.some((hint) => fuzzyTokenMatches(token, hint))) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent;
    }
  }

  return bestScore >= 1 ? bestIntent : "general";
}

/**
 * Detects the most specific intent that matches the normalized input text.
 * Returns the intent string from INTENT_PATTERNS, or "general" as fallback.
 */
function detectIntent(text) {
  const lower = String(text || "").toLowerCase();
  if (!lower.trim()) return "empty";
  for (const { intent, pattern } of INTENT_PATTERNS) {
    if (pattern.test(lower)) return intent;
  }
  return detectIntentFuzzy(lower);
}

// OSA-specific intents that require accurate policy grounding — mark as complex
// so the router will prefer the higher-quality LLM (Gemini) over Groq.
const POLICY_INTENTS = new Set([
  "institutional_info",
  "scholarship", "clearance", "payment", "enrollment",
  "document", "discipline", "id_card", "attendance",
  "grading", "health",
]);

// Intents that only need a quick factual lookup — treat as simple
const SIMPLE_INTENTS = new Set([
  "greeting", "osa_hours", "lost_found", "announcement", "id_card", "uniform",
]);

function estimateComplexity(text, intent) {
  const tokens = String(text || "").split(" ").filter(Boolean).length;
  const hasMultiPart = /[?].*[?]|(?:\b(and|also|then|plus|at saka|tapos)\b.*){2,}/i.test(text);

  let base = 1;
  if (POLICY_INTENTS.has(intent)) base = 3;          // policy queries need grounding
  else if (SIMPLE_INTENTS.has(intent)) base = 1;
  else if (intent === "question") base = 2;

  const longBoost = tokens > 50 ? 2 : tokens > 20 ? 1 : 0;
  const multiBoost = hasMultiPart ? 1 : 0;
  return Math.min(5, base + longBoost + multiBoost);
}

function preprocessUserInput(input) {
  const cleanedText = normalizeWhitespace(input);
  const intent = detectIntent(cleanedText);
  const complexity = estimateComplexity(cleanedText, intent);

  // routeHint: "grounded" triggers Gemini-first in the router;
  // "simple" stays Groq-first; "complex" = Gemini for quality.
  let routeHint;
  if (POLICY_INTENTS.has(intent)) routeHint = "grounded";
  else if (intent === "greeting" || complexity <= 2) routeHint = "simple";
  else routeHint = "complex";

  return {
    original: String(input || ""),
    cleanedText,
    intent,
    complexity,
    routeHint,
  };
}

function looksLikeOtpHelpIntent(message) {
  const m = String(message || "").toLowerCase();
  const hasOtpSignals = (
    // English
    /\b(new|another|fresh)\s+(otp|code)\b/i.test(m) ||
    /\botp\s+card\b/i.test(m) ||
    /\b(re-?send|resend)\s+(the\s+)?(otp|code)\b/i.test(m) ||
    /\bsend\s+(a\s+)?(new\s+)?(otp|code)\b/i.test(m) ||
    /\b(re-?verify|reverify|verify\s+again)\b/i.test(m) ||
    /\b(open|show)\s+(the\s+)?(otp|verification)\b/i.test(m) ||
    /\benter\s+(a\s+)?new\s+otp\b/i.test(m) ||
    /\bwant\s+to\s+.*\b(otp|verify|verification)\b/i.test(m) ||
    /\b(give|gimme|grant|need|want|request|get|generate|issue)\s+(me\s+)?(a\s+|an\s+|the\s+)?(new\s+|another\s+|fresh\s+)?(otp|code|verification\s+code)\b/i.test(m) ||
    /\b(i|im|i'm|i\s+am)\s+(need|want|requesting|requestin)\s+.*\botp\b/i.test(m) ||
    /\botp\s+(po\s+)?(naman|please|pls|plz)\b/i.test(m) ||
    // Tagalog / Taglish
    /\b(pahingi|penge|pahing|pwede|puwede|paki|pakibigay|pakihingi|pahinge|hingi|hinge|hingiin|hinging|bigyan|bigyan\s+mo|bigyan\s+ako|ibigay|ibigay\s+mo|ibigay\s+ang)\b.*\botp\b/i.test(m) ||
    /\b(gusto|kailangan|need|hingi)\s+ko\s+(ng\s+|new\s+|bago\s+|bagong\s+)?(otp|code)\b/i.test(m) ||
    /\b(bago|bagong|panibago|panibagong|isa\s+pa|isa\s+pang)\s+(otp|code|verification)\b/i.test(m) ||
    /\botp\s+(po\s+)?(ako|naman|please|pls)\b/i.test(m) ||
    /\b(send|ipadala|padala|ipasend|i-?send)\s+(mo\s+|niyo\s+|po\s+)?(ang\s+|ng\s+|sa\s+akin\s+)?(otp|code)\b/i.test(m) ||
    /\b(verify|i-?verify|magverify|mag-?verify|paverify|pa-?verify)\b/i.test(m)
  );
  if (!hasOtpSignals) return false;
  const hasGeneralQuestionCues =
    /\b(what|where|when|how|who|why)\b/i.test(m) ||
    /\b(office\s+hours|location|announcement|lost\s*(and|&)?\s*found|services?|policy|policies|requirements|fees?)\b/i.test(m);
  const hasMultiIntentSeparators = /[,;]|\b(then|tapos|and then)\b/i.test(m);
  if (hasGeneralQuestionCues && hasMultiIntentSeparators) return false;
  return true;
}

module.exports = {
  preprocessUserInput,
  normalizeWhitespace,
  detectIntent,
  looksLikeOtpHelpIntent,
};
