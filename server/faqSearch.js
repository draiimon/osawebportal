const db = require("./db");

/** Stop words that must not drive a FAQ match on their own. */
const FAQ_STOP_WORDS = new Set([
  "what",
  "how",
  "when",
  "where",
  "why",
  "who",
  "the",
  "a",
  "an",
  "and",
  "or",
  "is",
  "are",
  "can",
  "could",
  "would",
  "should",
  "need",
  "want",
  "get",
  "do",
  "did",
  "does",
  "my",
  "me",
  "for",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "if",
  "but",
  "so",
  "not",
  "also",
  "just",
  "only",
  "this",
  "that",
  "with",
  "from",
  "have",
  "has",
  "will",
  "may",
  "be",
  "been",
  "being",
  "it",
  "its",
  "was",
  "were",
  "ang",
  "ng",
  "sa",
  "ay",
  "na",
  "ba",
  "po",
  "may",
  "mga",
  "ko",
  "kung",
  "ano",
  "paano",
  "kailan",
  "bakit",
  "saan",
  "gusto",
  "pwede",
  "pwedeng",
  "din",
  "rin",
  "lang",
  "naman",
  "sana",
  "kaya",
  "yung",
  "nung",
  "pala",
  "nga",
  "talaga",
  "masyado",
  "ito",
  "yan",
  "dito",
  "ako",
  "kami",
  "sila",
  "ba",
  "ha",
  "oo",
  "opo",
  "pag",
  "para",
  "pero",
  "kasi",
  "dahil",
  "kapag",
  "kahit",
  "bago",
  "student",
  "students",
  "manual",
  "manuals",
  "handbook",
  "handbooks",
  "form",
  "forms",
]);

async function searchFaq(message) {
  try {
    const allWords = String(message || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);

    const words = allWords.filter((w) => !FAQ_STOP_WORDS.has(w));
    if (!words.length) return null;

    const wordCount = words.length;
    const requiredMatches = wordCount >= 3 ? 3 : Math.max(1, Math.min(2, wordCount));

    const result = await db.query(
      `SELECT id, question, answer, category
       FROM faq_entries
       WHERE is_active = true
         AND (
           (SELECT count(DISTINCT qw)
            FROM UNNEST($1::text[]) AS qw
            WHERE EXISTS (SELECT 1 FROM UNNEST(keywords) AS k WHERE lower(k) LIKE ('%' || qw || '%'))
           ) >= $2
           OR
           (SELECT count(*)
            FROM UNNEST($1::text[]) AS qw
            WHERE lower(question) LIKE ('%' || qw || '%')
           ) >= $2
         )
       ORDER BY
         (SELECT count(DISTINCT qw)
          FROM UNNEST($1::text[]) AS qw
          WHERE EXISTS (SELECT 1 FROM UNNEST(keywords) AS k WHERE lower(k) LIKE ('%' || qw || '%'))
         ) DESC,
         char_length(answer) DESC
       LIMIT 1`,
      [words, requiredMatches]
    );

    if (result.rows.length) {
      const faq = result.rows[0];
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

module.exports = { searchFaq, FAQ_STOP_WORDS };
