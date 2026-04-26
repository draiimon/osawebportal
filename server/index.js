require("dotenv").config();

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const db = require("./db");
const { registerOtpRoutes } = require("./otp");
const { registerChatRoutes } = require("./chat");
const { registerChatbot } = require("./chatbot");
const { registerAuthRoutes } = require("./auth/routes");
const { registerRealtimeChat } = require("./socket/chatRealtime");
const { ensureV2Schema } = require("./migration/ensureV2Schema");
const { registerRagAdminRoutes } = require("./admin/ragRoutes");
const { registerChatLogAdminRoutes } = require("./admin/chatLogRoutes");

const app = express();
const httpServer = http.createServer(app);
const PORT = Number(process.env.API_PORT || 8787);
const API_PREFIX = "/api/v1";

// Behind a reverse proxy (Render, Heroku, nginx, Cloudflare), honour
// X-Forwarded-For so rate limiters key on the real client IP, not the proxy.
const trustProxySetting = process.env.TRUST_PROXY;
if (trustProxySetting != null && trustProxySetting !== "") {
  const asNum = Number(trustProxySetting);
  app.set("trust proxy", Number.isFinite(asNum) ? asNum : trustProxySetting);
}

function logError(scope, err) {
  try {
    // eslint-disable-next-line no-console
    console.error(`[${scope}]`, err && (err.stack || err.message || err));
  } catch (_) {}
}
function apiError(res, scope, err, status) {
  logError(scope, err);
  return res.status(status || 500).json({
    success: false,
    message: "Something went wrong. Please try again.",
  });
}

function requireAdminKey(req, res, next) {
  const expected = String(process.env.ADMIN_KEY || "").trim();
  if (!expected) {
    // eslint-disable-next-line no-console
    console.warn("[admin] ADMIN_KEY is not set — admin routes are unauthenticated (dev only).");
    return next();
  }
  const provided = String((req.headers && req.headers["x-admin-key"]) || "").trim();
  if (provided !== expected) {
    return res.status(401).json({ success: false, message: "Unauthorized." });
  }
  return next();
}

function isOtpBypassEmail(rawEmail) {
  const email = String(rawEmail || "").trim().toLowerCase();
  if (!email) return false;
  const allowed = String(process.env.OTP_TEST_BYPASS_EMAILS || "")
    .split(",")
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email);
}

function isLocalRequest(req) {
  const ip = String((req && req.ip) || "").toLowerCase();
  const host = String((req && req.hostname) || "").toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") return true;
  return (
    ip.includes("127.0.0.1") ||
    ip.includes("::1") ||
    ip.includes("localhost")
  );
}

function shouldSkipRateLimits(req) {
  const disableAll = String(process.env.DISABLE_RATE_LIMITS || "")
    .trim()
    .toLowerCase();
  if (disableAll === "1" || disableAll === "true" || disableAll === "yes") return true;
  const disableLocal = String(process.env.DISABLE_RATE_LIMITS_LOCAL || "true")
    .trim()
    .toLowerCase();
  if (disableLocal === "1" || disableLocal === "true" || disableLocal === "yes") {
    return isLocalRequest(req);
  }
  return false;
}

// ── Rate limiters ─────────────────────────────────────────────
const fmt = (success, message) => ({ success, message });

// Global: 300 req / 15 min per IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => shouldSkipRateLimits(req),
  message: fmt(false, "Too many requests. Please slow down."),
});

// OTP send: 3 per 15 min per IP+email (prevents email spam)
const otpSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  validate: false,
  skip: (req) => shouldSkipRateLimits(req) || isOtpBypassEmail(req.body && req.body.email),
  keyGenerator: (req) => {
    const email = String((req.body && req.body.email) || "").toLowerCase().trim();
    return (req.ip || "unknown") + ":" + email;
  },
  message: fmt(false, "Too many code requests. Please wait 15 minutes before trying again."),
});

// OTP verify: 10 per 15 min per IP
const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skip: (req) => shouldSkipRateLimits(req) || isOtpBypassEmail(req.body && req.body.email),
  message: fmt(false, "Too many verification attempts. Please wait 15 minutes."),
});

