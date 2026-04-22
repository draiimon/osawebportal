require("dotenv").config();

const express = require("express");
const cors = require("cors");
const db = require("./db");

const app = express();
const PORT = Number(process.env.API_PORT || 8787);
const API_PREFIX = "/api/v1";

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.json({
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
      `${API_PREFIX}/lost-found/claims`,
      `${API_PREFIX}/content/:page`,
      `${API_PREFIX}/health`,
    ],
  });
});

app.get(`${API_PREFIX}/health`, async (_req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ ok: true, service: "osa-api", db: "connected" });
  } catch (error) {
    res.status(500).json({ ok: false, service: "osa-api", db: "down", error: error.message });
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
    res.status(500).json({ success: false, message: "Failed to load announcements.", error: error.message });
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
    res.status(500).json({ success: false, message: "Failed to load lost-and-found items.", error: error.message });
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
    return res.status(500).json({
      success: false,
      message: "Failed to load page content.",
      error: error.message,
    });
  }
});

app.put(`${API_PREFIX}/content/:page`, async (req, res) => {
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
    return res.status(500).json({
      success: false,
      message: "Failed to update page content.",
      error: error.message,
    });
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
    return res.status(500).json({
      success: false,
      message: "Failed to submit claim.",
      error: error.message,
    });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`OSA API running on http://localhost:${PORT}${API_PREFIX}`);
});
