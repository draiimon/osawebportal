const { GoogleGenAI } = require("@google/genai");

const GEMINI_KEY_COOLDOWN_MS = Math.max(
  30 * 1000,
  Number(process.env.GEMINI_KEY_COOLDOWN_MS || 15 * 60 * 1000)
);
const GEMINI_AUTH_FAILURE_COOLDOWN_MS = Math.max(
  GEMINI_KEY_COOLDOWN_MS,
  Number(process.env.GEMINI_AUTH_FAILURE_COOLDOWN_MS || 6 * 60 * 60 * 1000)
);
const GEMINI_LOG_SUCCESS =
  String(process.env.GEMINI_LOG_SUCCESS || "true").trim().toLowerCase() !== "false";

function log(level, message) {
  try {
    const line = `[gemini-pool] ${message}`;
    if (level === "warn") {
      // eslint-disable-next-line no-console
      console.warn(line);
      return;
    }
    if (level === "error") {
      // eslint-disable-next-line no-console
      console.error(line);
      return;
    }
    // eslint-disable-next-line no-console
    console.log(line);
  } catch (_) {}
}

function maskKey(key) {
  const text = String(key || "").trim();
  if (!text) return "";
  if (text.length <= 10) return `${text.slice(0, 2)}***${text.slice(-2)}`;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function normalizeEnvKeyName(name) {
  const raw = String(name || "").trim();
  if (!raw) return { matches: false, order: Number.MAX_SAFE_INTEGER };
  if (raw === "GEMINI_API_KEY") return { matches: true, order: 0 };
  const match = raw.match(/^GEMINI_API_KEY_?(\d+)$/);
  if (!match) return { matches: false, order: Number.MAX_SAFE_INTEGER };
  return { matches: true, order: Number(match[1]) || Number.MAX_SAFE_INTEGER };
}

function collectGeminiKeys(env) {
  const found = [];
  Object.keys(env || {}).forEach((name) => {
    const meta = normalizeEnvKeyName(name);
    if (!meta.matches) return;
    const value = String(env[name] || "").trim();
    if (!value) return;
    found.push({ envName: name, order: meta.order, key: value });
  });

  const listValue = String(env?.GEMINI_API_KEYS || "").trim();
  if (listValue) {
    listValue
      .split(",")
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .forEach((key, idx) => {
        found.push({
          envName: `GEMINI_API_KEYS[${idx + 1}]`,
          order: 1000 + idx,
          key,
        });
      });
  }

  found.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.envName.localeCompare(b.envName);
  });

  const seen = new Set();
  const out = [];
  found.forEach((item, idx) => {
    if (seen.has(item.key)) return;
    seen.add(item.key);
    out.push({
      poolIndex: idx,
      envName: item.envName,
      key: item.key,
      label: `${item.envName} (${maskKey(item.key)})`,
      client: null,
      cooldownUntil: 0,
      failureCount: 0,
      successCount: 0,
      lastError: "",
      lastUsedAt: 0,
      lastSuccessAt: 0,
    });
  });

  return out;
}

const keyPool = collectGeminiKeys(process.env);
let activeIndex = 0;
let stateLock = Promise.resolve();

if (keyPool.length) {
  log(
    "info",
    `loaded ${keyPool.length} Gemini API key(s) in FIFO order. Active key: ${keyPool[0].label}`
  );
} else {
  log("warn", "no Gemini API keys detected. Set GEMINI_API_KEY, GEMINI_API_KEY2..9, or GEMINI_API_KEYS.");
}

function withStateLock(fn) {
  const previous = stateLock;
  let release = () => {};
  stateLock = new Promise((resolve) => {
    release = resolve;
  });
  return previous
    .then(() => fn())
    .finally(() => {
      release();
    });
}

function isUsable(entry, now = Date.now()) {
  return !!(entry && entry.key && now >= Number(entry.cooldownUntil || 0));
}

function findNextUsableIndex(startIndex, now = Date.now()) {
  if (!keyPool.length) return -1;
  for (let offset = 0; offset < keyPool.length; offset += 1) {
    const idx = (startIndex + offset) % keyPool.length;
    if (isUsable(keyPool[idx], now)) return idx;
  }
  return -1;
}

function ensureActiveKeyUnlocked(reason) {
  if (!keyPool.length) return null;
  const now = Date.now();
  const current = keyPool[activeIndex];
  if (isUsable(current, now)) return { index: activeIndex, entry: current };

  const nextIndex = findNextUsableIndex(activeIndex + 1, now);
  if (nextIndex === -1) {
    log(
      "warn",
      `no Gemini key is currently usable for ${reason}; all configured keys are cooling down or unavailable.`
    );
    return null;
  }

  if (nextIndex !== activeIndex) {
    log(
      "warn",
      `active Gemini key ${current ? current.label : "(none)"} is cooling down. Switching to ${keyPool[nextIndex].label}.`
    );
    activeIndex = nextIndex;
  }

  return { index: activeIndex, entry: keyPool[activeIndex] };
}