// Chat session create: 5 per hour per IP
const chatSessionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  skip: (req) => shouldSkipRateLimits(req),
  message: fmt(false, "Too many sessions created. Please wait an hour."),
});

// Chat messages: 80 per hour per session_id
const chatMsgLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 80,
  validate: false,
  skip: (req) => shouldSkipRateLimits(req),
  keyGenerator: (req) => {
    return String((req.body && req.body.session_id) || req.ip || "unknown");
  },
  message: fmt(false, "Message limit reached (80/hour). Please wait before sending more."),
});

app.use(globalLimiter);
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
  })
);
app.use(express.json({ limit: "8mb" }));

// Expose limiters for route registration
app.locals.limiters = { otpSendLimiter, otpVerifyLimiter, chatSessionLimiter, chatMsgLimiter };

app.get("/", (_req, res) => {
  const acceptsHtml = String(_req.headers.accept || "").toLowerCase().includes("text/html");
  if (acceptsHtml) {
    return res.redirect(302, "/preview");
  }
  return res.json({
    success: true,
    service: "osa-api",
    message: "OSA API is running.",
    docs: "/api/v1",
  });
});

app.get(`${API_PREFIX}`, (_req, res) => {
  res.json({
    success: true,
    service: "osa-api",
    version: "v1",
    endpoints: [
      `${API_PREFIX}/announcements`,
      `${API_PREFIX}/lost-found/items`,
      `${API_PREFIX}/content/:page`,
      `${API_PREFIX}/otp/send`,
      `${API_PREFIX}/otp/verify`,
      `${API_PREFIX}/auth/register`,
      `${API_PREFIX}/auth/login`,
      `${API_PREFIX}/auth/me`,
      `${API_PREFIX}/chat/session`,
      `${API_PREFIX}/chat/message`,
      `${API_PREFIX}/chatbot/message`,
      `${API_PREFIX}/chat/escalate`,
      `${API_PREFIX}/chat/tickets`,
      `${API_PREFIX}/chat/stream/:sessionId`,
      `${API_PREFIX}/health`,
    ],
  });
});

app.get(`${API_PREFIX}/health`, async (_req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ ok: true, service: "osa-api", db: "connected" });
  } catch (error) {
    logError("health", error);
    res.status(500).json({ ok: false, service: "osa-api", db: "down" });
  }
});

app.get(`${API_PREFIX}/admin/system-info`, async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT
         current_database() AS database_name,
         pg_database_size(current_database())::bigint AS size_bytes`
    );
    const row = result.rows && result.rows[0] ? result.rows[0] : {};
    const sizeBytes = Number(row.size_bytes || 0);
    const sizeGb = sizeBytes > 0 ? (sizeBytes / (1024 * 1024 * 1024)).toFixed(3) : "0.000";

    return res.json({
      success: true,
      data: {
        database: String(row.database_name || ""),
        sizeBytes,
        sizeGb,
      },
    });
  } catch (error) {
    return apiError(res, "admin-system-info", error);
  }
});

app.get(`${API_PREFIX}/announcements`, async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT id, title, category, urgency, details, date_label, time_label, images, is_active
       FROM announcements
       WHERE is_active = true
       ORDER BY created_at DESC, id DESC`
    );

    const data = result.rows.map((row) => ({
      id: row.id,
      title: row.title || "Announcement",
      category: row.category || "Advisory",
      urgency: row.urgency || "",
      details: row.details || "",
      date: row.date_label || "",
      time: row.time_label || "",
      images: Array.isArray(row.images) ? row.images : [],
    }));

    res.json({ success: true, data });
  } catch (error) {
    return apiError(res, "announcements", error);
  }
});

