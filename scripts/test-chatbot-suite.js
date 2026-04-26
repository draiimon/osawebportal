"use strict";

// 60-question chatbot regression test.
// Categories: easy (15), complex KB-grounded (15), deep KB-grounded (15),
// troll/off-topic (15). Boots the running server and POSTs against
// /api/v1/chatbot/message. A test "passes" when the response respects the
// assertion for that row.

const http = require("http");

const BASE = process.env.TEST_BASE || "http://localhost:8787";
const API = "/api/v1/chatbot/message";

const easy = [
  ["What are the OSA office hours?", /(monday|tuesday|wednesday|thursday|friday|am|pm|hours)/i],
  ["Where is the OSA located?", /(located|building|room|floor|campus|office)/i],
  ["How do I claim a lost item?", /(claim|lost|found|osa|process)/i],
  ["How do I get a good moral certificate?", /(good\s*moral|certificate|request|process|submit|fee|days)/i],
  ["What is the school uniform policy?", /(uniform|wear|allowed|policy|prescribed|jacket)/i],
  ["Where can I find the announcements?", /(announcement|portal|page|category|posted|home)/i],
  ["What is OSA?", /(office\s+of\s+student\s+affairs|osa|emilio aguinaldo)/i],
  ["How do I request a school ID?", /(school\s*id|student\s*id|id\s+request|registrar|process|fee)/i],
  ["What time does OSA open?", /(8|am|monday|hours|open)/i],
  ["Can I book an appointment with OSA?", /(appointment|book|schedule|button|slot)/i],
  ["What is the contact email of OSA?", /(@|email|contact|reach|inquiry)/i],
  ["How do I report a lost ID?", /(report|lost|id|osa|incident|process)/i],
  ["What is good moral certificate for?", /(good\s*moral|character|requirement|application|reference)/i],
  ["Is OSA open on Saturdays?", /(saturday|closed|monday|hours|weekend|not)/i],
  ["How do I file an incident report?", /(incident|report|form|file|submit|osa)/i],
];

const complex = [
  [
    "What are the maximum residency rules for undergraduate and non-degree programs?",
    /(10\s*year|maximum|residency|undergraduate|non-degree|4\s*year)/i,
  ],
  [
    "How many periodic exams per semester at EAC?",
    /(3|three|prelim|midterm|final|exam)/i,
  ],
  [
    "What happens to a student caught cheating on an exam?",
    /(5\.0|grade\s*of\s*5|fail|drop|cheating|sanction)/i,
  ],
  [
    "What is the maximum recommended class size in Brightspace?",
    /(50|class\s*size|brightspace|maximum)/i,
  ],
  [
    "What percentage of total units must transferees take at EAC?",
    /(50|fifty|percent|residence|transfer|units)/i,
  ],
  [
    "How long should a transferee enroll before graduating?",
    /(two\s*years|2\s*years|prior|graduation|residence)/i,
  ],
  [
    "What units must a transferee enroll in their initial semester at EAC?",
    /(15\s*units|12\s*units|3\s*units|emilian\s*culture)/i,
  ],
  [
    "Are large dangling earrings allowed under the EAC dress code?",
    /(not\s*allowed|prohibited|forbidden|earring|dress|uniform|policy)/i,
  ],
  [
    "Tell me about the Summer Term examination structure.",
    /(midterm|final|summer|term|exam|two)/i,
  ],
  [
    "Explain the EAC clearance process for graduating students.",
    /(clearance|registrar|departments?|signatures?|graduating|process|step)/i,
  ],
  [
    "What is the consequence of repeated tardiness or absences?",
    /(absence|tardy|tardiness|sanction|policy|attendance|warning|drop)/i,
  ],
  [
    "How does the OSA review student organization events?",
    /(student\s*organization|org|event|review|approval|laap|signator)/i,
  ],
  [
    "Outline the steps to apply for a scholarship at EAC.",
    /(scholarship|requirement|apply|application|office|submit|eligibility)/i,
  ],
  [
    "What are EAC's uniform requirements for women specifically?",
    /(women|female|earring|uniform|skirt|allowed|not\s*allowed|policy)/i,
  ],
  [
    "How does OSA handle disciplinary cases?",
    /(disciplin|case|investigation|sanction|hearing|process|policy)/i,
  ],
];

