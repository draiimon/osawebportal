const db = require("../db");
const { generateEmbedding, vectorToPgLiteral } = require("../chatbot/services/embeddingService");
const { searchRag, explainRetrieval } = require("../chatbot/services/ragService");

function logError(scope, err) {
  // eslint-disable-next-line no-console
  console.error(`[${scope}]`, err && (err.stack || err.message || err));
}

function apiError(res, scope, err) {
  logError(scope, err);
  return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
}

function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 4);
}

function rowToDto(row) {
  return {
    id: row.id,
    chunkId: row.chunk_id,
    topic: row.topic || "",
    article: row.article || "",
    section: row.section || "",
    keywords: Array.isArray(row.keywords) ? row.keywords : [],
    botRouting: row.bot_routing || "",
    content: row.content || "",
    source: row.source || "",
    tokenCount: Number(row.token_count || 0),
    hasEmbedding: row.has_embedding === true || row.has_embedding === "true",
    isActive: row.is_active === true,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function registerRagAdminRoutes(app, apiPrefix) {
  // List all chunks
  app.get(`${apiPrefix}/admin/rag/chunks`, async (_req, res) => {
    try {
      const result = await db.query(
        `SELECT id, chunk_id, topic, article, section, keywords, bot_routing, content, source,
                token_count, (embedding IS NOT NULL) AS has_embedding,
                is_active, created_at, updated_at
         FROM rag_chunks
         ORDER BY chunk_id ASC`
      );
      const data = result.rows.map(rowToDto);
      const totals = {
        total: data.length,
        active: data.filter((d) => d.isActive).length,
        embedded: data.filter((d) => d.hasEmbedding).length,
      };
      return res.json({ success: true, data, totals });
    } catch (error) {
      return apiError(res, "admin-rag-list", error);
    }
  });

  // Create or update a chunk. Content changes trigger re-embed.
  app.post(`${apiPrefix}/admin/rag/chunks/upsert`, async (req, res) => {
    const body = req.body || {};
    const id = body.id ? String(body.id).trim() : "";
    const chunkId = String(body.chunkId || body.chunk_id || "").trim();
    const topic = String(body.topic || "").trim();
    const article = String(body.article || "").trim();
    const section = String(body.section || "").trim();
    const botRouting = String(body.botRouting || body.bot_routing || "").trim();
    const content = String(body.content || "").trim();
    const source = String(body.source || "EAC Student Manual 2021").trim();
    const isActive = body.isActive === false ? false : true;
    const keywordsRaw = body.keywords;
    const keywords = Array.isArray(keywordsRaw)
      ? keywordsRaw.map((k) => String(k || "").trim()).filter(Boolean)
      : String(keywordsRaw || "")
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean);

    if (!chunkId) return res.status(400).json({ success: false, message: "chunkId is required." });
    if (!content) return res.status(400).json({ success: false, message: "content is required." });

    try {
      // Check if row exists & whether content changed (to decide on embedding refresh)
      const existingResult = id
        ? await db.query(`SELECT id, content FROM rag_chunks WHERE id = $1`, [id])
        : await db.query(`SELECT id, content FROM rag_chunks WHERE chunk_id = $1`, [chunkId]);

      const existing = existingResult.rows[0] || null;
      const tokenCount = estimateTokens(content);
      const contentChanged = !existing || String(existing.content || "") !== content;

      let row;
      if (existing) {
        const updated = await db.query(
          `UPDATE rag_chunks SET
             chunk_id = $2, topic = $3, article = $4, section = $5, keywords = $6,
             bot_routing = $7, content = $8, source = $9, token_count = $10,
             is_active = $11, updated_at = NOW()
           WHERE id = $1
           RETURNING id, chunk_id, topic, article, section, keywords, bot_routing, content, source,
                     token_count, (embedding IS NOT NULL) AS has_embedding, is_active, created_at, updated_at`,
          [existing.id, chunkId, topic, article, section, keywords, botRouting, content, source, tokenCount, isActive]
        );
        row = updated.rows[0];
      } else {
        const inserted = await db.query(
          `INSERT INTO rag_chunks
             (chunk_id, topic, article, section, keywords, bot_routing, content, source, token_count, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id, chunk_id, topic, article, section, keywords, bot_routing, content, source,
                     token_count, (embedding IS NOT NULL) AS has_embedding, is_active, created_at, updated_at`,
          [chunkId, topic, article, section, keywords, botRouting, content, source, tokenCount, isActive]
        );
        row = inserted.rows[0];
      }

      // If content changed (or this is a new row), regenerate the embedding now.
      let embedded = false;
      let embedError = null;
      if (contentChanged) {
        try {
          const vec = await generateEmbedding(content);
          const lit = vectorToPgLiteral(vec);
          if (lit) {
            await db.query(
              `UPDATE rag_chunks SET embedding = $1::vector, updated_at = NOW() WHERE id = $2`,
              [lit, row.id]
            );
            embedded = true;
          }
        } catch (err) {
          embedError = err?.message || String(err);
          logError("admin-rag-embed", err);
        }
      }

      // Re-fetch to reflect embedding status
      const fresh = await db.query(
        `SELECT id, chunk_id, topic, article, section, keywords, bot_routing, content, source,
                token_count, (embedding IS NOT NULL) AS has_embedding,
                is_active, created_at, updated_at
         FROM rag_chunks WHERE id = $1`,
        [row.id]
      );
      return res.json({
        success: true,
        data: rowToDto(fresh.rows[0]),
        embedded,
        embedError,
      });
    } catch (error) {
      return apiError(res, "admin-rag-upsert", error);
    }
  });

  // Delete a chunk
  app.post(`${apiPrefix}/admin/rag/chunks/delete`, async (req, res) => {
    const id = String((req.body && req.body.id) || "").trim();
    if (!id) return res.status(400).json({ success: false, message: "id is required." });
    try {
      const r = await db.query(`DELETE FROM rag_chunks WHERE id = $1 RETURNING id`, [id]);
      if (!r.rows.length) return res.status(404).json({ success: false, message: "Chunk not found." });
      return res.json({ success: true, id });
    } catch (error) {
      return apiError(res, "admin-rag-delete", error);
    }
  });

  // Re-embed a single chunk (by id) or all chunks (when no id given)
  app.post(`${apiPrefix}/admin/rag/chunks/reembed`, async (req, res) => {
    const id = String((req.body && req.body.id) || "").trim();
    try {
      const rowsResult = id
        ? await db.query(`SELECT id, chunk_id, content FROM rag_chunks WHERE id = $1`, [id])
        : await db.query(`SELECT id, chunk_id, content FROM rag_chunks WHERE is_active = true ORDER BY chunk_id ASC`);

      const rows = rowsResult.rows;
      if (!rows.length) return res.status(404).json({ success: false, message: "No chunks to embed." });

      const failures = [];
      let done = 0;
      const batchSize = 5;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        // eslint-disable-next-line no-await-in-loop
        await Promise.all(
          batch.map(async (row) => {
            try {
              const vec = await generateEmbedding(row.content);
              const lit = vectorToPgLiteral(vec);
              if (!lit) throw new Error("empty embedding");
              await db.query(
                `UPDATE rag_chunks SET embedding = $1::vector, updated_at = NOW() WHERE id = $2`,
                [lit, row.id]
              );
              done += 1;
            } catch (err) {
              failures.push({ chunkId: row.chunk_id, error: err?.message || String(err) });
            }
          })
        );
        if (i + batchSize < rows.length) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 1200));
        }
      }

      return res.json({ success: true, total: rows.length, embedded: done, failures });
    } catch (error) {
      return apiError(res, "admin-rag-reembed", error);
    }
  });

  // Test search — returns top chunks, confidence, tier, method
  app.post(`${apiPrefix}/admin/rag/search`, async (req, res) => {
    const query = String((req.body && req.body.query) || "").trim();
    if (!query) return res.status(400).json({ success: false, message: "query is required." });
    try {
      const result = await searchRag(query);
      return res.json({
        success: true,
        query,
        confidence: result.confidence,
        tier: result.tier,
        method: result.method,
        chunks: (result.chunks || []).map((c) => ({
          chunkId: c.chunk_id,
          topic: c.topic,
          section: c.section,
          similarity: Number(c.similarity) || 0,
          retrieval: c.retrieval,
          contentPreview: String(c.content || "").slice(0, 220),
        })),
      });
    } catch (error) {
      return apiError(res, "admin-rag-search", error);
    }
  });

  // Debug — full retrieval transcript (keywords, scores, context, elapsed)
  app.post(`${apiPrefix}/admin/rag/debug`, async (req, res) => {
    const query = String((req.body && req.body.query) || "").trim();
    if (!query) return res.status(400).json({ success: false, message: "query is required." });
    try {
      const { text, result } = await explainRetrieval(query);
      return res.json({
        success: true,
        query,
        transcript: text,
        confidence: result.confidence,
        tier: result.tier,
        method: result.method,
        context: result.context,
        chunks: (result.chunks || []).map((c) => ({
          chunkId: c.chunk_id,
          topic: c.topic,
          section: c.section,
          similarity: Number(c.similarity) || 0,
          retrieval: c.retrieval,
        })),
        debug: result.debug || null,
      });
    } catch (error) {
      return apiError(res, "admin-rag-debug", error);
    }
  });
}

module.exports = { registerRagAdminRoutes };