app.get(`${API_PREFIX}/lost-found/items`, async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT id, item_number, date_label, time_label, status, title, tag, caption, images, is_active
       FROM lost_found_items
       WHERE is_active = true
       ORDER BY created_at DESC, id DESC`
    );

    const data = result.rows.map((row) => ({
      id: row.id,
      itemNumber: row.item_number || "",
      date: row.date_label || "",
      time: row.time_label || "",
      status: row.status || "Unclaimed",
      title: row.title || "Recovered Item",
      tag: row.tag || "Personal Item",
      caption: row.caption || "",
      images: Array.isArray(row.images) ? row.images : [],
    }));

    res.json({ success: true, data });
  } catch (error) {
    return apiError(res, "lost-found", error);
  }
});

function toIsoDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const d = new Date(text);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function safeImages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => String(v || "").trim())
    .filter((v) => v && v.length < 2_000_000)
    .slice(0, 8);
}

function normalizeAnnouncementPayload(input) {
  const body = input && typeof input === "object" ? input : {};
  return {
    title: String(body.title || "").trim(),
    category: String(body.category || "Advisory").trim() || "Advisory",
    urgency: String(body.urgency || "").trim(),
    details: String(body.body || body.details || "").trim(),
    dateLabel: toIsoDate(body.date),
    timeLabel: String(body.time || "").trim(),
    isActive: String(body.status || "Published").toLowerCase() !== "draft",
    images: safeImages(body.images),
  };
}

function normalizeLostFoundPayload(input) {
  const body = input && typeof input === "object" ? input : {};
  const statusRaw = String(body.status || "Unclaimed").trim().toLowerCase();
  const status = statusRaw === "claimed" ? "Claimed" : "Unclaimed";
  return {
    itemNumber: String(body.itemNumber || "").trim(),
    dateLabel: toIsoDate(body.date),
    timeLabel: String(body.time || "").trim(),
    status,
    title: String(body.title || "").trim(),
    tag: String(body.category || body.tag || "Other").trim() || "Other",
    caption: String(body.description || body.caption || "").trim(),
    isActive: true,
    images: safeImages(body.images),
  };
}

app.get(`${API_PREFIX}/admin/announcements`, async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT id, title, category, urgency, details, date_label, time_label, images, is_active, created_at, updated_at
       FROM announcements
       ORDER BY created_at DESC, id DESC`
    );
    const data = result.rows.map((row) => ({
      id: String(row.id),
      title: row.title || "",
      category: row.category || "Advisory",
      urgency: row.urgency || "",
      body: row.details || "",
      date: row.date_label || "",
      time: row.time_label || "",
      status: row.is_active ? "Published" : "Draft",
      images: Array.isArray(row.images) ? row.images : [],
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
    }));
    return res.json({ success: true, data });
  } catch (error) {
    return apiError(res, "admin-announcements-list", error);
  }
});

app.post(`${API_PREFIX}/admin/announcements/upsert`, async (req, res) => {
  const idRaw = String(req.body?.id || "").trim();
  const id = Number(idRaw);
  const payload = normalizeAnnouncementPayload(req.body);
  if (!payload.title) {
    return res.status(400).json({ success: false, message: "Title is required." });
  }

  try {
    let row;
    if (Number.isFinite(id) && id > 0) {
      const updated = await db.query(
        `UPDATE announcements
         SET title = $2, category = $3, urgency = $4, details = $5, date_label = $6, time_label = $7, images = $8, is_active = $9, updated_at = NOW()
         WHERE id = $1
         RETURNING id, title, category, urgency, details, date_label, time_label, images, is_active, created_at, updated_at`,
        [id, payload.title, payload.category, payload.urgency, payload.details, payload.dateLabel, payload.timeLabel, payload.images, payload.isActive]
      );
      row = updated.rows[0];
      if (!row) {
        return res.status(404).json({ success: false, message: "Announcement not found." });
      }
    } else {
      const created = await db.query(
        `INSERT INTO announcements (title, category, urgency, details, date_label, time_label, images, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, title, category, urgency, details, date_label, time_label, images, is_active, created_at, updated_at`,
        [payload.title, payload.category, payload.urgency, payload.details, payload.dateLabel, payload.timeLabel, payload.images, payload.isActive]
      );
      row = created.rows[0];
    }
    return res.json({
      success: true,
      data: {
        id: String(row.id),
        title: row.title || "",
        category: row.category || "Advisory",
        urgency: row.urgency || "",
        body: row.details || "",
        date: row.date_label || "",
        time: row.time_label || "",
        status: row.is_active ? "Published" : "Draft",
        images: Array.isArray(row.images) ? row.images : [],
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
      },
    });
  } catch (error) {
    return apiError(res, "admin-announcements-upsert", error);
  }
});

