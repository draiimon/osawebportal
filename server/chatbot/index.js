const { ensureCacheTable } = require("./cache/postgresCache");
const { ensureMemoryTable } = require("./memory/postgresMemory");
const { registerChatbotRoutes } = require("./routes/chatbotRoutes");

let initialized = false;

async function initChatbotSubsystem() {
  if (initialized) return;
  await ensureCacheTable();
  await ensureMemoryTable();
  initialized = true;
}

function registerChatbot(app, apiPrefix) {
  initChatbotSubsystem().catch((error) => {
    try {
      // eslint-disable-next-line no-console
      console.error("[chatbot:init]", error?.stack || error?.message || error);
    } catch (_) {}
  });
  registerChatbotRoutes(app, apiPrefix);
}

module.exports = { registerChatbot };
