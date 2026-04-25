"use strict";

// Simple in-memory daily + burst quota tracker for chat messages.
// Resets at local-server midnight. Keyed by session_id (preferred) or IP.

const DAILY_LIMIT = Number(process.env.OSA_CHAT_DAILY_LIMIT || 20);
const BURST_LIMIT = Number(process.env.OSA_CHAT_BURST_LIMIT || 10);
const BURST_WINDOW_MS = Number(process.env.OSA_CHAT_BURST_WINDOW_MS || 60 * 1000);

const store = new Map(); // key -> { count, dayKey, burstTimes: [ms,...] }

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
    return { count: 0, dayKey: day, burstTimes: [] };
  }
  // Prune stale burst timestamps (outside window) on read.
  const now = Date.now();
  const burstTimes = (rec.burstTimes || []).filter(
    (t) => now - t < BURST_WINDOW_MS
  );
  return { count: rec.count, dayKey: rec.dayKey, burstTimes };
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
    burst_used: rec.burstTimes.length,
    burst_limit: BURST_LIMIT,
    burst_window_ms: BURST_WINDOW_MS,
    reset_at: nextResetIso(),
  };
}

function incrementQuota(key) {
  const day = todayKey();
  const now = Date.now();
  const rec = store.get(key);
  if (!rec || rec.dayKey !== day) {
    store.set(key, { count: 1, dayKey: day, burstTimes: [now] });
  } else {
    const burstTimes = (rec.burstTimes || []).filter(
      (t) => now - t < BURST_WINDOW_MS
    );
    burstTimes.push(now);
    rec.count += 1;
    rec.burstTimes = burstTimes;
    store.set(key, rec);
  }
}

function buildSnapshotFromRec(rec) {
  return {
    used: rec.count,
    limit: DAILY_LIMIT,
    remaining: Math.max(0, DAILY_LIMIT - rec.count),
    burst_used: rec.burstTimes.length,
    burst_limit: BURST_LIMIT,
    burst_window_ms: BURST_WINDOW_MS,
    reset_at: nextResetIso(),
  };
}

// Express middleware: blocks request when daily or burst limit is exhausted.
// Otherwise increments counter and attaches snapshot to req.osaQuota.
function dailyQuotaMiddleware(req, res, next) {
  try {
    const key = getQuotaKey(req);
    const rec = readQuota(key);

    // Daily limit gate
    if (rec.count >= DAILY_LIMIT) {
      return res.status(429).json({
        success: false,
        code: "DAILY_LIMIT_REACHED",
        message: "You have reached your daily limit. Try again tomorrow.",
        quota: buildSnapshotFromRec(rec),
      });
    }

    // Burst limit gate
    if (rec.burstTimes.length >= BURST_LIMIT) {
      const oldest = rec.burstTimes[0];
      const waitMs = Math.max(0, BURST_WINDOW_MS - (Date.now() - oldest));
      return res.status(429).json({
        success: false,
        code: "BURST_LIMIT_REACHED",
        message:
          "You're sending messages too fast. Please wait " +
          Math.ceil(waitMs / 1000) +
          "s and try again.",
        quota: buildSnapshotFromRec(rec),
        retry_after_ms: waitMs,
      });
    }

    incrementQuota(key);
    const after = readQuota(key);
    req.osaQuota = buildSnapshotFromRec(after);

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
