const EMBED_MODEL = String(process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001").trim();
const EMBED_DIMENSIONS = Math.max(64, Number(process.env.GEMINI_EMBED_DIMENSIONS || 768));
const { runWithGeminiFailover, hasGeminiKeys } = require("../../services/geminiKeyPool");

function preprocessText(text) {
  return String(text || "")
    .replace(/[/\\|]+/g, " ")
    .replace(/[–—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);
}

async function generateEmbedding(text) {
  const input = preprocessText(text);
  if (!input) return null;
  if (!hasGeminiKeys()) throw new Error("Gemini API key not configured (GEMINI_API_KEY / GEMINI_API_KEY2..9).");

  const result = await runWithGeminiFailover("RAG Gemini embedding", async (client) => {
    return client.models.embedContent({
      model: EMBED_MODEL,
      contents: input,
      config: { outputDimensionality: EMBED_DIMENSIONS },
    });
  });

  const values =
    (result && result.embeddings && result.embeddings[0] && result.embeddings[0].values) ||
    (result && result.embedding && result.embedding.values) ||
    null;

  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Gemini embedding response had no values.");
  }
  return values;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function embedChunksBatched(chunks, { batchSize = 10, pauseMs = 1000, onProgress } = {}) {
  const out = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    // eslint-disable-next-line no-await-in-loop
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
      // eslint-disable-next-line no-await-in-loop
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
