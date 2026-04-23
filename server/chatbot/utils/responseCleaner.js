const SAFE_HOST_PATTERNS = [
  /(^|\.)eac\.edu\.ph$/i,
  /^localhost$/i,
  /^127\.0\.0\.1$/i,
];

function isSafeHost(hostname) {
  return SAFE_HOST_PATTERNS.some((pattern) => pattern.test(hostname || ""));
}

function enforcePortalSafeLinks(text) {
  return String(text || "").replace(/https?:\/\/[^\s)]+/gi, (url) => {
    try {
      const parsed = new URL(url);
      if (isSafeHost(parsed.hostname)) return url;
      return "/chat";
    } catch (_error) {
      return "/chat";
    }
  });
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
  text = enforcePortalSafeLinks(text);
  text = text.replace(/\bosa\.org\b/gi, "OSA portal");

  return text;
}

function ensureUserFacingFallback() {
  return "I can still help. Please retry your request in one sentence, and I will respond right away.";
}

module.exports = {
  cleanModelText,
  ensureUserFacingFallback,
};
