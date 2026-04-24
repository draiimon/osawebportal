/**
 * One-shot translator: translates the `content` and `bot_routing` fields
 * of every chunk in eac_manual_chunks.json from Filipino/Taglish → English,
 * preserving the exact structure, lists, numbering, and policy meaning.
 *
 * Usage:  node server/chatbot/seed/translateChunks.js
 */
require("dotenv").config();

const fs = require("fs");
const path = require("path");

const DATA_FILE = path.resolve(__dirname, "../data/eac_manual_chunks.json");
const BACKUP_FILE = path.resolve(__dirname, "../data/eac_manual_chunks.tl.json");

const GROQ_API_KEY = String(process.env.GROQ_API_KEY || "").trim();
const GROQ_MODEL = String(process.env.GROQ_TRANSLATE_MODEL || "llama-3.3-70b-versatile").trim();
const GROQ_BASE_URL = String(process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1")
  .trim()
  .replace(/\/+$/, "");

if (!GROQ_API_KEY) {
  console.error("GROQ_API_KEY not set.");
  process.exit(1);
}

const SYSTEM = `You are a precise policy translator for a Philippine university student portal.
Translate the user's text from Filipino/Taglish into clear, formal English.

HARD RULES:
- Preserve ALL formatting exactly: line breaks, numbered lists, letters (a, b, c), bullet points, ALL CAPS headers, dashes, colons.
- Do NOT summarize, paraphrase loosely, or drop details. Every policy clause must remain.
- Keep proper nouns unchanged: EAC, OSA, Dasmariñas, CALABARZON, Emilio Aguinaldo College, MAGDALO, BEED, BSED, NSTP, GWA, PE, SHS, ALS, PSA, CHED, PVAO, PD 577, TES-UNIFAST, DBP-RISE, PLDT, BFP, BJMP, BI, PNP, EFACE, PWD, SAP, SAFE, R.A. numbers (e.g., R.A. 9211), Brightspace, Google Meet, CLAYGO, IATF.
- Keep all office names: Registrar's Office, Admissions Office, Cashier's Office, OSA, MIS Office, OLTD, School Clinic, Dean's Office, Guidance Office, VPAA.
- Keep currency as PHP. Keep account numbers, emails, phone numbers, URLs verbatim.
- Keep section labels like "REQUIREMENTS FOR...", "PROCESS:", "RETENTION REQUIREMENTS:" in English. The Filipino label "PARA SA..." becomes "FOR...".
- Return ONLY the translated text. No preamble, no commentary, no quotes around the output.`;

function parseRetryAfter(msg) {
  // Groq returns e.g. "Please try again in 8.79s."
  const m = /try again in\s+([\d.]+)s/i.exec(String(msg || ""));
  if (m) return Math.ceil(parseFloat(m[1]) * 1000) + 500;
  return 20000;
}

async function translateText(text, attempt = 1) {
  const input = String(text || "").trim();
  if (!input) return "";
  const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: input },
      ],
      temperature: 0.1,
      max_completion_tokens: 4096,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 429 && attempt <= 5) {
    const waitMs = parseRetryAfter(payload?.error?.message);
    console.log(`    (429) waiting ${(waitMs / 1000).toFixed(1)}s and retrying…`);
    await sleep(waitMs);
    return translateText(text, attempt + 1);
  }
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Groq HTTP ${response.status}`);
  }
  const out = String(payload?.choices?.[0]?.message?.content || "").trim();
  if (!out) throw new Error("Groq returned empty translation.");
  return out;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  const chunks = JSON.parse(raw);
  if (!Array.isArray(chunks)) throw new Error("Bad JSON shape.");

  // Back up the Tagalog source once.
  if (!fs.existsSync(BACKUP_FILE)) {
    fs.writeFileSync(BACKUP_FILE, raw, "utf8");
    console.log(`[translate] backed up original → ${BACKUP_FILE}`);
  }

  console.log(`[translate] translating ${chunks.length} chunks with Groq (${GROQ_MODEL})…`);

  // Heuristic to skip chunks already translated (on re-run).
  function looksEnglish(s) {
    const t = String(s || "").toLowerCase();
    if (!t) return true;
    const tagalogHints = /\b(kapag|ang|ng|ay|mga|para sa|hindi|pag|pwede|dapat|ibibigay|bibigyan|kailangan|sino|saan|paano|nasuspende|naaayon|alinsunod|lahat ng|bawat|kahit)\b/;
    return !tagalogHints.test(t);
  }

  const out = [];
  let translated = 0;
  let skipped = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (looksEnglish(chunk.content) && looksEnglish(chunk.bot_routing)) {
      out.push(chunk);
      skipped += 1;
      console.log(`  [${i + 1}/${chunks.length}] ${chunk.chunk_id} — already English, skipped`);
      continue;
    }
    try {
      const content = looksEnglish(chunk.content) ? chunk.content : await translateText(chunk.content);
      await sleep(600);
      const routing = chunk.bot_routing && !looksEnglish(chunk.bot_routing)
        ? await translateText(chunk.bot_routing)
        : (chunk.bot_routing || "");
      await sleep(600);
      out.push({ ...chunk, content, bot_routing: routing });
      translated += 1;
      console.log(`  [${i + 1}/${chunks.length}] ${chunk.chunk_id} ✓`);
      // Persist progress incrementally — if we get interrupted mid-batch,
      // next run resumes from where we left off.
      fs.writeFileSync(DATA_FILE, JSON.stringify([...out, ...chunks.slice(i + 1)], null, 2) + "\n", "utf8");
    } catch (err) {
      console.error(`  [${i + 1}/${chunks.length}] ${chunk.chunk_id} FAILED:`, err.message);
      out.push(chunk);
    }
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`[translate] done — translated ${translated}, skipped ${skipped}, wrote → ${DATA_FILE}`);
}

main().catch(err => {
  console.error("[translate] fatal:", err);
  process.exit(1);
});