app.post(`${API_PREFIX}/admin/announcements/delete`, async (req, res) => {
  const id = Number(String(req.body?.id || "").trim());
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ success: false, message: "Valid id is required." });
  }
  try {
    await db.query(`DELETE FROM announcements WHERE id = $1`, [id]);
    return res.json({ success: true });
  } catch (error) {
    return apiError(res, "admin-announcements-delete", error);
  }
});

app.get(`${API_PREFIX}/admin/lost-found`, async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT id, item_number, date_label, time_label, status, title, tag, caption, images, created_at, updated_at
       FROM lost_found_items
       ORDER BY created_at DESC, id DESC`
    );
    const data = result.rows.map((row) => ({
      id: String(row.id),
      itemNumber: row.item_number || "",
      date: row.date_label || "",
      time: row.time_label || "",
      status: row.status || "Unclaimed",
      title: row.title || "",
      category: row.tag || "Other",
      description: row.caption || "",
      images: Array.isArray(row.images) ? row.images : [],
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
    }));
    return res.json({ success: true, data });
  } catch (error) {
    return apiError(res, "admin-lf-list", error);
  }
});

app.post(`${API_PREFIX}/admin/lost-found/upsert`, async (req, res) => {
  const idRaw = String(req.body?.id || "").trim();
  const id = Number(idRaw);
  const payload = normalizeLostFoundPayload(req.body);
  if (!payload.title) {
    return res.status(400).json({ success: false, message: "Item title is required." });
  }

  try {
    let row;
    if (Number.isFinite(id) && id > 0) {
      const updated = await db.query(
        `UPDATE lost_found_items
         SET item_number = $2, date_label = $3, time_label = $4, status = $5, title = $6, tag = $7, caption = $8, images = $9, updated_at = NOW()
         WHERE id = $1
         RETURNING id, item_number, date_label, time_label, status, title, tag, caption, images, created_at, updated_at`,
        [id, payload.itemNumber, payload.dateLabel, payload.timeLabel, payload.status, payload.title, payload.tag, payload.caption, payload.images]
      );
      row = updated.rows[0];
      if (!row) {
        return res.status(404).json({ success: false, message: "Item not found." });
      }
    } else {
      const itemNumber = payload.itemNumber || `LF-${Date.now().toString().slice(-6)}`;
      const created = await db.query(
        `INSERT INTO lost_found_items (item_number, date_label, time_label, status, title, tag, caption, images, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
         RETURNING id, item_number, date_label, time_label, status, title, tag, caption, images, created_at, updated_at`,
        [itemNumber, payload.dateLabel, payload.timeLabel, payload.status, payload.title, payload.tag, payload.caption, payload.images]
      );
      row = created.rows[0];
    }
    return res.json({
      success: true,
      data: {
        id: String(row.id),
        itemNumber: row.item_number || "",
        date: row.date_label || "",
        time: row.time_label || "",
        status: row.status || "Unclaimed",
        title: row.title || "",
        category: row.tag || "Other",
        description: row.caption || "",
        images: Array.isArray(row.images) ? row.images : [],
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
      },
    });
  } catch (error) {
    return apiError(res, "admin-lf-upsert", error);
  }
});

app.post(`${API_PREFIX}/admin/lost-found/delete`, async (req, res) => {
  const id = Number(String(req.body?.id || "").trim());
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ success: false, message: "Valid id is required." });
  }
  try {
    await db.query(`DELETE FROM lost_found_items WHERE id = $1`, [id]);
    return res.json({ success: true });
  } catch (error) {
    return apiError(res, "admin-lf-delete", error);
  }
});

app.post(`${API_PREFIX}/admin/sync-local`, async (req, res) => {
  const announcements = Array.isArray(req.body?.announcements) ? req.body.announcements : [];
  const lostFound = Array.isArray(req.body?.lostFound) ? req.body.lostFound : [];
  let annInserted = 0;
  let lfInserted = 0;

  try {
    for (const item of announcements) {
      const p = normalizeAnnouncementPayload(item);
      if (!p.title) continue;
      // eslint-disable-next-line no-await-in-loop
      const exists = await db.query(
        `SELECT id FROM announcements WHERE lower(title) = lower($1) AND coalesce(date_label,'') = coalesce($2,'') LIMIT 1`,
        [p.title, p.dateLabel]
      );
      if (exists.rowCount > 0) continue;
      // eslint-disable-next-line no-await-in-loop
      await db.query(
        `INSERT INTO announcements (title, category, urgency, details, date_label, time_label, images, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [p.title, p.category, p.urgency, p.details, p.dateLabel, p.timeLabel, p.images, p.isActive]
      );
      annInserted += 1;
    }

    for (const item of lostFound) {
      const p = normalizeLostFoundPayload(item);
      if (!p.title) continue;
      const itemNumber = p.itemNumber || `LF-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 99)}`;
      // eslint-disable-next-line no-await-in-loop
      const exists = await db.query(
        `SELECT id FROM lost_found_items WHERE item_number = $1 LIMIT 1`,
        [itemNumber]
      );
      if (exists.rowCount > 0) continue;
      // eslint-disable-next-line no-await-in-loop
      await db.query(
        `INSERT INTO lost_found_items (item_number, date_label, time_label, status, title, tag, caption, images, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
        [itemNumber, p.dateLabel, p.timeLabel, p.status, p.title, p.tag, p.caption, p.images]
      );
      lfInserted += 1;
    }

    return res.json({ success: true, data: { annInserted, lfInserted } });
  } catch (error) {
    return apiError(res, "admin-sync-local", error);
  }
});

app.get(`${API_PREFIX}/content/:page`, async (req, res) => {
  const page = String(req.params && req.params.page ? req.params.page : "").trim().toLowerCase();
  if (!page) {
    return res.status(400).json({ success: false, message: "Page is required." });
  }
  try {
    const result = await db.query(
      `SELECT content_key, content_value
       FROM portal_content
       WHERE page_name = $1`,
      [page]
    );
    const data = {};
    result.rows.forEach((row) => {
      data[row.content_key] = row.content_value;
    });
    return res.json({ success: true, page, data });
  } catch (error) {
    return apiError(res, "content-get", error);
  }
});

app.put(`${API_PREFIX}/content/:page`, requireAdminKey, async (req, res) => {
  const page = String(req.params && req.params.page ? req.params.page : "").trim().toLowerCase();
  const content = req.body && typeof req.body === "object" ? req.body.content : null;

  if (!page || !content || typeof content !== "object" || Array.isArray(content)) {
    return res.status(400).json({
      success: false,
      message: "Body must include a content object.",
    });
  }

  const entries = Object.entries(content).filter(([key, value]) => {
    return String(key || "").trim() !== "" && typeof value === "string";
  });

  if (!entries.length) {
    return res.status(400).json({
      success: false,
      message: "No valid content entries to save.",
    });
  }

  try {
    for (const [key, value] of entries) {
      // eslint-disable-next-line no-await-in-loop
      await db.query(
        `INSERT INTO portal_content (page_name, content_key, content_value, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (page_name, content_key)
         DO UPDATE SET content_value = EXCLUDED.content_value, updated_at = NOW()`,
        [page, key, value]
      );
    }
    return res.json({
      success: true,
      message: "Page content updated.",
      page,
      updated: entries.length,
    });
  } catch (error) {
    return apiError(res, "content-put", error);
  }
});

app.post(`${API_PREFIX}/lost-found/claims`, async (req, res) => {
  const email = String(req.body && req.body.email ? req.body.email : "").trim();
  const itemId = Number(req.body && req.body.item_id ? req.body.item_id : 0);
  const claimDetails = String(req.body && req.body.claim_details ? req.body.claim_details : "").trim();

  if (!email || !itemId || !claimDetails) {
    return res.status(400).json({
      success: false,
      message: "email, item_id, and claim_details are required.",
    });
  }

  try {
    const insert = await db.query(
      `INSERT INTO lost_found_claims (email, item_id, claim_details, status)
       VALUES ($1, $2, $3, 'Pending')
       RETURNING id, created_at`,
      [email, itemId, claimDetails]
    );

    return res.status(201).json({
      success: true,
      message: "Claim submitted.",
      data: {
        id: insert.rows[0].id,
        createdAt: insert.rows[0].created_at,
      },
    });
  } catch (error) {
    return apiError(res, "lost-found-claims", error);
  }
});

registerOtpRoutes(app, API_PREFIX);
registerChatRoutes(app, API_PREFIX);
registerChatbot(app, API_PREFIX);
registerAuthRoutes(app, API_PREFIX);
registerRagAdminRoutes(app, API_PREFIX);
registerChatLogAdminRoutes(app, API_PREFIX);

// Serve the portal frontend from the same server so chat pages and API stay aligned.
const publicDir = path.resolve(__dirname, "../public");

function fileExists(filepath) {
  try {
    return fs.existsSync(filepath) && fs.statSync(filepath).isFile();
  } catch (_error) {
    return false;
  }
}

function stripHtmlFromPath(pathname) {
  if (!pathname) return pathname;
  if (/\/index\.html$/i.test(pathname)) return pathname.replace(/\/index\.html$/i, "/");
  if (/\.html$/i.test(pathname)) return pathname.replace(/\.html$/i, "");
  return pathname;
}

app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (req.path.startsWith(API_PREFIX)) return next();

  const chatPath = String(req.path || "").toLowerCase();
  if (chatPath === "/chat" || chatPath === "/chat/" || chatPath.startsWith("/chat/index")) {
    return res.redirect(302, "/preview#dashboard");
  }

  // Keep non-HTML assets (e.g. .css/.js/.png) on normal static handling.
  const extension = path.extname(req.path || "");
  if (extension && extension.toLowerCase() !== ".html") return next();

  // Backward compatibility: redirect old .html URLs to extensionless URLs.
  if (/\.html$/i.test(req.path || "")) {
    const cleanPath = stripHtmlFromPath(req.path || "");
    if (cleanPath && cleanPath !== req.path) {
      const queryIndex = req.originalUrl.indexOf("?");
      const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : "";
      return res.redirect(301, `${cleanPath}${query}`);
    }
  }

  const rawPath = req.path === "/" ? "/index" : req.path.replace(/\/+$/, "");
  const candidates = [`${rawPath}.html`, path.posix.join(rawPath, "index.html")];

  for (const candidate of candidates) {
    const resolved = path.resolve(publicDir, `.${candidate}`);
    if (!resolved.startsWith(publicDir)) continue;
    if (fileExists(resolved)) return res.sendFile(resolved);
  }

  return next();
});

app.use(
  express.static(publicDir, {
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if ([".html", ".css", ".js"].includes(ext)) {
        res.setHeader("Cache-Control", "no-cache, must-revalidate");
      }
    },
  })
);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGIN || "*",
  },
});
registerRealtimeChat(io);
ensureV2Schema().catch((error) => logError("schema-v2-bootstrap", error));

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`OSA API running on http://localhost:${PORT}${API_PREFIX}`);
});

// ── Graceful shutdown (SIGTERM from Render/Docker, SIGINT from Ctrl+C) ──────
function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`[shutdown] ${signal} received — closing server...`);
  httpServer.close(() => {
    // eslint-disable-next-line no-console
    console.log("[shutdown] HTTP server closed. Exiting.");
    process.exit(0);
  });
  // Force-exit if graceful close takes too long (Render gives 30 s before SIGKILL)
  setTimeout(() => {
    // eslint-disable-next-line no-console
    console.error("[shutdown] Forced exit after timeout.");
    process.exit(1);
  }, 25000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

// ── Crash guards — log then exit so Render/Docker auto-restarts the container ─
process.on("uncaughtException", (err) => {
  // eslint-disable-next-line no-console
  console.error("[crash] uncaughtException:", err && (err.stack || err.message || err));
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error("[crash] unhandledRejection:", reason && (reason.stack || reason.message || reason));
  process.exit(1);
});