function getClient(entry) {
  if (!entry) return null;
  if (!entry.client) {
    entry.client = new GoogleGenAI({ apiKey: entry.key });
  }
  return entry.client;
}

function trimErrorMessage(error) {
  const text = String(error?.message || error || "").replace(/\s+/g, " ").trim();
  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
}

function classifyGeminiError(error) {
  const status = Number(
    error?.status ||
    error?.response?.status ||
    error?.cause?.status ||
    0
  );
  const message = trimErrorMessage(error).toLowerCase();

  if (
    status === 429 ||
    /resource_exhausted|rate limit|quota|too many requests|usage limit|exceeded.*quota/i.test(message)
  ) {
    return {
      type: "rate-limit",
      rotate: true,
      cooldownMs: GEMINI_KEY_COOLDOWN_MS,
    };
  }

  if (
    status === 401 ||
    status === 403 ||
    /"code":\s*40[13]\b/.test(message) ||
    /invalid api key|api key not valid|permission.denied|permission_denied|unauthorized|forbidden|billing|api_key_invalid|reported as leaked|api key.*leaked|leaked.*api key/i.test(message)
  ) {
    return {
      type: "auth",
      rotate: true,
      cooldownMs: GEMINI_AUTH_FAILURE_COOLDOWN_MS,
    };
  }

  if (
    status >= 500 ||
    /service unavailable|temporarily unavailable|deadline exceeded|timed out|timeout|connection reset|socket hang up|network error|fetch failed|internal/i.test(message)
  ) {
    return {
      type: "transient",
      rotate: false,
      cooldownMs: 0,
    };
  }

  return {
    type: "generic",
    rotate: false,
    cooldownMs: 0,
  };
}

function noteSuccessUnlocked(index, operationName) {
  const entry = keyPool[index];
  if (!entry) return;
  entry.lastUsedAt = Date.now();
  entry.lastSuccessAt = entry.lastUsedAt;
  entry.successCount += 1;
  entry.lastError = "";
  if (GEMINI_LOG_SUCCESS) {
    log("info", `${operationName} succeeded with ${entry.label}.`);
  }
}

function noteFailureUnlocked(index, operationName, error, classification) {
  const entry = keyPool[index];
  if (!entry) return;
  entry.lastUsedAt = Date.now();
  entry.failureCount += 1;
  entry.lastError = trimErrorMessage(error);
  if (classification.cooldownMs > 0) {
    entry.cooldownUntil = Date.now() + classification.cooldownMs;
  }

  const wasActive = index === activeIndex;
  let switchedTo = "";
  if (classification.rotate && wasActive) {
    const nextIndex = findNextUsableIndex(index + 1);
    if (nextIndex !== -1 && nextIndex !== index) {
      activeIndex = nextIndex;
      switchedTo = keyPool[nextIndex].label;
    }
  }

  const cooldownText = classification.cooldownMs > 0
    ? ` Cooldown: ${Math.round(classification.cooldownMs / 1000)}s.`
    : "";
  const switchText = switchedTo
    ? ` Active key switched to ${switchedTo}.`
    : classification.rotate
      ? " No other Gemini key is immediately available."
      : " Staying on the current active Gemini key.";

  log(
    "warn",
    `${operationName} failed on ${entry.label} [${classification.type}]. ${entry.lastError || "Unknown Gemini error."}${cooldownText}${switchText}`
  );
}

async function runWithGeminiFailover(operationName, executor) {
  if (!keyPool.length) {
    throw new Error("Gemini is not configured. Add GEMINI_API_KEY or GEMINI_API_KEY2..9.");
  }

  const attempted = new Set();
  let lastError = null;

  while (attempted.size < keyPool.length) {
    const active = await withStateLock(() => ensureActiveKeyUnlocked(operationName));
    if (!active || !active.entry) break;

    const { index, entry } = active;
    if (attempted.has(index)) break;
    attempted.add(index);

    log("info", `${operationName} using ${entry.label}.`);

    try {
      const result = await executor(getClient(entry), entry);
      await withStateLock(() => noteSuccessUnlocked(index, operationName));
      return result;
    } catch (error) {
      const classification = classifyGeminiError(error);
      await withStateLock(() => noteFailureUnlocked(index, operationName, error, classification));
      lastError = error;
      if (!classification.rotate) {
        throw error;
      }
    }
  }

  const finalError = lastError || new Error("All Gemini API keys are temporarily unavailable.");
  finalError.geminiAllKeysFailed = true;
  throw finalError;
}

function hasGeminiKeys() {
  return keyPool.length > 0;
}

module.exports = {
  hasGeminiKeys,
  runWithGeminiFailover,
};
