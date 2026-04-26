const { hasGeminiKeys } = require("../../services/geminiKeyPool");

/**
 * Smart provider router.
 *
 * Gemini is always the primary provider.
 * Groq is used only as an emergency fallback when Gemini is unavailable or all
 * Gemini API keys fail.
 */

function isProviderAvailable(provider) {
  if (provider === "gemini") return hasGeminiKeys();
  if (provider === "groq") return Boolean(String(process.env.GROQ_API_KEY || "").trim());
  return false;
}

const PROVIDER_CHAIN = ["gemini", "groq"];

function buildProviderChain() {
  return PROVIDER_CHAIN.filter(isProviderAvailable);
}

module.exports = {
  buildProviderChain,
};
