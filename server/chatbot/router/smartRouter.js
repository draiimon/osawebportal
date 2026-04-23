function isProviderAvailable(provider) {
  if (provider === "gemini") return Boolean(String(process.env.GEMINI_API_KEY || "").trim());
  if (provider === "groq") return Boolean(String(process.env.GROQ_API_KEY || "").trim());
  if (provider === "openrouter") return Boolean(String(process.env.OPENROUTER_API_KEY || "").trim());
  if (provider === "huggingface") return Boolean(String(process.env.HUGGINGFACE_API_KEY || "").trim());
  return false;
}

function unique(values) {
  return [...new Set(values)];
}

function buildProviderChain(meta) {
  const intent = String(meta.intent || "");
  const complexity = Number(meta.complexity || 1);

  let ordered;
  if (intent === "greeting" || complexity <= 2) {
    ordered = ["groq", "gemini", "openrouter", "huggingface"];
  } else if (intent === "coding" || complexity >= 4) {
    ordered = ["gemini", "groq", "openrouter", "huggingface"];
  } else {
    ordered = ["gemini", "groq", "openrouter", "huggingface"];
  }

  return unique(ordered).filter(isProviderAvailable);
}

module.exports = {
  buildProviderChain,
};
