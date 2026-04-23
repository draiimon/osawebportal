function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function detectIntent(text) {
  const lower = text.toLowerCase();
  if (!lower) return "empty";
  if (/^(hi|hello|hey|good (morning|afternoon|evening)|yo)\b/.test(lower)) return "greeting";
  if (/\b(help|assist|support|guide)\b/.test(lower)) return "support";
  if (/\b(code|debug|bug|function|api|sql|javascript|node|python|error|stack)\b/.test(lower)) return "coding";
  if (/\b(what|how|why|when|where|can|could|should)\b/.test(lower)) return "question";
  return "general";
}

function estimateComplexity(text, intent) {
  const tokens = text.split(" ").filter(Boolean).length;
  const hasMultiPart = /[?].*[?]|(?:\b(and|also|then|plus)\b.*){2,}/i.test(text);
  const codingBoost = intent === "coding" ? 2 : 0;
  const longBoost = tokens > 50 ? 2 : tokens > 20 ? 1 : 0;
  const score = Math.min(5, 1 + codingBoost + longBoost + (hasMultiPart ? 1 : 0));
  return score;
}

function preprocessUserInput(input) {
  const cleanedText = normalizeWhitespace(input);
  const intent = detectIntent(cleanedText);
  const complexity = estimateComplexity(cleanedText, intent);
  const routeHint = (intent === "greeting" || complexity <= 2) ? "simple" : "complex";

  return {
    original: String(input || ""),
    cleanedText,
    intent,
    complexity,
    routeHint,
  };
}

module.exports = {
  preprocessUserInput,
  normalizeWhitespace,
};
