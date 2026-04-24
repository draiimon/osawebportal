/**
 * Prints recent rows from chat_messages (newest first, then outputs chronological).
 * Usage:
 *   node scripts/recent-chat-log.js [limit]                  — OTP sessions (latest N messages)
 *   node scripts/recent-chat-log.js session <session_id>     — full session by ID
 *   node scripts/recent-chat-log.js guest [limit]            — guest /chatbot path
 *   node scripts/recent-chat-log.js guest session <conv_id>  — full guest session by conversation_id
 *   npm run chat:log -- 80
 * Requires .env DATABASE_URL or DB_* vars (same as server/db.js).
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { Pool } = require("pg");

const sslEnabled = String(process.env.DB_SSL || "").toLowerCase() === "true";
const connectionString = process.env.DATABASE_URL || "";
const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: sslEnabled ? { rejectUnauthorized: false } : false,
    })
  : new Pool({
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME || "admin",
      user: process.env.DB_USER || "postgres",
      password: process.env.DB_PASSWORD || "",
      ssl: sslEnabled ? { rejectUnauthorized: false } : false,
    });

function maskEmail(e) {
  const s = String(e || "").trim();
  if (!s.includes("@")) return s ? "(session)" : "";
  const [u, d] = s.split("@");
  if (!u || !d) return "***";
  return `${u.slice(0, 2)}***@${d}`;
}

async function main() {
  const args = process.argv.slice(2);
  const guestMode = String(args[0] || "").toLowerCase() === "guest";
  const rest = guestMode ? args.slice(1) : args;
  const sessionMode = String(rest[0] || "").toLowerCase() === "session";
  const sessionId = sessionMode ? rest[1] : null;
  const limit = sessionMode ? 500 : Math.min(200, Math.max(5, Number(rest[0] || 50)));

  let payload;

  if (guestMode) {
    let r;
    try {
      if (sessionId) {
        r = await pool.query(
          `SELECT created_at AT TIME ZONE 'UTC' AS created_at_utc,
                  role,
                  content,
                  length(content)::int AS content_chars,
                  conversation_id
             FROM chatbot_conversation_memory
            WHERE conversation_id = $1
            ORDER BY created_at ASC`,
          [sessionId]
        );
      } else {
        r = await pool.query(
          `SELECT created_at AT TIME ZONE 'UTC' AS created_at_utc,
                  role,
                  left(content, 1200) AS content,
                  length(content)::int AS content_chars,
                  conversation_id
             FROM chatbot_conversation_memory
            ORDER BY created_at DESC
            LIMIT $1`,
          [limit]
        );
        r.rows.reverse();
      }
    } catch (e) {
      const msg = e && e.message ? String(e.message) : "";
      if (msg.includes("chatbot_conversation_memory") && msg.includes("does not exist")) {
        payload = {
          source: "postgresql:chatbot_conversation_memory",
          note: "Table missing — enable CHATBOT_MEMORY or run chatbot once.",
          count: 0,
          messages: [],
        };
        process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
        await pool.end();
        return;
      }
      throw e;
    }

    const lines = r.rows.map((row) => ({
      at: row.created_at_utc,
      role: row.role,
      conversationId: row.conversation_id,
      chars: row.content_chars,
      text: row.content,
    }));

    payload = {
      source: "postgresql:chatbot_conversation_memory",
      sessionId: sessionId || null,
      count: lines.length,
      messages: lines,
    };
  } else {
    let r;
    if (sessionId) {
      r = await pool.query(
        `SELECT m.created_at AT TIME ZONE 'UTC' AS created_at_utc,
                m.role,
                m.content,
                length(m.content)::int AS content_chars,
                m.session_id,
                s.email AS student_email,
                coalesce(s.student_name, '') AS student_name
           FROM chat_messages m
           LEFT JOIN chat_sessions s ON s.id = m.session_id
          WHERE m.session_id = $1
          ORDER BY m.created_at ASC`,
        [sessionId]
      );
    } else {
      r = await pool.query(
        `SELECT m.created_at AT TIME ZONE 'UTC' AS created_at_utc,
                m.role,
                left(m.content, 1200) AS content,
                length(m.content)::int AS content_chars,
                m.session_id,
                s.email AS student_email,
                coalesce(s.student_name, '') AS student_name
           FROM chat_messages m
           LEFT JOIN chat_sessions s ON s.id = m.session_id
          ORDER BY m.created_at DESC
          LIMIT $1`,
        [limit]
      );
      r.rows.reverse();
    }

    const lines = r.rows.map((row) => ({
      at: row.created_at_utc,
      role: row.role,
      session: String(row.session_id || "").slice(0, 8) + "…",
      student: maskEmail(row.student_email),
      name: row.student_name || "",
      chars: row.content_chars,
      text: row.content,
    }));

    payload = {
      source: "postgresql:chat_messages",
      sessionId: sessionId || null,
      count: lines.length,
      messages: lines,
    };
  }

  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");

  await pool.end();
}

main().catch((err) => {
  console.error("[recent-chat-log]", err.message || err);
  process.exit(1);
});
