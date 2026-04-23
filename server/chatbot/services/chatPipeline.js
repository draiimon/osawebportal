const { preprocessUserInput } = require("../utils/preprocessor");
const { cleanModelText, ensureUserFacingFallback } = require("../utils/responseCleaner");
const { buildCacheKey } = require("../utils/hash");
const { getCachedResponse, saveCachedResponse } = require("../cache/postgresCache");
const { appendMemory, getRecentMemory } = require("../memory/postgresMemory");
const { buildProviderChain } = require("../router/smartRouter");
const { executeProvider } = require("./providers");
const POLICY_VERSION = "v2-domain-safe";

function logError(scope, error) {
  try {
    // eslint-disable-next-line no-console
    console.error(`[chatbot:${scope}]`, error?.stack || error?.message || error);
  } catch (_) {}
}

function makeSystemPrompt(meta) {
  return [
    "You are OSA Assistant for Emilio Aguinaldo College Cavite (OSA Transaction Guide Portal).",
    "Be concise, accurate, and user-friendly.",
    "Do not invent organizations, websites, or contacts.",
    "Never suggest external OSA websites like osa.org.",
    "For appointments and staff support, direct users to in-portal secure chat at /chat and OSA admin flow.",
    "Never reveal internal errors, routing logic, or provider names.",
    "If uncertain, provide a safe best-effort answer and suggest clarifying details.",
    `Detected intent: ${meta.intent}. Complexity: ${meta.complexity}.`,
  ].join(" ");
}

function buildDomainQuickReply(cleanedText) {
  const text = String(cleanedText || "").toLowerCase();
  if (text.includes("appointment") || text.includes("schedule") || text.includes("book")) {
    return [
      "To request an OSA appointment, use the in-portal secure chat flow.",
      "- Open: /chat",
      "- Verify your student email (OTP)",
      "- Share your concern and preferred day/time window",
      "- OSA staff confirms the schedule in-chat",
    ].join("\n");
  }
  return "";
}

async function runChatPipeline({ message, conversationId, userId }) {
  const processed = preprocessUserInput(message);

  if (!processed.cleanedText) {
    return {
      response: "Please type your question so I can help you.",
      provider: "none",
      cached: false,
      intent: processed.intent,
      complexity: processed.complexity,
    };
  }

  const cacheKey = buildCacheKey({
    policy: POLICY_VERSION,
    text: processed.cleanedText.toLowerCase(),
    intent: processed.intent,
    routeHint: processed.routeHint,
  });

  try {
    const cached = await getCachedResponse(cacheKey);
    if (cached && cached.response) {
      const cleanedCached = cleanModelText(cached.response);
      return {
        response: cleanedCached || ensureUserFacingFallback(),
        provider: cached.provider || "cache",
        cached: true,
        intent: processed.intent,
        complexity: processed.complexity,
      };
    }
  } catch (error) {
    logError("cache-read", error);
  }

  const memory = await getRecentMemory(conversationId).catch((error) => {
    logError("memory-read", error);
    return [];
  });

  const domainQuickReply = buildDomainQuickReply(processed.cleanedText);
  if (domainQuickReply) {
    await appendMemory(conversationId, "user", processed.cleanedText).catch((error) => logError("memory-write-user", error));
    await appendMemory(conversationId, "assistant", domainQuickReply).catch((error) => logError("memory-write-assistant", error));
    try {
      await saveCachedResponse(cacheKey, processed.cleanedText, domainQuickReply, "domain-quick-reply");
    } catch (error) {
      logError("cache-write-quick-reply", error);
    }
    return {
      response: domainQuickReply,
      provider: "domain-quick-reply",
      cached: false,
      intent: processed.intent,
      complexity: processed.complexity,
      conversationId: conversationId || null,
      userId: userId || null,
    };
  }

  const messages = [
    ...memory,
    { role: "user", content: processed.cleanedText },
  ];

  const providers = buildProviderChain(processed);
  let selectedProvider = "none";
  let responseText = "";

  for (const provider of providers) {
    try {
      const draft = await executeProvider(provider, {
        systemPrompt: makeSystemPrompt(processed),
        messages,
      });
      const cleaned = cleanModelText(draft);
      if (!cleaned) throw new Error("Empty response");
      selectedProvider = provider;
      responseText = cleaned;
      break;
    } catch (error) {
      logError(`provider-${provider}`, error);
    }
  }

  if (!responseText) {
    responseText = ensureUserFacingFallback();
    selectedProvider = "fallback-static";
  }

  await appendMemory(conversationId, "user", processed.cleanedText).catch((error) => logError("memory-write-user", error));
  await appendMemory(conversationId, "assistant", responseText).catch((error) => logError("memory-write-assistant", error));

  try {
    await saveCachedResponse(cacheKey, processed.cleanedText, responseText, selectedProvider);
  } catch (error) {
    logError("cache-write", error);
  }

  return {
    response: responseText,
    provider: selectedProvider,
    cached: false,
    intent: processed.intent,
    complexity: processed.complexity,
    conversationId: conversationId || null,
    userId: userId || null,
  };
}

module.exports = {
  runChatPipeline,
};
