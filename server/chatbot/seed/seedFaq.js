/**
 * Seeds the faq_entries table with common OSA / EAC Cavite questions.
 *
 * FAQ entries are answered at Tier 1 — instant, deterministic, no LLM call.
 * Add the most frequently-asked questions here to reduce LLM quota usage
 * and guarantee consistent, accurate answers.
 *
 * Usage:
 *   node server/chatbot/seed/seedFaq.js            # insert missing entries
 *   node server/chatbot/seed/seedFaq.js --replace  # upsert all (overwrite existing)
 */
require("dotenv").config();

const db = require("../../db");

const REPLACE_MODE = process.argv.includes("--replace");

function log(...args) {
  // eslint-disable-next-line no-console
  console.log("[seed-faq]", ...args);
}

// ─────────────────────────────────────────────────────────────────────────────
// FAQ DATA — 30+ curated Q&As for EAC Cavite OSA portal
// ─────────────────────────────────────────────────────────────────────────────
const FAQ_ENTRIES = [
  // ── OSA OFFICE HOURS & LOCATION ──────────────────────────────────────────
  {
    question: "What are the operating hours of the OSA?",
    answer: "The Office of Student Affairs (OSA) at EAC Cavite operates Monday to Friday, 8:00 AM to 5:00 PM. The office observes a lunch break from 12:00 PM to 1:00 PM and is closed on Saturdays, Sundays, and official holidays. Public contact details shown on the portal are studentaffairs.cvt@eac.edu.ph, Tel loc 115, and Gov. D. Mangubat Ave., Brgy. Burol Main, City of Dasmariñas, Cavite 4114, Philippines. For faster service, visit between 10:00 AM and 12:00 PM or after 3:00 PM to avoid peak hours.",
    category: "OSA Hours",
    keywords: ["osa hours", "office hours", "what time", "open", "close", "operating hours", "osa open", "osa schedule", "anong oras", "bukas"],
  },
  {
    question: "Is OSA open on Saturdays?",
    answer: "The OSA is not regularly open on Saturdays. OSA operations are Monday to Friday only, 8:00 AM to 5:00 PM. Saturday operations may occur for special events — check the Announcements page of this portal for any Saturday advisories.",
    category: "OSA Hours",
    keywords: ["saturday", "osa saturday", "open saturday", "sabado", "osa sabado", "weekend"],
  },
  {
    question: "What are the peak hours at the Cashier and OSA?",
    answer: "Peak transaction hours at both the Cashier and OSA are:\n- Morning rush: 8:00 AM to 10:00 AM (highest queue)\n- Afternoon rush: 1:00 PM to 3:00 PM\n\nFor the fastest service, transact between 10:00 AM and 12:00 PM or after 3:00 PM. Expect significantly longer queues during the enrollment period (June–July and November–December).",
    category: "OSA Hours",
    keywords: ["peak hours", "busy hours", "pila", "queue", "mabilis", "fast", "best time", "ano oras mabilis", "hindi masyadong tao"],
  },
  {
    question: "What is the payment cut-off time at the Cashier?",
    answer: "The Cashier's Office accepts payments Monday to Friday, 8:00 AM to 5:00 PM. The official payment cut-off time is 4:30 PM — transactions submitted after this time are recorded on the next business day. For online payments, email your proof of payment to cashier.cavite@eac.edu.ph.",
    category: "Payment",
    keywords: ["cut-off", "cut off time", "payment deadline", "cashier cut off", "last time to pay", "deadline ng bayad", "anong oras last payment"],
  },

  // ── CASHIER / PAYMENT ────────────────────────────────────────────────────
  {
    question: "Is GCash accepted at the Cashier?",
    answer: "EAC Cavite Cashier may accept digital payment channels including online banking and e-wallets. To confirm whether GCash is currently accepted and for the correct payment details, contact the Cashier's Office directly at cashier.cavite@eac.edu.ph before making a payment. Always get an official receipt as proof.",
    category: "Payment",
    keywords: ["gcash", "online payment", "digital payment", "e-wallet", "bayad online", "gcash accepted", "tumanggap gcash"],
  },
  {
    question: "Can someone else pay my tuition for me?",
    answer: "Yes, a family member or authorized representative may pay on your behalf at the Cashier's window. The representative must present your student ID number and the exact payment amount. The official receipt will be issued under your name. Confirm the proxy payment policy with the Cashier's Office as it may be updated each semester.",
    category: "Payment",
    keywords: ["proxy payment", "someone pay for me", "ibang tao magbayad", "representative payment", "pabayad", "family pay", "kaibigan magbayad"],
  },
  {
    question: "Can I pay my tuition in installments?",
    answer: "Yes, EAC Cavite allows tuition fee payment in installments. A required down payment must be made upon enrollment. Subsequent installment payments follow the schedule set by the Accounting/Cashier's Office. Partial payments are accepted but must comply with the installment schedule to avoid a hold on your account. Confirm the exact schedule and amounts with the Cashier's Office each semester.",
    category: "Payment",
    keywords: ["installment", "partial payment", "hulog", "bayad hulog", "tuition installment", "installment schedule", "pwede partial"],
  },
  {
    question: "My payment is not yet reflected. What should I do?",
    answer: "For online payments, reflection in the system typically takes 1 to 3 working days. If your payment has not appeared after 3 working days:\n1. Bring your official receipt (or screenshot/proof of payment) to the Cashier's Office.\n2. Email cashier.cavite@eac.edu.ph with your proof of payment and student ID number.\nThe Cashier's Office will manually verify and post your payment.",
    category: "Payment",
    keywords: ["payment not reflected", "di reflected", "bayad hindi lumabas", "payment verification", "wala payment", "hindi pa lumalabas", "check payment"],
  },
  {
    question: "Where can I get my official receipt?",
    answer: "Your official receipt is issued at the Cashier's window immediately upon payment. For online payments, the Cashier's Office will issue or email your receipt after verifying the transaction. If you lost your receipt, request a certified true copy at the Cashier's Office with your student ID and payment date.",
    category: "Payment",
    keywords: ["receipt", "official receipt", "OR", "resibo", "kumuha receipt", "where receipt", "get receipt", "san makuha receipt"],
  },
  {
    question: "What happens if I pay late?",
    answer: "Late tuition payments may incur a penalty or surcharge per EAC's policy. A student with an outstanding balance may be placed on hold, which can affect enrollment, clearance, or document requests. For the current late payment penalty schedule, contact the Accounting/Cashier's Office directly at cashier.cavite@eac.edu.ph.",
    category: "Payment",
    keywords: ["late payment", "penalty", "surcharge", "late bayad", "overdue payment", "bayad late", "hindi nakapagbayad sa oras"],
  },

  // ── CLEARANCE ────────────────────────────────────────────────────────────
  {
    question: "How do I get my student clearance?",
    answer: "To get your student clearance at EAC Cavite, follow this order:\n1. CASHIER — Settle all outstanding fees and balances first.\n2. LIBRARY — Return all books and pay overdue fines.\n3. LABORATORY / DEPARTMENT — Return equipment and settle obligations.\n4. DEAN'S OFFICE — Departmental clearance.\n5. REGISTRAR'S OFFICE — Academic records clearance.\n6. OSA — Final sign-off after all other offices have cleared you.\n\nNote: Clearance from OSA will NOT be approved if you have unpaid Cashier balances.",
    category: "Clearance",
    keywords: ["clearance", "student clearance", "how to get clearance", "clearance steps", "clearance process", "mag clearance", "kumuha clearance"],
  },
  {
    question: "Why is my clearance still pending?",
    answer: "Your clearance may be pending for one of these reasons:\n- Outstanding balance at the Cashier (most common)\n- Unreturned library books or unpaid library fines\n- Pending disciplinary case at OSA\n- Missing or incomplete clearance form submission\n- High processing volume during enrollment or graduation period\n\nContact the specific office that has not yet signed your clearance to resolve the hold. You may also contact OSA at studentaffairs.cvt@eac.edu.ph or Tel loc 115.",
    category: "Clearance",
    keywords: ["pending clearance", "bakit pending", "clearance not approved", "di pa naco-clear", "clearance problem", "clearance issue"],
  },
  {
    question: "Does the Cashier need to be cleared before OSA?",
    answer: "Yes. The Cashier must be cleared FIRST before OSA will approve your final clearance. The correct order is: Cashier → Library → Laboratory/Department → Dean's Office → Registrar → OSA. OSA is the final step and will not sign if any previous office has not cleared you, especially the Cashier.",
    category: "Clearance",
    keywords: ["cashier before osa", "sino muna", "order clearance", "osa or cashier first", "clearance order", "sequence clearance"],
  },

  // ── DOCUMENTS ────────────────────────────────────────────────────────────
  {
    question: "How do I get a Good Moral Certificate?",
    answer: "To request a Good Moral Certificate at EAC Cavite:\n1. Visit the OSA Office (or email studentaffairs.cvt@eac.edu.ph).\n2. Present your valid student ID and student number.\n3. Submit a request letter or fill out the OSA request form.\n4. Pay the applicable fee at the Cashier.\n5. Return after 3 to 5 working days to claim the certificate.\n\nFor rush processing, approach OSA directly and explain the urgency — it is evaluated case by case.",
    category: "Documents",
    keywords: ["good moral", "good moral certificate", "certificate good moral", "paano kumuha good moral", "good moral requirements", "good moral fee"],
  },
  {
    question: "How many days does document processing take?",
    answer: "Standard document processing times at EAC Cavite:\n- Good Moral Certificate: 3 to 5 working days\n- Certification of Enrollment: 3 to 5 working days\n- Transcript of Records (TOR): 5 to 7 working days\n- Other academic certifications: 3 to 7 working days\n\nRush processing is not guaranteed — approach the issuing office early and explain your urgency. Processing time may be longer during enrollment and graduation periods.",
    category: "Documents",
    keywords: ["processing time", "ilang days", "how many days", "days processing", "document release", "how long", "kelan makuha"],
  },
  {
    question: "Can I get school documents if I am no longer enrolled?",
    answer: "Former EAC Cavite students (alumni, students on leave of absence) may still request documents such as the Transcript of Records, Good Moral Certificate, and other certifications. Visit the issuing office (OSA for Good Moral; Registrar for academic records) with a valid government-issued ID and proof of previous enrollment. Clearance may still be required depending on the document type.",
    category: "Documents",
    keywords: ["not enrolled", "di enrolled", "former student", "graduate student", "alumni", "hindi na enrolled", "kumuha document kahit"],
  },

  // ── ID CARD ───────────────────────────────────────────────────────────────
  {
    question: "What should I do if I lost my school ID?",
    answer: "If you lost your EAC school ID:\n1. Secure an Affidavit of Loss from a notary public.\n2. Proceed to the OSA for clearance.\n3. Submit the affidavit and pay the replacement fee at the Cashier.\n4. Visit the MIS Office to have a new ID printed.\n\nWhile waiting, you may request a temporary campus pass from the OSA or guard's post. Always wear your ID while inside campus — not wearing it is a minor offense.",
    category: "ID Card",
    keywords: ["lost id", "nawala id", "replace id", "id replacement", "school id lost", "temporary pass", "id affidavit", "campus pass"],
  },
  {
    question: "What is the school ID policy?",
    answer: "EAC Cavite students are required to wear their school ID at all times while inside the campus. Key rules:\n- Loss of ID: Secure an Affidavit of Loss, process replacement through OSA and MIS.\n- Forgotten ID: Request a one-day campus pass from the guard's post or OSA.\n- ID Violation: Not wearing your ID is a minor offense under the EAC Student Manual.",
    category: "ID Card",
    keywords: ["id policy", "id rules", "wear id", "id requirement", "school id requirement", "id campus"],
  },

  // ── UNIFORM / DRESS CODE ──────────────────────────────────────────────────
  {
    question: "What is the school uniform and dress code?",
    answer: "EAC Cavite dress code:\n- Monday to Thursday: Complete Type A uniform (prescribed school uniform) with black leather shoes.\n- Friday (Washday): EAC red shirt with appropriate pants/skirt and rubber shoes.\n- Hair: No punk-style or unnatural hair colors (e.g., blue, green, red). Natural-looking highlights only.\n- Men: No earrings inside campus.\n- Prohibited: sando/sleeveless, leggings as pants, mini skirts, sandals/slippers.\n\nViolation of dress code is a minor offense.",
    category: "Uniform",
    keywords: ["uniform", "dress code", "type a", "washday", "school uniform", "what to wear", "attire", "hair", "earring", "leggings", "sando"],
  },

  // ── ATTENDANCE ────────────────────────────────────────────────────────────
  {
    question: "What is the attendance policy?",
    answer: "EAC Cavite requires a minimum of 80% attendance per subject. Key rules:\n- Students who exceed the maximum allowed absences (more than 20% of class hours) receive a UW (Unauthorized Withdrawal) grade automatically.\n- Tardiness: 15-minute grace period; arriving after 15 minutes counts as tardy. Three consecutive tardiness marks equal one absence.\n- Authorized absences (medical, official school event) may be excused with proper documentation presented to the subject teacher.",
    category: "Attendance",
    keywords: ["attendance", "absences", "absent", "tardy", "tardiness", "80 percent", "maximum absences", "uw grade", "authorized absence"],
  },

  // ── GRADING ───────────────────────────────────────────────────────────────
  {
    question: "What is the passing grade at EAC?",
    answer: "The passing grade at EAC Cavite is 3.0 (equivalent to 75%). Grade 3.0 is the minimum passing mark for all subjects. If a student receives a grade of 5.0, it means they failed the subject. An INC (Incomplete) grade must be completed within one semester; otherwise, it automatically converts to 5.0.",
    category: "Grading",
    keywords: ["passing grade", "bagsak grade", "3.0", "passing mark", "minimum grade", "inc", "incomplete", "5.0", "failed grade"],
  },
  {
    question: "What does an INC grade mean?",
    answer: "INC stands for Incomplete. It is given when a student has not completed all requirements (e.g., missed the final exam with a valid reason). The student has one semester to complete the missing requirements. If the INC is not resolved within one semester, it automatically converts to a grade of 5.0 (failure).",
    category: "Grading",
    keywords: ["inc", "incomplete", "inc grade", "what is inc", "inc meaning", "how to remove inc", "inc deadline"],
  },

  // ── SCHOLARSHIPS ─────────────────────────────────────────────────────────
  {
    question: "What scholarships are available at EAC Cavite?",
    answer: "EAC Cavite offers the following scholarship and discount programs:\n- EAC Merit Scholarship: For fresh SHS graduates with academic distinctions (50–100% TF)\n- College Academic Scholarship: For continuing students maintaining 1.50 GWA (50% TF)\n- Sibling Discount: 25–75% discount based on birth order\n- PWD Discount: 20% tuition discount\n- Government Scholarships: PVAO, PD 577, UNIFAST, CHED, SAP, SAFE, DBP-RISE\n- Non-Academic: Chorale, Dance, Theater, Brass Band, Student Publication (MAGDALO)\n\nFor the complete scholarship matrix and requirements, refer to the EAC Student Manual available through this portal.",
    category: "Scholarship",
    keywords: ["scholarships", "scholarship list", "available scholarships", "eac scholarship", "financial aid", "anong scholarships", "list ng scholarships"],
  },
  {
    question: "How do I apply for the EAC Merit Scholarship?",
    answer: "The EAC Merit Scholarship is available to fresh Senior High School graduates with academic distinctions. Steps:\n1. Inquire at the OSA or Admissions Office about the scholarship examination schedule.\n2. Pass the EAC entrance exam and submit required academic documents.\n3. Submit your scholarship application form to OSA.\n4. OSA evaluates the application based on GWA requirements.\n\nRetention requirement: Maintain a 1.50 GWA (no grade lower than 2.0). If GWA drops below the cutoff, the scholarship may be reduced or removed. Update your scholarship status during the first week of September (1st semester) or first week of February (2nd semester).",
    category: "Scholarship",
    keywords: ["merit scholarship", "eac merit", "how apply scholarship", "apply scholarship", "scholarship requirements", "merit scholarship requirements"],
  },

  // ── ENROLLMENT ────────────────────────────────────────────────────────────
  {
    question: "What are the steps for enrollment of continuing students?",
    answer: "Enrollment steps for continuing (old) EAC Cavite students:\n1. Dean's Office / Enrollment Section — Subject advising and evaluation.\n2. Enrollment Section — Printing of student load (list of enrolled subjects).\n3. Cashier / Accounting Office — Pay the required down payment.\n4. Registrar's Office — Submit enrollment form and complete documentation.\n\nEnsure your scholarship is updated BEFORE enrollment to apply any discount. Enrolling without an updated scholarship means paying the full rate for that semester.",
    category: "Enrollment",
    keywords: ["enrollment steps", "how to enroll", "old student enrollment", "continuing student", "enrollment process", "paano mag enroll"],
  },
  {
    question: "What are the requirements for freshman enrollment?",
    answer: "Freshman enrollment requirements at EAC Cavite:\na) Duly Accomplished Application Form\nb) High School Report Card or Form 138 (Original)\nc) Certificate of Good Moral Character (Original)\nd) PSA-issued Birth Certificate (photocopy)\ne) College Entrance Exam Result\nf) Physical Examination Result\ng) 4 copies of 2x2 colored ID picture\n\nFor ALS graduates, the ALS Certificate of Rating and related documents replace Form 138. Complete your admission process at the Admissions Office before proceeding to enrollment.",
    category: "Enrollment",
    keywords: ["freshman requirements", "new student requirements", "enrollment requirements", "admission requirements", "what to bring enrollment", "requirements freshman"],
  },

  // ── DISCIPLINE / OFFENSES ─────────────────────────────────────────────────
  {
    question: "What are considered major offenses at EAC?",
    answer: "Major offenses at EAC Cavite (as defined in the Student Manual) include:\nAssault, physical fighting, drug use/possession/trafficking, alcohol use on campus, smoking in non-designated areas, sexual harassment, weapons possession, cheating/plagiarism, forgery of documents, hazing, gambling, cyberbullying, unauthorized hacking, vandalism, and other acts that violate EAC policies and Philippine law.\n\nPenalties for major offenses range from suspension to permanent expulsion. For a complete list of 27 major offense categories, refer to the EAC Student Manual. Disciplinary cases are handled by the OSA.",
    category: "Discipline",
    keywords: ["major offense", "major violations", "serious offense", "suspension", "expulsion", "discipline", "what is major offense", "major offenses list"],
  },
  {
    question: "What are minor offenses at EAC?",
    answer: "Minor offenses at EAC Cavite include:\nNot wearing the school ID, wrong dress code or uniform, unnatural hair color, eating in class, loitering, using cellphone without teacher permission, public displays of affection, using the opposite-gender comfort room, and other infractions listed in the Student Manual.\n\nMinor offenses may result in verbal warning, written reprimand, or community service depending on frequency and severity. Repeated minor offenses may be escalated to a major offense.",
    category: "Discipline",
    keywords: ["minor offense", "minor violations", "violations list", "small offense", "dress code violation", "id violation", "minor infraction"],
  },

  // ── CLASS SUSPENSION ──────────────────────────────────────────────────────
  {
    question: "When are classes automatically suspended?",
    answer: "Classes at EAC Cavite are automatically suspended in the following cases:\n- Official national or local holidays declared before 8:00 AM\n- Typhoon Signal No. 3 or higher raised in the area\n- Local government unit (LGU) declaration of class suspension before 8:00 AM\n\nWhen classes are suspended, the campus remains accessible from 6:00 AM to 9:00 PM. Announcements about class suspensions are posted on the portal's Announcements page and official EAC channels.",
    category: "Academics",
    keywords: ["class suspension", "no classes", "walang pasok", "typhoon", "holiday classes", "suspended classes", "class suspended", "automatic suspension classes"],
  },

  // ── LOST AND FOUND ────────────────────────────────────────────────────────
  {
    question: "How do I claim a lost and found item?",
    answer: "To claim an item from the EAC OSA Lost and Found:\n1. Check the Lost and Found page (/lost-and-found) of this portal to find the item number (format: LF-XXXX).\n2. In this chat, type 'I want to claim [item number]' (e.g., 'I want to claim LF-1025').\n3. The system will create a claim ticket and notify OSA staff.\n4. OSA will verify ownership (ID check, item description match).\n5. Visit the OSA office during office hours to collect the item.\n\nAll physical handovers happen at the OSA office — the bot cannot hand over items directly.",
    category: "Lost and Found",
    keywords: ["claim lost found", "claim item", "how to claim", "lf item", "lost item claim", "found item", "kumuha lost item", "paano mag claim"],
  },

  // ── PORTAL NAVIGATION ─────────────────────────────────────────────────────
  {
    question: "Where can I see the latest OSA announcements?",
    answer: "You can view all official OSA announcements on the Announcements page of this portal. Navigate to the /announcements section to see the full list of advisories, events, and urgent notices published by OSA staff. You can also ask this chatbot directly — it has access to the latest posted announcements.",
    category: "Portal",
    keywords: ["announcements", "latest news", "osa news", "advisory", "notice", "events", "where announcement", "saan makita announcement", "portal announcement"],
  },
  {
    question: "What are the contact details of the OSA?",
    answer: "OSA Contact Details:\n- Email: studentaffairs.cvt@eac.edu.ph\n- Telephone Extension: Tel loc 115\n- Public Cavite Campus Address: Gov. D. Mangubat Ave., Brgy. Burol Main, City of Dasmariñas, Cavite 4114, Philippines\n- Trunkline: (+046) 416-4341 to 42\n\nFor other offices:\n- Cashier: cashier.cavite@eac.edu.ph\n- Registrar: Visit the Registrar's Office on campus\n- Admissions: admission_cavite@eac.edu.ph",
    category: "Contact",
    keywords: ["osa contact", "contact osa", "osa email", "osa phone", "osa number", "how to contact osa", "osa address", "contact details"],
  },
];

