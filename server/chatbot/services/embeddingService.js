const axios = require("axios");
const { GoogleGenAI } = require("@google/genai");

const EMBED_MODEL = String(process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001").trim();
const EMBED_DIMENSIONS = Math.max(64, Number(process.env.GEMINI_EMBED_DIMENSIONS || 768));
const EMBED_PROVIDER = String(process.env.EMBED_PROVIDER || "auto").trim().toLowerCase(); // auto | gemini | openai
const OPENAI_EMBED_MODEL = String(process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small").trim();

function maskKey(key) {
  const text = String(key || "").trim();
  if (!text) return "(none)";
  if (text.length <= 10) return `${text.slice(0, 2)}***${text.slice(-2)}`;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function buildEmbedPool() {
  const entries = [];
  const k10 = String(process.env.GOOGLE_API_KEY_10 || "").trim();
  const k11 = String(process.env.GOOGLE_API_KEY_11 || "").trim();
  if (k10) entries.push({ name: "GOOGLE_API_KEY_10", key: k10, cooldownUntil: 0, client: null });
  if (k11) entries.push({ name: "GOOGLE_API_KEY_11", key: k11, cooldownUntil: 0, client: null });
  if (entries.length) {
    console.log(`[embed-pool] loaded ${entries.length} embed key(s): ${entries.map(e => maskKey(e.key)).join(", ")}`);
  } else {
    console.warn("[embed-pool] no embed keys found (GOOGLE_API_KEY_10 / GOOGLE_API_KEY_11).");
  }
  return entries;
}

const embedPool = buildEmbedPool();

function getEmbedClient(entry) {
  if (!entry.client) entry.client = new GoogleGenAI({ apiKey: entry.key });
  return entry.client;
}

function isRateLimit(error) {
  const status = Number(error?.status || error?.response?.status || 0);
  const msg = String(error?.message || "").toLowerCase();
  return status === 429 || /resource_exhausted|rate.?limit|quota|too many requests|usage limit/i.test(msg);
}

function isAuthError(error) {
  const status = Number(error?.status || error?.response?.status || 0);
  const msg = String(error?.message || "").toLowerCase();
  return (
    status === 401 ||
    status === 403 ||
    /invalid api key|api key not valid|permission.denied|unauthorized|forbidden|leaked/i.test(msg)
  );
}

const RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000;

function isUnsupportedLocationError(error) {
  const msg = String(error?.message || error?.error?.message || error || "").toLowerCase();
  const nested = error?.error;
  const nestedMsg = nested && typeof nested === "object" ? String(nested.message || "").toLowerCase() : "";
  const combined = `${msg} ${nestedMsg}`;
  const status = String(error?.status || nested?.status || error?.error?.status || "");
  if (combined.includes("user location is not supported")) return true;
  if (combined.includes("failed_precondition")) return true;
  if (status === "FAILED_PRECONDITION") return true;
  return false;
}

function embedOpenAiFallbackEnabled() {
  const raw = String(process.env.EMBED_OPENAI_FALLBACK ?? "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "no";
}

async function generateEmbeddingOpenAI(input) {
  const key = String(process.env.OPENAI_API_KEY || "").trim();
  if (!key) {
    throw new Error("OPENAI_API_KEY is required when using OpenAI embeddings or geo fallback.");
  }
  const url = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1/embeddings").trim();
  const { data } = await axios.post(
    url,
    {
      model: OPENAI_EMBED_MODEL,
      input,
      dimensions: EMBED_DIMENSIONS,
    },
    {
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      timeout: 120000,
      validateStatus: () => true,
    }
  );
  if (data?.error) {
    throw new Error(data.error.message || "OpenAI embeddings error");
  }
  const vec = data?.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length !== EMBED_DIMENSIONS) {
    throw new Error(
      `OpenAI embedding dimension mismatch: expected ${EMBED_DIMENSIONS}, got ${Array.isArray(vec) ? vec.length : 0}`
    );
  }
  return vec;
}

async function runWithEmbedFallback(fn) {
  if (!embedPool.length) {
    throw new Error("No embed keys configured. Set GOOGLE_API_KEY_10 and/or GOOGLE_API_KEY_11.");
  }

  const now = Date.now();
  let lastError = null;

  for (const entry of embedPool) {
    if (entry.cooldownUntil > now) {
      console.warn(`[embed-pool] ${maskKey(entry.key)} is cooling down, skipping.`);
      continue;
    }

    try {
      const client = getEmbedClient(entry);
      const result = await fn(client);
      return result;
    } catch (err) {
      lastError = err;
      if (isRateLimit(err)) {
        entry.cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
        console.warn(`[embed-pool] ${maskKey(entry.key)} rate-limited, cooling down ${RATE_LIMIT_COOLDOWN_MS / 1000}s. Trying next key.`);
      } else if (isAuthError(err)) {
        entry.cooldownUntil = Date.now() + 6 * 60 * 60 * 1000;
        console.error(`[embed-pool] ${maskKey(entry.key)} auth error (leaked/invalid), disabling for 6h.`);
      } else {
        throw err;
      }
    }
  }

  throw lastError || new Error("All embed keys are rate-limited or unavailable.");
}

function preprocessText(text) {
  return String(text || "")
    .replace(/[/\\|]+/g, " ")
    .replace(/[–—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);
}

async function generateEmbeddingGemini(input) {
  const result = await runWithEmbedFallback((client) =>
    client.models.embedContent({
      model: EMBED_MODEL,
      contents: input,
      config: { outputDimensionality: EMBED_DIMENSIONS },
    })
  );

  const values =
    (result && result.embeddings && result.embeddings[0] && result.embeddings[0].values) ||
    (result && result.embedding && result.embedding.values) ||
    null;

  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Gemini embedding response had no values.");
  }
  return values;
}

async function generateEmbedding(text) {
  const input = preprocessText(text);
  if (!input) return null;

  if (EMBED_PROVIDER === "openai") {
    return generateEmbeddingOpenAI(input);
  }
  if (EMBED_PROVIDER === "gemini") {
    return generateEmbeddingGemini(input);
  }

  // auto: Gemini (AI Studio keys) first — often blocked from cloud IPs; then OpenAI same dims.
  try {
    return await generateEmbeddingGemini(input);
  } catch (err) {
    if (!isUnsupportedLocationError(err)) throw err;
    if (!embedOpenAiFallbackEnabled()) throw err;
    const key = String(process.env.OPENAI_API_KEY || "").trim();
    if (!key) {
      throw new Error(
        'Gemini embedding blocked for this server region ("User location is not supported"). ' +
          "Set OPENAI_API_KEY on Render and keep EMBED_OPENAI_FALLBACK=true (default), or use Vertex AI / embed from a supported network."
      );
    }
    console.warn(
      "[embed] Gemini FAILED_PRECONDITION (geo/datacenter). Using OpenAI embeddings as fallback — " +
        "new vectors share dimensionality but a different model space than older Gemini rows; consider re-embedding all chunks with one provider."
    );
    return generateEmbeddingOpenAI(input);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function embedChunksBatched(chunks, { batchSize = 10, pauseMs = 1000, onProgress } = {}) {
  const out = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const embedded = await Promise.all(
      batch.map(async (chunk) => {
        const vec = await generateEmbedding(chunk.content || "");
        return { ...chunk, embedding: vec };
      })
    );
    out.push(...embedded);
    if (typeof onProgress === "function") {
      onProgress(Math.min(i + batchSize, chunks.length), chunks.length);
    }
    if (i + batchSize < chunks.length) {
      await sleep(pauseMs);
    }
  }
  return out;
}

function vectorToPgLiteral(vec) {
  if (!Array.isArray(vec) || !vec.length) return null;
  return `[${vec.join(",")}]`;
}

module.exports = {
  generateEmbedding,
  embedChunksBatched,
  vectorToPgLiteral,
  EMBED_MODEL,
};
