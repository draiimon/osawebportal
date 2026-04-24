/**
 * Seeds the rag_chunks table from the curated manual/system chunk files
 * and generates Gemini embeddings (768-dim) for each chunk.
 *
 * Usage:
 *   node server/chatbot/seed/seedRagChunks.js           # insert + embed missing
 *   node server/chatbot/seed/seedRagChunks.js --reembed # force re-embed all
 *   node server/chatbot/seed/seedRagChunks.js --dry     # insert only, no embeddings
 */
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const db = require("../../db");
const { generateEmbedding, vectorToPgLiteral, EMBED_MODEL } = require("../services/embeddingService");

const DATA_DIR = path.resolve(__dirname, "../data");
const DATA_FILES = [
  path.join(DATA_DIR, "eac_manual_chunks.json"),
  path.join(DATA_DIR, "eac_manual_chunks_extra.json"),
  path.join(DATA_DIR, "eac_manual_chunks_detailed.js"),
  path.join(DATA_DIR, "system_chunks.json"),
];

function log(...args) {
  // eslint-disable-next-line no-console
  console.log("[seed-rag]", ...args);
}

function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 4);
}

async function loadChunks() {
  const all = [];
  for (const file of DATA_FILES) {
    if (!fs.existsSync(file)) continue;
    let arr = [];
    if (file.endsWith(".js")) {
      delete require.cache[require.resolve(file)];
      arr = require(file);
    } else {
      const raw = fs.readFileSync(file, "utf8");
      arr = JSON.parse(raw);
    }
    if (Array.isArray(arr)) {
      all.push(...arr);
      log(`  + loaded ${arr.length} chunks from ${path.basename(file)}`);
    }
  }
  if (!all.length) throw new Error("No chunks found in any JSON data file.");
  return all;
}

async function upsertChunk(chunk) {
  const keywords = Array.isArray(chunk.keywords) ? chunk.keywords.map((k) => String(k).trim()).filter(Boolean) : [];
  const tokenCount = estimateTokens(chunk.content);
  await db.query(
    `INSERT INTO rag_chunks
       (chunk_id, topic, article, section, keywords, bot_routing, content, source, token_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (chunk_id) DO UPDATE SET
       topic = EXCLUDED.topic,
       article = EXCLUDED.article,
       section = EXCLUDED.section,
       keywords = EXCLUDED.keywords,
       bot_routing = EXCLUDED.bot_routing,
       content = EXCLUDED.content,
       source = EXCLUDED.source,
       token_count = EXCLUDED.token_count,
       updated_at = NOW()`,
    [
      String(chunk.chunk_id || "").trim(),
      String(chunk.topic || "").trim(),
      String(chunk.article || "").trim(),
      String(chunk.section || "").trim(),
      keywords,
      String(chunk.bot_routing || "").trim(),
      String(chunk.content || "").trim(),
      String(chunk.source || "EAC Student Manual 2021").trim(),
      tokenCount,
    ]
  );
}

async function embedAndStore(chunkId, content) {
  const vec = await generateEmbedding(content);
  const lit = vectorToPgLiteral(vec);
  if (!lit) throw new Error(`Empty embedding for ${chunkId}`);
  await db.query(
    `UPDATE rag_chunks SET embedding = $1::vector, updated_at = NOW() WHERE chunk_id = $2`,
    [lit, chunkId]
  );
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const reembedAll = args.has("--reembed");
  const dryEmbed = args.has("--dry");

  log(`Embedding model: ${EMBED_MODEL}`);
  log(`Mode: ${reembedAll ? "re-embed all" : dryEmbed ? "insert only (no embed)" : "insert + embed missing"}`);

  const chunks = await loadChunks();
  log(`Loaded ${chunks.length} chunks from JSON.`);

  // Step 1: upsert all rows (no embeddings touched here)
  for (const chunk of chunks) {
    // eslint-disable-next-line no-await-in-loop
    await upsertChunk(chunk);
  }
  log(`Upserted ${chunks.length} rows into rag_chunks.`);

  if (dryEmbed) {
    log("Dry mode — skipping embedding generation.");
    return;
  }

  // Step 2: figure out which rows still need embeddings
  const { rows: statusRows } = await db.query(
    `SELECT chunk_id, content, (embedding IS NOT NULL) AS has_embedding
     FROM rag_chunks
     ORDER BY chunk_id ASC`
  );

  const targets = reembedAll ? statusRows : statusRows.filter((r) => !r.has_embedding);
  if (!targets.length) {
    log("All chunks already embedded. Nothing to do.");
    return;
  }

  log(`Embedding ${targets.length} chunk(s)…`);

  const batchSize = 5;
  const pauseMs = 1200;
  let done = 0;
  for (let i = 0; i < targets.length; i += batchSize) {
    const batch = targets.slice(i, i + batchSize);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(
      batch.map(async (row) => {
        try {
          await embedAndStore(row.chunk_id, row.content);
          done += 1;
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`[seed-rag] failed to embed ${row.chunk_id}:`, err?.message || err);
        }
      })
    );
    log(`  progress: ${Math.min(i + batchSize, targets.length)}/${targets.length}`);
    if (i + batchSize < targets.length) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, pauseMs));
    }
  }

  log(`Embedded ${done}/${targets.length} chunk(s).`);

  const { rows: summary } = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(embedding)::int AS embedded
     FROM rag_chunks`
  );
  log(`Final: ${summary[0].embedded}/${summary[0].total} chunks have embeddings.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[seed-rag] fatal:", err?.stack || err?.message || err);
    process.exit(1);
  });
