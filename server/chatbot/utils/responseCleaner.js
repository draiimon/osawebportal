/** Allowlisted hosts for leaving full URLs in assistant text (never echo dev localhost to users). */
const SAFE_HOST_PATTERNS = [/(^|\.)eac\.edu\.ph$/i];

function isSafeHost(hostname) {
  return SAFE_HOST_PATTERNS.some((pattern) => pattern.test(hostname || ""));
}

/** Strip dev URLs the model may invent (e.g. http://localhost:8787/chat). */
function stripLocalDevUrls(text) {
  return String(text || "")
    .replace(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/[\w\-./?#&=%]*)?/gi, "")
    .replace(/\(\s*\)/g, "");
}

function enforcePortalSafeLinks(text) {
  return String(text || "").replace(/https?:\/\/[^\s)]+/gi, (url) => {
    try {
      const parsed = new URL(url);
      if (isSafeHost(parsed.hostname)) return url;
      return "this portal";
    } catch (_error) {
      return "this portal";
    }
  });
}

function collapseRepeatedWordRuns(text) {
  // Collapses pathological repetitions like "paunang paunang ...".
  const src = String(text || "");
  const out = src.replace(/\b([\p{L}\p{N}_-]{2,})\b(?:\s+\1){3,}/giu, "$1 $1 $1");
  return out;
}

function cleanModelText(raw) {
  let text = String(raw || "").trim();
  if (!text) return "";

  // Remove reasoning traces even when tags are malformed/unclosed.
  text = text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
  text = text.replace(/&lt;think&gt;[\s\S]*?(?:&lt;\/think&gt;|$)/gi, "").trim();
  text = text.replace(/<\/think>/gi, "").trim();
  text = text.replace(/&lt;\/think&gt;/gi, "").trim();
  text = text.replace(/```(?:plaintext|text)?\n?/gi, "```");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = stripLocalDevUrls(text);
  text = enforcePortalSafeLinks(text);
  text = text.replace(/\bosa\.org\b/gi, "OSA portal");
  // Never expose internal prompt/tooling terms or meta-references to users.
  // Strip "based on [the/our/my] knowledge base/data/records/sources/EAC policies/provided..." phrases.
  text = text.replace(/\bbased on (?:the |our |my |eac |emilio aguinaldo college )?(?:knowledge base|knowledge|data|records?|sources?|policies?|information available|available information|provided(?: and| blocks?|[.,])?|what i(?:'ve| have) been (?:given|provided)|retrieved (?:data|information|chunks?)|current portal data(?: blocks?)?)\b[,.]?/gi, "");
  text = text.replace(/\bspecifically from (?:the )?(?:provided(?: and)?|current portal data)(?: blocks?)?\b[,.]?/gi, "");
  text = text.replace(/\bayon sa (?:aming |aking )?(?:knowledge base|knowledge|datos?|records?|sources?|impormasyon|mga patakaran)\b/gi, "");
  text = text.replace(/\baccording to (?:the |our |my |eac )?(?:knowledge base|knowledge|records?|data|sources?|available information|provided information|policies? (?:and procedures?)?)\b[,.]?/gi, "");
  text = text.replace(/\bfrom (?:the |our |my )?(?:knowledge base|knowledge|records?|data|sources?|provided(?: and)? current portal data(?: blocks?)?)\b/gi, "");
  text = text.replace(/\bin (?:the |our |my )?(?:knowledge base|knowledge|records?|data|sources?)\b/gi, "");
  text = text.replace(/\b(?:the |our |my )?knowledge base (?:says?|shows?|indicates?|states?|mentions?|contains?|has)\b/gi, "");
  text = text.replace(/\bretrieved knowledge base\b/gi, "");
  text = text.replace(/\bCURRENT PORTAL DATA\b/gi, "portal");
  text = text.replace(/\bOFFICIAL SOURCES?\b/g, "");
  text = text.replace(/\bcontext excerpts?\b/gi, "");
  text = text.replace(/\b(?:retrieval|chunks?)\b/gi, "");
  // Strip common prompt-scaffolding leaks (some models echo structured instructions or block headers).
  text = text.replace(/(?:^|\n)\s*(?:SYSTEM|CONTEXT|INSTRUCTION|GROUNDING INSTRUCTIONS?|OFFICIAL SOURCES?|RETRIEVED[\w ]*)\s*:\s*[^\n]*(?:\n|$)/gi, "\n");
  text = text.replace(/\[Retrieved[^\]]+\]/gi, "");
  // Clean up double spaces/punctuation left by removals
  text = text.replace(/\s{2,}/g, " ").replace(/ ,/g, ",").replace(/ \./g, ".").replace(/^[,. ]+/g, "").trim();
  text = text.replace(/\n{3,}/g, "\n\n");
  text = collapseRepeatedWordRuns(text);

  return text.trim();
}

/** Exact copy shown to users when FAQ/RAG cannot support a reliable answer (secure + guest chat). */
const NO_RELIABLE_KB_REPLY =
  "I couldn't find a reliable answer to your question. Please contact the OSA for further assistance.";

function ensureUserFacingFallback() {
  return NO_RELIABLE_KB_REPLY;
}

module.exports = {
  cleanModelText,
  ensureUserFacingFallback,
  NO_RELIABLE_KB_REPLY,
};
