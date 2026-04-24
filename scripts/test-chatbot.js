require("dotenv").config();
const { runChatPipeline } = require("../server/chatbot/services/chatPipeline");

const TESTS = [
  // ── TIER 2: Policy & Knowledge (RAG + AI) ─────────────────────────
  { id: 1, group: "Policy/RAG", label: "Freshman admission requirements",
    q: "What are the requirements to apply as a freshman at EAC Cavite?" },
  { id: 2, group: "Policy/RAG", label: "Failing grade → expulsion?",
    q: "What happens if I get a failing grade twice? Am I expelled?" },
  { id: 3, group: "Policy/RAG", label: "Absence limit (Tagalog)",
    q: "Ilang absences lang pwede bago ma-drop ang subject ko?" },
  { id: 4, group: "Policy/RAG", label: "Installment payment rules",
    q: "How does the installment payment work and what happens if I miss a payment?" },
  { id: 5, group: "Policy/RAG", label: "Scholarship requirements",
    q: "I'm a scholar — what are the requirements I need to submit to keep my scholarship?" },
  { id: 6, group: "Policy/RAG", label: "Add/drop subjects (Taglish)",
    q: "Pano mag-add or mag-drop ng subject after enrollment? May deadline ba?" },
  { id: 7, group: "Policy/RAG", label: "Major vs minor offense",
    q: "What's the difference between a major offense and a minor offense? Can a major offense lead to expulsion?" },
  { id: 8, group: "Policy/RAG", label: "Dress code during exams",
    q: "Anong dress code ang required during exams? What if I come in civilian clothes?" },
  { id: 9, group: "Policy/RAG", label: "INC grade removal",
    q: "My professor gave me a grade of INC. How does that work and what do I need to do to remove it?" },
  { id: 10, group: "Policy/RAG", label: "Cross-enrollment",
    q: "I want to cross-enroll to another school. What are the requirements and is it allowed at EAC?" },
  { id: 11, group: "Policy/RAG", label: "Maximum residency rule",
    q: "Ano ang maximum residency rule? Pano kung na-exceed ko na?" },
  { id: 12, group: "Policy/RAG", label: "Clearance blocked by OSA (cashier paid)",
    q: "My clearance is blocked by OSA but I already paid. What do I do? Cashier says it's not their problem." },

  // ── Live Portal Data ───────────────────────────────────────────────
  { id: 13, group: "Live Data", label: "Latest announcements",
    q: "What are the latest OSA announcements?" },
  { id: 14, group: "Live Data", label: "Urgent announcements (Tagalog)",
    q: "May urgent announcements ba ngayon?" },
  { id: 15, group: "Live Data", label: "Unclaimed lost items",
    q: "What lost items are currently unclaimed in OSA?" },
  { id: 16, group: "Live Data", label: "Lost wallet query",
    q: "Is there a lost wallet in the Lost and Found?" },

  // ── Escalation / Tier 3 ───────────────────────────────────────────
  { id: 17, group: "Escalation", label: "Disciplinary appeal",
    q: "I have a disciplinary case filed against me and I need to appeal. Can you help me?" },
  { id: 18, group: "Escalation", label: "/chat staff slash command",
    q: "/chat staff — I need to talk to someone about my academic probation." },
  { id: 19, group: "Escalation", label: "Appointment booking flow",
    q: "I want to schedule a meeting with OSA about my scholarship appeal." },
  { id: 20, group: "Escalation", label: "LF claim flow",
    q: "I want to claim LF-1025. That's my umbrella I lost last week." },

  // ── Guardrails ────────────────────────────────────────────────────
  { id: 21, group: "Guardrail", label: "Dean query (not in KB)",
    q: "Who is the dean of the College of Engineering at EAC?" },
  { id: 22, group: "Guardrail", label: "Tuition fee (not in KB)",
    q: "What is the tuition fee for BSIT this semester?" },

  // ── Taglish / Complex ─────────────────────────────────────────────
  { id: 23, group: "Taglish", label: "Clearance steps (Tagalog)",
    q: "Paano ko malalaman kung na-clear na ako for this semester? Step by step pls" },
  { id: 24, group: "Taglish", label: "Clearance blocked — OSA vs cashier (Taglish)",
    q: "Yung clearance ko blocked sa OSA eh, nagbayad na ko sa cashier, anong gagawin ko?" },
  { id: 25, group: "Taglish", label: "Long bagsakan message",
    q: "Hi, I'm a 3rd year BSIT student and I have a problem. My clearance is being held by OSA because of a violation last semester that I already settled. I have the receipt but it's not reflecting in the system. I tried going to OSA personally but they said to file through the portal. My student number is 2021-12345 and I need this resolved ASAP because enrollment starts next week." },

  // ── Identity / System ─────────────────────────────────────────────
  { id: 26, group: "Identity", label: "Who are you",
    q: "Who are you? What can you do?" },
  { id: 27, group: "Identity", label: "How does the chatbot work",
    q: "How does this chatbot work exactly?" },
];

const PASS = "✅";
const FAIL = "❌";
const WARN = "⚠️ ";

