const db = require("../../db");

const CACHE_TTL_SECONDS = Math.max(60, Number(process.env.CHATBOT_CACHE_TTL_SECONDS || 6 * 60 * 60));

async function ensureCacheTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS chatbot_response_cache (
      cache_key TEXT PRIMARY KEY,
      query_text TEXT NOT NULL,
      response_text TEXT NOT NULL,
      provider TEXT NOT NULL,
      hit_count INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_hit_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getCachedResponse(cacheKey) {
  const result = await db.query(
    `SELECT response_text, provider
     FROM chatbot_response_cache
     WHERE cache_key = $1
       AND updated_at >= NOW() - ($2 || ' seconds')::interval
     LIMIT 1`,
    [cacheKey, CACHE_TTL_SECONDS]
  );

  if (!result.rows.length) return null;

  await db.query(
    `UPDATE chatbot_response_cache
     SET hit_count = hit_count + 1, last_hit_at = NOW()
     WHERE cache_key = $1`,
    [cacheKey]
  );

  return {
    response: result.rows[0].response_text,
    provider: result.rows[0].provider,
  };
}

async function saveCachedResponse(cacheKey, queryText, responseText, provider) {
  await db.query(
    `INSERT INTO chatbot_response_cache (
       cache_key, query_text, response_text, provider, hit_count, created_at, updated_at, last_hit_at
     )
     VALUES ($1, $2, $3, $4, 0, NOW(), NOW(), NOW())
     ON CONFLICT (cache_key)
     DO UPDATE SET
       query_text = EXCLUDED.query_text,
       response_text = EXCLUDED.response_text,
       provider = EXCLUDED.provider,
       updated_at = NOW()`,
    [cacheKey, queryText, responseText, provider]
  );
}

module.exports = {
  ensureCacheTable,
  getCachedResponse,
  saveCachedResponse,
};
