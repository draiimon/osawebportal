const db = require("../db");
const { runChatPipeline } = require("../chatbot/services/chatPipeline");
const { verifyAuthToken } = require("../auth/jwt");

function registerRealtimeChat(io) {
  const chat = io.of("/ws/chat");

  chat.use((socket, next) => {
    const token =
      String(socket.handshake.auth?.token || "").trim() ||
      String(socket.handshake.headers?.authorization || "").replace(/^Bearer\s+/i, "").trim();

    if (!token) {
      socket.data.user = null;
      return next();
    }
    try {
      socket.data.user = verifyAuthToken(token);
      return next();
    } catch (_error) {
      return next(new Error("Unauthorized socket token."));
    }
  });

  chat.on("connection", (socket) => {
    socket.emit("chat:connected", {
      ok: true,
      socketId: socket.id,
      authenticated: !!socket.data.user,
    });

    socket.on("chat:join", async (payload = {}, ack = () => {}) => {
      try {
        const requestedId = String(payload.conversation_id || "").trim();
        const userId = String(socket.data.user?.sub || "");

        let conversationId = requestedId;
        if (!conversationId) {
          if (userId) {
            const created = await db.query(
              `INSERT INTO conversations (user_id, status)
               VALUES ($1, 'ACTIVE')
               RETURNING id`,
              [userId]
            );
            conversationId = created.rows[0].id;
          } else {
            conversationId = `guest-${socket.id}`;
          }
        }

        socket.join(conversationId);
        return ack({ ok: true, conversation_id: conversationId });
      } catch (error) {
        return ack({ ok: false, message: "Failed to join conversation.", detail: error?.message });
      }
    });

    socket.on("chat:message", async (payload = {}, ack = () => {}) => {
      const message = String(payload.message || "").trim();
      const conversationId = String(payload.conversation_id || "").trim();
      if (!message || !conversationId) {
        return ack({ ok: false, message: "conversation_id and message are required." });
      }

      try {
        const userId = String(socket.data.user?.sub || "");
        if (userId && !conversationId.startsWith("guest-")) {
          const exists = await db.query(`SELECT id FROM conversations WHERE id = $1 LIMIT 1`, [conversationId]);
          if (exists.rowCount === 0) {
            await db.query(
              `INSERT INTO conversations (id, user_id, status)
               VALUES ($1, $2, 'ACTIVE')`,
              [conversationId, userId]
            );
          }
          await db.query(
            `INSERT INTO messages (conversation_id, sender, content, tier_used)
             VALUES ($1, 'USER', $2, 'RAG')`,
            [conversationId, message]
          );
        }

        const ai = await runChatPipeline({
          message,
          conversationId,
          userId,
        });

        if (userId && !conversationId.startsWith("guest-")) {
          await db.query(
            `INSERT INTO messages (conversation_id, sender, content, tier_used)
             VALUES ($1, 'BOT', $2, $3)`,
            [conversationId, ai.response, ai.provider === "domain-quick-reply" ? "FAQ" : "RAG"]
          );
        }

        const outbound = {
          conversation_id: conversationId,
          message: ai.response,
          provider: ai.provider,
          cached: !!ai.cached,
          created_at: new Date().toISOString(),
        };
        chat.to(conversationId).emit("chat:reply", outbound);
        return ack({ ok: true, data: outbound });
      } catch (error) {
        return ack({ ok: false, message: "Message processing failed.", detail: error?.message });
      }
    });
  });
}

module.exports = { registerRealtimeChat };
