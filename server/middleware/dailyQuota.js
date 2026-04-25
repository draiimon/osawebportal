"use strict";

// Simple in-memory daily quota tracker for chat messages.
// Resets at local-server midnight. Keyed by session_id (preferred) or IP.

const DAILY_LIMIT = Number(process.env.OSA_CHAT_DAILY_LIMIT || 20);

const store = new Map(); // key -> { count, dayKey }

function todayKey() {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

function nextResetIso() {
  const d = new Date();
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
  return next.toISOString();
}

function getQuotaKey(req) {
  const sessionId = String(
    (req.body && req.body.session_id) ||
      (req.query && req.query.session_id) ||
      ""
  ).trim();
  if (sessionId) return "sid:" + sessionId;
  const ip = (req.ip || req.headers["x-forwarded-for"] || "unknown").toString();
  return "ip:" + ip;
}

function readQuota(key) {
  const day = todayKey();
  const rec = store.get(key);
  if (!rec || rec.dayKey !== day) {
    return { count: 0, dayKey: day };
  }
  return rec;
}

function getQuotaSnapshot(req) {
  const key = getQuotaKey(req);
  const rec = readQuota(key);
  const used = rec.count;
  const remaining = Math.max(0, DAILY_LIMIT - used);
  return {
    used,
    limit: DAILY_LIMIT,
    remaining,
    reset_at: nextResetIso(),
  };
}

function incrementQuota(req) {
  const key = getQuotaKey(req);
  const day = todayKey();
  const rec = store.get(key);
  if (!rec || rec.dayKey !== day) {
    store.set(key, { count: 1, dayKey: day });
  } else {
    rec.count += 1;
    store.set(key, rec);
  }
}

// Express middleware: blocks request when daily limit is exhausted.
// Otherwise increments counter and attaches snapshot to req.osaQuota.
function dailyQuotaMiddleware(req, res, next) {
  try {
    const key = getQuotaKey(req);
    const rec = readQuota(key);
    if (rec.count >= DAILY_LIMIT) {
      const snapshot = {
        used: rec.count,
        limit: DAILY_LIMIT,
        remaining: 0,
        reset_at: nextResetIso(),
      };
      return res.status(429).json({
        success: false,
        code: "DAILY_LIMIT_REACHED",
        message: "You have reached your daily limit. Try again tomorrow.",
        quota: snapshot,
      });
    }
    incrementQuota(req);
    const after = readQuota(key);
    req.osaQuota = {
      used: after.count,
      limit: DAILY_LIMIT,
      remaining: Math.max(0, DAILY_LIMIT - after.count),
      reset_at: nextResetIso(),
    };

    // Wrap res.json so successful responses carry the quota snapshot.
    const origJson = res.json.bind(res);
    res.json = (payload) => {
      try {
        if (payload && typeof payload === "object" && !payload.quota) {
          payload.quota = req.osaQuota;
        }
      } catch (_) {}
      return origJson(payload);
    };
    return next();
  } catch (_err) {
    return next();
  }
}

module.exports = {
  DAILY_LIMIT,
  dailyQuotaMiddleware,
  getQuotaSnapshot,
};