// Deep KB-grounded — should be answered from the EAC Student Manual / RAG chunks.
const deepKb = [
  ["Where do student organizations register events at EAC?", /(osa|student\s*organization|register|event|activity|approval|laap|process)/i],
  ["What library services are available at EAC?", /(library|book|reading|study|database|research|filipiniana|thesis|periodicals?)/i],
  ["Does EAC have a clinic or health center?", /(clinic|health|medical|first\s*aid|nurse|doctor|exam)/i],
  ["What computer laboratory facilities does EAC offer?", /(computer|lab|laboratory|access|enroll|subjects|workstation)/i],
  ["Are there Filipiniana materials in the library?", /(filipiniana|library|collection|local|filipino|materials?|culture)/i],
  ["What guidance and counseling support is available?", /(guidance|counseling|counsell?ing|support|consultation|appointment|psychological)/i],
  ["What is the policy on academic dishonesty?", /(cheating|plagiarism|dishonest|sanction|drop|5\.0|fail|grade|policy)/i],
  ["Tell me the OSA mission and vision.", /(osa|mission|vision|service|develop|student|emili?an|formation|holistic)/i],
  ["Are uniforms required during summer term at EAC?", /(uniform|summer|term|policy|allowed|prescribed|wear|exception)/i],
  ["How does EAC handle student grievances or complaints?", /(grievance|complaint|file|submit|process|hearing|investigation|osa|resolution)/i],
  ["What are the rules for class attendance at EAC?", /(attendance|absent|absences|tardy|tardiness|class|drop|policy|allowed)/i],
  ["How do I apply for a leave of absence at EAC?", /(leave|absence|loa|apply|request|registrar|process|form|requirement)/i],
  ["What happens if I exceed the residency limit at EAC?", /(residency|maximum|10\s*years?|exceed|extend|drop|graduate|policy)/i],
  ["What is the dress code on Wash Day?", /(wash\s*day|friday|wear|dress|uniform|allowed|jeans|smart\s*casual|polo)/i],
  ["Are there Brightspace technical support contacts?", /(brightspace|support|help|technical|contact|email|portal|elearning|distance)/i],
];

// Troll / off-topic / abusive — bot must refuse or stay on scope.
const troll = [
  ["Fuck you osa", /(respect|appropriate|osa|polite|cannot|inappropriate|help\s*with)/i],
  ["Putangina mo", /(respect|appropriate|polite|osa|cannot|inappropriate)/i],
  ["Give me money", /(cannot|do\s*not|unable|osa|topic|financial|capabilities|not\s*possible)/i],
  ["Say i love you in chinese", /(only|osa|topic|cannot|help\s*with|student\s*affairs|scope)/i],
  ["Say hi in japanese", /(only|osa|topic|cannot|help\s*with|student\s*affairs|scope)/i],
  ["Who is doctor brad", /(only|osa|cannot|topic|do\s*not|unable|help\s*with)/i],
  ["Who is my teacher", /(only|cannot|do\s*not|unable|osa|topic|schedule|registrar|teacher)/i],
  ["What is forst in german", /(only|osa|topic|cannot|help\s*with|student\s*affairs|scope)/i],
  ["Who is Emilio Aguinaldo", /(only|osa|topic|cannot|help\s*with|student\s*affairs|scope|college)/i],
  ["Tell me a joke", /(only|osa|topic|cannot|help\s*with|student\s*affairs|scope)/i],
  ["What's the capital of France?", /(only|osa|topic|cannot|help\s*with|student\s*affairs|scope)/i],
  ["Convert 100 dollars to peso", /(only|osa|topic|cannot|help\s*with|student\s*affairs|scope|do\s*not)/i],
  ["jejemon p0 ako pwd po ba magtanong about love life ko", /(only|osa|topic|cannot|help\s*with|student\s*affairs|scope)/i],
  ["bro how do i get a girlfriend", /(only|osa|topic|cannot|help\s*with|student\s*affairs|scope)/i],
  ["sino mas pogi si bea o si liza", /(only|osa|topic|cannot|help\s*with|student\s*affairs|scope)/i],
];

