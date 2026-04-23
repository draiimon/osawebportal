const bcrypt = require("bcryptjs");
const db = require("../db");
const { signAuthToken, requireAuth } = require("./jwt");

const SALT_ROUNDS = Math.max(8, Number(process.env.BCRYPT_SALT_ROUNDS || 10));
const ALLOWED_DOMAIN = String(process.env.OSA_ALLOWED_EMAIL_DOMAIN || "").trim().toLowerCase();

function sanitizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function emailAllowedForRole(email, role) {
  if (String(role || "").toUpperCase() === "ADMIN") return true;
  if (!ALLOWED_DOMAIN) return true;
  if (ALLOWED_DOMAIN === "*" || ALLOWED_DOMAIN.toLowerCase() === "any") return true;
  return email.endsWith(`@${ALLOWED_DOMAIN}`);
}

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    is_verified: user.is_verified,
    created_at: user.created_at,
  };
}

function registerAuthRoutes(app, apiPrefix) {
  app.post(`${apiPrefix}/auth/register`, async (req, res) => {
    const email = sanitizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const name = String(req.body?.name || "").trim();
    const role = String(req.body?.role || "STUDENT").trim().toUpperCase();

    if (!validEmail(email) || !name || password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Provide valid name, email, and password (min 8 chars).",
      });
    }
    if (!["STUDENT", "ADMIN"].includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role." });
    }
    if (!emailAllowedForRole(email, role)) {
      return res.status(400).json({
        success: false,
        message: `Only official @${ALLOWED_DOMAIN} student emails are allowed.`,
      });
    }

    try {
      const existing = await db.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [email]);
      if (existing.rowCount > 0) {
        return res.status(409).json({ success: false, message: "Email already registered." });
      }

      const hash = await bcrypt.hash(password, SALT_ROUNDS);
      const created = await db.query(
        `INSERT INTO users (email, name, role, password_hash, is_verified)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, name, role, is_verified, created_at`,
        [email, name, role, hash, role === "ADMIN"]
      );

      return res.status(201).json({
        success: true,
        user: toPublicUser(created.rows[0]),
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[auth/register]", error?.stack || error?.message || error);
      return res.status(500).json({ success: false, message: "Registration failed." });
    }
  });

  app.post(`${apiPrefix}/auth/login`, async (req, res) => {
    const email = sanitizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    if (!validEmail(email) || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    try {
      const result = await db.query(
        `SELECT id, email, name, role, is_verified, created_at, password_hash
         FROM users
         WHERE email = $1
         LIMIT 1`,
        [email]
      );
      const user = result.rows[0];
      if (!user || !user.password_hash) {
        return res.status(401).json({ success: false, message: "Invalid credentials." });
      }

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) {
        return res.status(401).json({ success: false, message: "Invalid credentials." });
      }

      const token = signAuthToken({
        sub: user.id,
        email: user.email,
        role: user.role,
      });

      return res.json({
        success: true,
        token,
        user: toPublicUser(user),
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[auth/login]", error?.stack || error?.message || error);
      return res.status(500).json({ success: false, message: "Login failed." });
    }
  });

  app.get(`${apiPrefix}/auth/me`, requireAuth, async (req, res) => {
    try {
      const id = String(req.user?.sub || "");
      const result = await db.query(
        `SELECT id, email, name, role, is_verified, created_at
         FROM users
         WHERE id = $1
         LIMIT 1`,
        [id]
      );
      const user = result.rows[0];
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found." });
      }
      return res.json({ success: true, user: toPublicUser(user) });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[auth/me]", error?.stack || error?.message || error);
      return res.status(500).json({ success: false, message: "Failed to fetch profile." });
    }
  });

  // Backward-compatible admin login endpoint used by existing admin page.
  app.post("/api/admin/login.php", async (req, res) => {
    const email = sanitizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    try {
      const result = await db.query(
        `SELECT id, email, name, role, password_hash
         FROM users
         WHERE email = $1
         LIMIT 1`,
        [email]
      );
      const user = result.rows[0];
      if (!user || user.role !== "ADMIN" || !user.password_hash) {
        return res.status(401).json({ success: false, message: "Invalid credentials." });
      }
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) {
        return res.status(401).json({ success: false, message: "Invalid credentials." });
      }

      const token = signAuthToken({
        sub: user.id,
        email: user.email,
        role: user.role,
      });

      return res.json({
        success: true,
        token,
        name: user.name,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[auth/admin-login]", error?.stack || error?.message || error);
      return res.status(500).json({ success: false, message: "Login failed." });
    }
  });
}

module.exports = { registerAuthRoutes };
