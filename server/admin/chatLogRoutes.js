const db = require("../db");
const { verifyAuthToken } = require("../auth/jwt");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireAdminAuth(req, res, next) {
  const expected = String(process.env.ADMIN_KEY || "").trim();
  const provided = String((req.headers && req.headers["x-admin-key"]) || "").trim();
  if (!expected) {
    // eslint-disable-next-line no-console
    console.warn("[admin-chat-logs] ADMIN_KEY unset — allowing (dev only).");
    return next();
  }
  if (provided === expected) return next();
  try {
    const decoded = verifyAuthToken(provided);
    const role = String((decoded && decoded.role) || "").trim().toUpperCase();
    if (role === "ADMIN") return next();
  } catch (_e) {}
  return res.status(401).json({ success: false, message: "Unauthorized." });
}

function registerChatLogAdminRoutes(app, apiPrefix) {
  /**
   * GET /api/v1/admin/chat/logs
   * Query: limit (default 50, max 200), session_id (optional UUID), role (optional user|assistant)
   * Auth: x-admin-key = ADMIN_KEY or admin JWT (same as chat tickets).
   */
  app.get(`${apiPrefix}/admin/chat/logs`, requireAdminAuth, async (req, res) => {
    try {
      let limit = Number(req.query && req.query.limit);
      if (!Number.isFinite(limit)) limit = 50;
      limit = Math.min(200, Math.max(5, Math.floor(limit)));

      const sessionId = String((req.query && req.query.session_id) || "").trim();
      if (sessionId && !UUID_RE.test(sessionId)) {
        return res.status(400).json({ success: false, message: "session_id must be a valid UUID." });
      }

      const roleRaw = String((req.query && req.query.role) || "").trim().toLowerCase();
      let roleFilter = "";
      if (roleRaw === "user" || roleRaw === "assistant") {
        roleFilter = roleRaw;
      } else if (roleRaw) {
        return res.status(400).json({ success: false, message: "role must be user or assistant." });
      }

      const params = [];
      let p = 1;
      const where = [];
      if (sessionId) {
        where.push(`m.session_id = $${p}`);
        params.push(sessionId);
        p += 1;
      }
      if (roleFilter) {
        where.push(`m.role = $${p}`);
        params.push(roleFilter);
        p += 1;
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      params.push(limit);
      const limitParam = `$${p}`;

      const result = await db.query(
        `SELECT m.id,
                m.created_at,
                m.role,
                m.content,
                m.session_id,
                s.email AS student_email,
                s.student_name
           FROM chat_messages m
           LEFT JOIN chat_sessions s ON s.id = m.session_id
           ${whereSql}
           ORDER BY m.created_at DESC
           LIMIT ${limitParam}`,
        params
      );

      const messages = result.rows.map((row) => ({
        id: String(row.id),
        createdAt: row.created_at,
        role: row.role,
        content: row.content,
        sessionId: row.session_id,
        studentEmail: row.student_email || "",
        studentName: row.student_name || "",
      }));

      return res.json({
        success: true,
        limit,
        count: messages.length,
        filters: { session_id: sessionId || null, role: roleFilter || null },
        messages,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[admin-chat-logs]", error && (error.stack || error.message || error));
      return res.status(500).json({ success: false, message: "Could not load chat logs." });
    }
  });

  /**
   * GET /api/v1/admin/chat/logs/guest
   * Non-OTP / widget-offline path: /chatbot/message stores turns in `chatbot_conversation_memory`
   * (conversation_id like guest-<timestamp> or session-<uuid>).
   */
  app.get(`${apiPrefix}/admin/chat/logs/guest`, requireAdminAuth, async (req, res) => {
    try {
      let limit = Number(req.query && req.query.limit);
      if (!Number.isFinite(limit)) limit = 50;
      limit = Math.min(200, Math.max(5, Math.floor(limit)));

      const convId = String((req.query && req.query.conversation_id) || "").trim();

      const roleRaw = String((req.query && req.query.role) || "").trim().toLowerCase();
      let roleFilter = "";
      if (roleRaw === "user" || roleRaw === "assistant" || roleRaw === "system") {
        roleFilter = roleRaw;
      } else if (roleRaw) {
        return res.status(400).json({ success: false, message: "role must be user, assistant, or system." });
      }

      const params = [];
      let p = 1;
      const where = [];
      if (convId) {
        where.push(`conversation_id = $${p}`);
        params.push(convId);
        p += 1;
      }
      if (roleFilter) {
        where.push(`role = $${p}`);
        params.push(roleFilter);
        p += 1;
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      params.push(limit);
      const limitParam = `$${p}`;

      const result = await db.query(
        `SELECT id, created_at, role, content, conversation_id
           FROM chatbot_conversation_memory
           ${whereSql}
           ORDER BY created_at DESC
           LIMIT ${limitParam}`,
        params
      );

      const messages = result.rows.map((row) => ({
        id: String(row.id),
        createdAt: row.created_at,
        role: row.role,
        content: row.content,
        conversationId: row.conversation_id,
      }));

      return res.json({
        success: true,
        source: "chatbot_conversation_memory",
        limit,
        count: messages.length,
        filters: { conversation_id: convId || null, role: roleFilter || null },
        messages,
      });
    } catch (error) {
      const msg = error && error.message ? String(error.message) : "";
      if (msg.includes("chatbot_conversation_memory") && msg.includes("does not exist")) {
        return res.json({
          success: true,
          source: "chatbot_conversation_memory",
          limit: 50,
          count: 0,
          filters: {},
          messages: [],
          note: "Table not created yet; enable chatbot memory or restart API after first /chatbot/message.",
        });
      }
      // eslint-disable-next-line no-console
      console.error("[admin-chat-logs-guest]", error && (error.stack || error.message || error));
      return res.status(500).json({ success: false, message: "Could not load guest chatbot logs." });
    }
  });

  /**
   * DELETE /api/v1/admin/chat/logs
   * Query: id=<message_id>  OR  session_id=<uuid>
   * Removes one OTP message OR every message belonging to a session_id.
   */
  app.delete(`${apiPrefix}/admin/chat/logs`, requireAdminAuth, async (req, res) => {
    try {
      const id = String((req.query && req.query.id) || "").trim();
      const sessionId = String((req.query && req.query.session_id) || "").trim();

      if (!id && !sessionId) {
        return res
          .status(400)
          .json({ success: false, message: "Provide either id or session_id." });
      }
      if (sessionId && !UUID_RE.test(sessionId)) {
        return res
          .status(400)
          .json({ success: false, message: "session_id must be a valid UUID." });
      }

      let result;
      if (id) {
        const numericId = Number(id);
        if (!Number.isFinite(numericId) || numericId <= 0) {
          return res
            .status(400)
            .json({ success: false, message: "id must be a positive integer." });
        }
        result = await db.query(
          `DELETE FROM chat_messages WHERE id = $1 RETURNING id`,
          [numericId]
        );
      } else {
        result = await db.query(
          `DELETE FROM chat_messages WHERE session_id = $1 RETURNING id`,
          [sessionId]
        );
      }

      return res.json({
        success: true,
        deleted: result.rowCount || 0,
        scope: id ? "message" : "session",
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        "[admin-chat-logs delete]",
        error && (error.stack || error.message || error)
      );
      return res
        .status(500)
        .json({ success: false, message: "Could not delete chat log entry." });
    }
  });

  /**
   * DELETE /api/v1/admin/chat/logs/guest
   * Query: id=<row_id>  OR  conversation_id=<string>
   */
  app.delete(
    `${apiPrefix}/admin/chat/logs/guest`,
    requireAdminAuth,
    async (req, res) => {
      try {
        const id = String((req.query && req.query.id) || "").trim();
        const convId = String((req.query && req.query.conversation_id) || "").trim();

        if (!id && !convId) {
          return res
            .status(400)
            .json({ success: false, message: "Provide either id or conversation_id." });
        }

        let result;
        if (id) {
          const numericId = Number(id);
          if (!Number.isFinite(numericId) || numericId <= 0) {
            return res
              .status(400)
              .json({ success: false, message: "id must be a positive integer." });
          }
          result = await db.query(
            `DELETE FROM chatbot_conversation_memory WHERE id = $1 RETURNING id`,
            [numericId]
          );
        } else {
          result = await db.query(
            `DELETE FROM chatbot_conversation_memory WHERE conversation_id = $1 RETURNING id`,
            [convId]
          );
        }

        return res.json({
          success: true,
          deleted: result.rowCount || 0,
          scope: id ? "message" : "conversation",
        });
      } catch (error) {
        const msg = error && error.message ? String(error.message) : "";
        if (
          msg.includes("chatbot_conversation_memory") &&
          msg.includes("does not exist")
        ) {
          return res.json({
            success: true,
            deleted: 0,
            scope: "missing-table",
            note: "Guest chatbot memory table not created yet.",
          });
        }
        // eslint-disable-next-line no-console
        console.error(
          "[admin-chat-logs-guest delete]",
          error && (error.stack || error.message || error)
        );
        return res
          .status(500)
          .json({ success: false, message: "Could not delete guest chat log entry." });
      }
    }
  );
}

module.exports = { registerChatLogAdminRoutes };
