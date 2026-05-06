const db = require("../db");
const { generateEmbedding, vectorToPgLiteral } = require("../chatbot/services/embeddingService");
const { searchRag, explainRetrieval } = require("../chatbot/services/ragService");

const GROQ_BASE_URL = String(process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").trim();
const GROQ_API_KEY = String(process.env.GROQ_API_KEY || "").trim();
const GROQ_MODEL = String(process.env.GROQ_MODEL || "llama-3.1-8b-instant").trim();

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

  // Embed API health check
  app.get(`${apiPrefix}/admin/rag/embed-status`, async (_req, res) => {
    try {
      const vec = await generateEmbedding("embed api status check");
      const working = Array.isArray(vec) && vec.length > 0;
      return res.json({ success: true, working, dimensions: working ? vec.length : 0 });
    } catch (err) {
      return res.json({ success: true, working: false, error: err?.message || String(err) });
    }
  });

  // AI Revise — uses Groq to rewrite content and suggest metadata
  app.post(`${apiPrefix}/admin/rag/ai-revise`, async (req, res) => {
    const content = String((req.body && req.body.content) || "").trim();
    if (!content) return res.status(400).json({ success: false, message: "content is required." });
    if (!GROQ_API_KEY) return res.status(503).json({ success: false, message: "Groq API key not configured." });

    const systemPrompt = `You are helping an admin at Emilio Aguinaldo College (EAC Cavite) structure knowledge base chunks for the OSA (Office of Student Affairs) student chatbot.

CONTENT RULES:
- Do NOT add any new information. Do NOT remove any facts. Keep the exact same meaning.
- Rewrite content in a clean, labeled structure. Use ALL-CAPS labels followed by a colon for each major concept (e.g., "PHILOSOPHY:", "REQUIREMENTS:", "POLICY:").
- Use numbered format "(1), (2), (3)..." for lists.
- Each labeled section should be on its own line.
- Keep it factual, concise, and easy for a chatbot to read and quote directly.
- If the content has multiple distinct concepts, separate them clearly with labels.

METADATA RULES:
- topic: Short, descriptive title (e.g., "School Philosophy, Vision, Mission & Core Values")
- article: Broad category this belongs to (e.g., "Institutional Information", "Admission Policies", "Student Discipline", "Academic Regulations"). Use a logical grouping — NOT the content itself.
- section: More specific sub-topic within the article (e.g., "Philosophy, Vision, Mission, Core Values", "Freshman Admission Requirements", "Scholarship Guidelines"). This should be more specific than article.
- keywords: 6–10 comma-separated keywords a student might use when asking about this topic.
- botRouting: One clear sentence — when should the chatbot use this chunk? (e.g., "When a student asks about EAC's mission, vision, values, or school identity.")

Respond ONLY with a valid JSON object — no markdown fences, no extra text:
{
  "content": "the rewritten content with labeled structure",
  "topic": "short descriptive topic title",
  "article": "broad category (e.g., Institutional Information)",
  "section": "specific sub-topic (e.g., Philosophy, Vision, Mission, Core Values)",
  "keywords": ["keyword1", "keyword2", "..."],
  "botRouting": "When a student asks about..."
}`;

    const userMessage = `Improve this knowledge base chunk:\n\n${content}`;

    try {
      const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          temperature: 0.3,
          max_completion_tokens: 1024,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const msg = payload?.error?.message || `Groq HTTP ${response.status}`;
        return res.status(502).json({ success: false, message: msg });
      }

      const rawText = String(payload?.choices?.[0]?.message?.content || "").trim();

      // Strip markdown fences if Groq wraps in ```json ... ```
      const stripped = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

      const jsonMatch = stripped.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return res.status(502).json({ success: false, message: "AI did not return valid JSON." });

      let parsed;
      try { parsed = JSON.parse(jsonMatch[0]); }
      catch (_) { return res.status(502).json({ success: false, message: "Failed to parse AI response." }); }

      // Normalize: content must be a plain string (Groq sometimes returns nested object)
      if (parsed.content && typeof parsed.content !== "string") {
        try {
          const parts = [];
          function flattenToLines(obj, prefix) {
            if (typeof obj === "string") { parts.push(prefix ? `${prefix} ${obj}` : obj); return; }
            if (Array.isArray(obj)) { obj.forEach(v => flattenToLines(v, "")); return; }
            if (typeof obj === "object" && obj !== null) {
              Object.entries(obj).forEach(([k, v]) => flattenToLines(v, k));
            }
          }
          flattenToLines(parsed.content, "");
          parsed.content = parts.join("\n");
        } catch (_) {
          parsed.content = JSON.stringify(parsed.content);
        }
      }

      // Normalize: keywords must be array of strings
      if (!Array.isArray(parsed.keywords)) {
        parsed.keywords = typeof parsed.keywords === "string"
          ? parsed.keywords.split(",").map(k => k.trim()).filter(Boolean)
          : [];
      }

      return res.json({ success: true, data: parsed });
    } catch (err) {
      return apiError(res, "admin-rag-ai-revise", err);
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