// ─────────────────────────────────────────────────────────────────────────────

async function seedFaq() {
  log(`Mode: ${REPLACE_MODE ? "upsert (replace)" : "insert missing only"}`);
  log(`Seeding ${FAQ_ENTRIES.length} FAQ entries…`);

  let inserted = 0;
  let skipped = 0;
  let updated = 0;

  for (const entry of FAQ_ENTRIES) {
    const keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
    try {
      if (REPLACE_MODE) {
        // Upsert by question text (treated as natural key)
        const existing = await db.query(
          `SELECT id FROM faq_entries WHERE lower(question) = lower($1) LIMIT 1`,
          [entry.question]
        );
        if (existing.rows.length) {
          await db.query(
            `UPDATE faq_entries SET answer=$1, category=$2, keywords=$3, is_active=true, updated_at=NOW()
             WHERE id=$4`,
            [entry.answer, entry.category, keywords, existing.rows[0].id]
          );
          updated++;
        } else {
          await db.query(
            `INSERT INTO faq_entries (question, answer, category, keywords, is_active)
             VALUES ($1, $2, $3, $4, true)`,
            [entry.question, entry.answer, entry.category, keywords]
          );
          inserted++;
        }
      } else {
        // Only insert if the question doesn't already exist
        const existing = await db.query(
          `SELECT id FROM faq_entries WHERE lower(question) = lower($1) LIMIT 1`,
          [entry.question]
        );
        if (existing.rows.length) {
          skipped++;
        } else {
          await db.query(
            `INSERT INTO faq_entries (question, answer, category, keywords, is_active)
             VALUES ($1, $2, $3, $4, true)`,
            [entry.question, entry.answer, entry.category, keywords]
          );
          inserted++;
        }
      }
    } catch (err) {
      log(`  ERROR on "${entry.question.slice(0, 50)}…": ${err.message}`);
    }
  }

  const total = await db.query(`SELECT COUNT(*) AS cnt FROM faq_entries WHERE is_active = true`);
  log(`Done — inserted: ${inserted}, updated: ${updated}, skipped: ${skipped}`);
  log(`Total active FAQ entries in database: ${total.rows[0].cnt}`);
  process.exit(0);
}

seedFaq().catch((err) => {
  log("Fatal:", err.message);
  process.exit(1);
});
