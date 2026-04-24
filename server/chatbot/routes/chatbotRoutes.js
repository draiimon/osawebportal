const { runChatPipeline } = require("../services/chatPipeline");
const { NO_RELIABLE_KB_REPLY } = require("../utils/responseCleaner");

function registerChatbotRoutes(app, apiPrefix) {
  app.post(`${apiPrefix}/chatbot/message`, async (req, res) => {
    const message = String(req.body?.message || "").trim();
    const conversationId = String(req.body?.conversation_id || "").trim();
    const userId = String(req.body?.user_id || "").trim();

    try {
      const result = await runChatPipeline({
        message,
        conversationId,
        userId,
      });

      return res.json({
        success: true,
        data: result,
      });
    } catch (_error) {
      return res.json({
        success: true,
        data: {
          response: NO_RELIABLE_KB_REPLY,
          answer: NO_RELIABLE_KB_REPLY,
          escalate: true,
          provider: "fallback-static",
          cached: false,
          intent: "general",
          complexity: 1,
          conversationId: conversationId || null,
          userId: userId || null,
        },
      });
    }
  });
}

module.exports = { registerChatbotRoutes };