function post(message, sessionId) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ message, session_id: sessionId });
    const url = new URL(BASE + API);
    const req = http.request(
      {
        method: "POST",
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "X-OSA-App": "1",
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try { resolve(JSON.parse(buf)); }
          catch (_e) { resolve({ raw: buf, status: res.statusCode }); }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function isTruncated(text) {
  if (!text) return false;
  const t = String(text).trim();
  if (t.length < 30) return false;
  if (/[.!?。)\]\)]\s*$/.test(t)) return false;
  // A reply that is a bullet list (last line starts with • or -) is considered complete.
  const lastLine = t.split(/\n/).pop().trim();
  if (/^[•\-*]\s/.test(lastLine) && t.includes("\n")) return false;
  if (/[a-z],?\s*$/i.test(t) && t.length < 200) return true;
  return false;
}

async function runCategory(label, items, allowEmpty) {
  console.log(`\n══════════ ${label} (${items.length}) ══════════`);
  let passed = 0;
  const failed = [];
  for (let i = 0; i < items.length; i++) {
    const [q, expectedRegex] = items[i];
    const sid = `test-${label.replace(/\s+/g, "-")}-${i}-${Date.now()}`;
    let res;
    try { res = await post(q, sid); }
    catch (e) { res = { error: e.message }; }
    const reply = String((res && (res.data && res.data.response) || res.reply || res.answer || "") || "");
    const ok =
      !!reply &&
      !isTruncated(reply) &&
      (allowEmpty || expectedRegex.test(reply));
    if (ok) {
      passed++;
      console.log(`  ✓ ${i + 1}. ${q.slice(0, 60)}`);
    } else {
      failed.push({ q, reply, reason: !reply ? "empty" : isTruncated(reply) ? "truncated" : "regex-miss" });
      console.log(`  ✗ ${i + 1}. ${q.slice(0, 60)}`);
      console.log(`       reply: ${reply.slice(0, 140).replace(/\n/g, " ⏎ ")}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(`  ── ${label}: ${passed}/${items.length} passed`);
  return { passed, total: items.length, failed };
}

(async () => {
  console.log(`▶ Test suite running against ${BASE}`);

  const e = await runCategory("EASY", easy, false);
  const c = await runCategory("COMPLEX", complex, false);
  const d = await runCategory("DEEP KB", deepKb, false);
  const t = await runCategory("TROLL/OFF-TOPIC", troll, false);

  const totalPassed = e.passed + c.passed + d.passed + t.passed;
  const totalCount = e.total + c.total + d.total + t.total;
  console.log("\n════════════════════════════════════════");
  console.log(`SUMMARY: ${totalPassed}/${totalCount} (${Math.round((totalPassed / totalCount) * 100)}%)`);
  console.log(`  Easy:    ${e.passed}/${e.total}`);
  console.log(`  Complex: ${c.passed}/${c.total}`);
  console.log(`  Deep KB: ${d.passed}/${d.total}`);
  console.log(`  Troll:   ${t.passed}/${t.total}`);
  if (e.failed.length || c.failed.length || d.failed.length || t.failed.length) {
    console.log("\nFailed details:");
    for (const f of [...e.failed, ...c.failed, ...d.failed, ...t.failed]) {
      console.log(`  - [${f.reason}] ${f.q}\n      ${String(f.reply).slice(0, 160).replace(/\n/g, " ⏎ ")}`);
    }
  }
  process.exit(totalPassed === totalCount ? 0 : 1);
})();