function grade(test, result) {
  const r = String(result.response || result.answer || "").trim();
  const provider = String(result.provider || "");
  const escalate = !!result.escalate;
  const low = r.toLowerCase();

  // Global fail signals
  const isEmptyReply = r.length < 10;
  const isHardFallback = /no relevant information found|couldn't find a reliable answer/i.test(r);
  const isHallucination = /\bhttp:\/\/localhost\b|\b127\.0\.0\.1\b/i.test(r);

  let score = 0;
  let status = FAIL;
  let note = "";

  switch (test.group) {
    case "Policy/RAG": {
      if (isEmptyReply || isHallucination) { note = "empty/hallucination"; break; }
      if (isHardFallback) { note = "no-kb fallback — RAG missed"; break; }
      // Check it has some substance (>80 chars) and uses AI phrasing
      if (r.length > 80) { score = 2; status = PASS; note = `${r.length} chars, provider=${provider}`; }
      else { score = 1; status = WARN; note = `short reply (${r.length} chars)`; }
      break;
    }
    case "Live Data": {
      if (isEmptyReply) { note = "empty"; break; }
      // Either has live data content OR says no announcements/items available
      if (/announcement|lost.*found|lf-|service|no.*announc|no.*item|no.*found/i.test(low)) {
        score = 2; status = PASS; note = `live data answered, provider=${provider}`;
      } else if (isHardFallback) {
        score = 1; status = WARN; note = "fallback — live context missing from DB?";
      } else {
        score = 1; status = WARN; note = `uncertain reply, provider=${provider}`;
      }
      break;
    }
    case "Escalation": {
      if (isEmptyReply) { note = "empty"; break; }
      // Should either escalate flag OR mention staff/ticket/case
      const hasEscSignal = escalate ||
        /staff|ticket|case id|escalat|human|appointment|osa staff|concern.*forward|forward.*concern/i.test(low);
      if (hasEscSignal) { score = 2; status = PASS; note = `escalate=${escalate}, provider=${provider}`; }
      else { score = 1; status = WARN; note = `no escalation signal detected`; }
      break;
    }
    case "Guardrail": {
      if (isEmptyReply) { note = "empty"; break; }
      // MUST say no info OR suggest escalation — must NOT invent a dean name or fee
      const inventedFee = /\b₱\s*\d|\bphp\s*\d|\d{3,},\d{3}|\d{4,}\s*(per|pesos)/i.test(r);
      const inventedName = test.id === 21 && /\b(dr\.|prof\.|dean)\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/.test(r) && !isHardFallback;
      if (inventedFee || inventedName) { score = 0; status = FAIL; note = "HALLUCINATED specific data!"; break; }
      if (isHardFallback || /not.*in.*knowledge|cannot confirm|contact osa|verify with osa/i.test(low)) {
        score = 2; status = PASS; note = "correctly refused to invent";
      } else {
        score = 1; status = WARN; note = "vague — didn't clearly refuse or escalate";
      }
      break;
    }
    case "Taglish": {
      if (isEmptyReply || isHallucination) { note = "empty/hallucination"; break; }
      if (isHardFallback && test.id !== 25) { note = "no-kb fallback"; break; }
      // For #25 (bagsakan), should either give info OR escalate
      if (test.id === 25) {
        const goodSignal = escalate || /clearance|violation|staff|ticket|osa|receipt/i.test(low);
        if (goodSignal) { score = 2; status = PASS; note = `handled complex message, provider=${provider}`; }
        else { score = 1; status = WARN; note = "no useful signal in reply"; }
      } else {
        if (r.length > 60) { score = 2; status = PASS; note = `${r.length} chars, provider=${provider}`; }
        else { score = 1; status = WARN; note = `short (${r.length} chars)`; }
      }
      break;
    }
    case "Identity": {
      if (isEmptyReply) { note = "empty"; break; }
      if (/osa assistant|emilio aguinaldo|eac|chatbot|help.*osa|osa.*help/i.test(low)) {
        score = 2; status = PASS; note = "correctly identified itself";
      } else {
        score = 1; status = WARN; note = "weak identity response";
      }
      break;
    }
  }

  return { score, maxScore: 2, status, note, response: r.slice(0, 160).replace(/\n/g, " ") };
}

async function run() {
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  OSA CHATBOT TEST SUITE — 27 queries, no rate limit");
  console.log("═══════════════════════════════════════════════════════════\n");

  const results = [];
  const convId = `test-${Date.now()}`;

  for (const test of TESTS) {
    process.stdout.write(`[${String(test.id).padStart(2, "0")}] ${test.label.padEnd(42)} `);
    const t0 = Date.now();
    let result;
    try {
      result = await runChatPipeline({ message: test.q, conversationId: convId + `-${test.id}`, userId: "tester" });
    } catch (err) {
      result = { response: "", provider: "ERROR: " + err.message };
    }
    const elapsed = Date.now() - t0;
    const graded = grade(test, result);
    results.push({ test, graded, elapsed });
    console.log(`${graded.status} ${graded.score}/2  ${elapsed}ms  ${graded.note}`);
    if (graded.score < 2) {
      console.log(`       REPLY: "${graded.response}"`);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────
  const total = results.reduce((s, r) => s + r.graded.score, 0);
  const max = results.length * 2;
  const pct = Math.round((total / max) * 100);

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  RESULTS BY GROUP");
  console.log("───────────────────────────────────────────────────────────");

  const groups = [...new Set(TESTS.map(t => t.group))];
  for (const g of groups) {
    const gResults = results.filter(r => r.test.group === g);
    const gTotal = gResults.reduce((s, r) => s + r.graded.score, 0);
    const gMax = gResults.length * 2;
    const gPct = Math.round((gTotal / gMax) * 100);
    const bar = "█".repeat(Math.round(gPct / 10)) + "░".repeat(10 - Math.round(gPct / 10));
    console.log(`  ${g.padEnd(14)} ${bar}  ${gTotal}/${gMax}  (${gPct}%)`);
  }

  console.log("───────────────────────────────────────────────────────────");
  console.log(`  OVERALL SCORE   ${total}/${max}  →  ${pct}/100`);
  console.log("═══════════════════════════════════════════════════════════\n");

  if (pct >= 86) console.log(`  🎯 TARGET MET (≥86) — score: ${pct}`);
  else console.log(`  ⚠️  Below target (${pct} < 86)`);
  console.log();
}

run().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
