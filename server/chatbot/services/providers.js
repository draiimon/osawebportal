const GEMINI_MODEL = String(process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
// Free-tier fallback models tried in order when the primary Gemini model returns 503.
// gemini-2.5-flash-8b: lighter variant, less demand pressure.
// gemini-2.0-flash-lite: most stable free-tier allocation.
const GEMINI_FALLBACK_MODELS = (
  process.env.GEMINI_FALLBACK_MODELS
    ? process.env.GEMINI_FALLBACK_MODELS.split(",").map((s) => s.trim()).filter(Boolean)
    : ["gemini-2.5-flash-8b", "gemini-2.0-flash-lite"]
).filter((m) => m !== GEMINI_MODEL);
const GROQ_MODEL = String(process.env.GROQ_MODEL || "qwen/qwen3-32b").trim();
const OPENROUTER_MODEL = String(process.env.OPENROUTER_MODEL || "openai/gpt-oss-20b:free").trim();
const HUGGINGFACE_MODEL = String(process.env.HUGGINGFACE_MODEL || "mistralai/Mistral-7B-Instruct-v0.2").trim();
const { runWithGeminiFailover } = require("../../services/geminiKeyPool");
/** Default raised so RAG-backed institutional answers are not cut mid-sentence (was 280). */
const MAX_OUTPUT_TOKENS = Math.min(
  8192,
  Math.max(128, Number(process.env.CHATBOT_MAX_OUTPUT_TOKENS ?? 1024))
);
const TEMPERATURE = Number(process.env.CHATBOT_TEMPERATURE || 0.3);

const GROQ_API_KEY = String(process.env.GROQ_API_KEY || "").trim();
const OPENROUTER_API_KEY = String(process.env.OPENROUTER_API_KEY || "").trim();
const HUGGINGFACE_API_KEY = String(process.env.HUGGINGFACE_API_KEY || "").trim();

function toOpenAiMessages(systemPrompt, messages) {
  const payload = [];
  if (systemPrompt) payload.push({ role: "system", content: systemPrompt });
  (messages || []).forEach((m) => {
    payload.push({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") });
  });
  return payload;
}

function toGeminiMessages(messages) {
  return (messages || []).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: String(m.content || "") }],
  }));
}

function extractOpenAiText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.map((p) => (typeof p?.text === "string" ? p.text : "")).join("").trim();
}

async function callGeminiModel(model, { systemPrompt, messages }) {
  const result = await runWithGeminiFailover(`guest-chat Gemini generation (${model})`, async (client) => {
    return client.models.generateContent({
      model,
      config: {
        ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: TEMPERATURE,
      },
      contents: toGeminiMessages(messages),
    });
  });
  return String(result?.text || "").trim();
}

async function callGemini(args) {
  const modelsToTry = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS];
  let lastError = null;
  for (const model of modelsToTry) {
    try {
      const text = await callGeminiModel(model, args);
      if (text) return text;
    } catch (err) {
      const msg = String(err?.message || "").toLowerCase();
      const isTransient = /503|502|high demand|unavailable|timeout|overloaded/i.test(msg);
      lastError = err;
      if (!isTransient) throw err;
      // eslint-disable-next-line no-console
      console.warn(`[gemini-model-fallback] ${model} transient (${msg.slice(0, 80)}) — trying next model`);
    }
  }
  throw lastError || new Error("All Gemini models unavailable");
}

async function callGroq({ systemPrompt, messages }) {
  if (!GROQ_API_KEY) throw new Error("Groq unavailable");
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: toOpenAiMessages(systemPrompt, messages),
      temperature: TEMPERATURE > 0 ? TEMPERATURE : 0.00000001,
      max_completion_tokens: MAX_OUTPUT_TOKENS,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Groq HTTP ${response.status}`);
  return extractOpenAiText(payload);
}

async function callOpenRouter({ systemPrompt, messages }) {
  if (!OPENROUTER_API_KEY) throw new Error("OpenRouter unavailable");
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: toOpenAiMessages(systemPrompt, messages),
      temperature: TEMPERATURE,
      max_tokens: MAX_OUTPUT_TOKENS,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `OpenRouter HTTP ${response.status}`);
  return extractOpenAiText(payload);
}

async function callHuggingFace({ systemPrompt, messages }) {
  if (!HUGGINGFACE_API_KEY) throw new Error("Hugging Face unavailable");
  const latest = (messages || []).slice(-8).map((m) => `${m.role}: ${m.content}`).join("\n");
  const prompt = `${systemPrompt || "You are a helpful assistant."}\n\n${latest}\nassistant:`;
  const response = await fetch(`https://api-inference.huggingface.co/models/${encodeURIComponent(HUGGINGFACE_MODEL)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HUGGINGFACE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        max_new_tokens: MAX_OUTPUT_TOKENS,
        temperature: TEMPERATURE,
        return_full_text: false,
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `HuggingFace HTTP ${response.status}`);
  if (Array.isArray(payload) && payload[0]?.generated_text) return String(payload[0].generated_text).trim();
  if (typeof payload?.generated_text === "string") return payload.generated_text.trim();
  return "";
}

async function executeProvider(provider, args) {
  if (provider === "gemini") return callGemini(args);
  if (provider === "groq") return callGroq(args);
  if (provider === "openrouter") return callOpenRouter(args);
  if (provider === "huggingface") return callHuggingFace(args);
  throw new Error(`Unknown provider: ${provider}`);
}

module.exports = {
  executeProvider,
};
