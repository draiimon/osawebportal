const db = require("../../db");

const MEMORY_ENABLED = String(process.env.CHATBOT_MEMORY_ENABLED || "true").toLowerCase() === "true";
const MEMORY_TURNS = Math.max(2, Number(process.env.CHATBOT_MEMORY_TURNS || 10));

async function ensureMemoryTable() {
  if (!MEMORY_ENABLED) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS chatbot_conversation_memory (
      id BIGSERIAL PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_chatbot_memory_conversation
    ON chatbot_conversation_memory (conversation_id, created_at ASC)
  `);
}

async function appendMemory(conversationId, role, content) {
  if (!MEMORY_ENABLED || !conversationId) return;
  await db.query(
    `INSERT INTO chatbot_conversation_memory (conversation_id, role, content)
     VALUES ($1, $2, $3)`,
    [conversationId, role, String(content || "")]
  );
}

async function getRecentMemory(conversationId) {
  if (!MEMORY_ENABLED || !conversationId) return [];
  const result = await db.query(
    `SELECT role, content
     FROM chatbot_conversation_memory
     WHERE conversation_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [conversationId, MEMORY_TURNS]
  );
  return result.rows.reverse().map((row) => ({
    role: row.role,
    content: row.content,
  }));
}

module.exports = {
  MEMORY_ENABLED,
  ensureMemoryTable,
  appendMemory,
  getRecentMemory,
};
