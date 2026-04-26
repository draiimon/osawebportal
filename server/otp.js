const crypto = require("crypto");
const db = require("./db");

const OTP_EXPIRY_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const MAX_OTP_SENDS_PER_DAY = Math.max(1, Number(process.env.MAX_OTP_SENDS_PER_DAY || 5));
const BREVO_URL = "https://api.brevo.com/v3/smtp/email";
/**
 * Dev bypass code — when set, entering this code on the verify step issues a
 * chat token immediately, without checking the real OTP. Real OTP emails are
 * still sent normally. Useful for testing end-to-end flows without needing to
 * copy the code from the email each time.
 * Set OTP_DEV_BYPASS_CODE in env vars to enable.
 */
const OTP_DEV_BYPASS_CODE = String(process.env.OTP_DEV_BYPASS_CODE || "").replace(/\D/g, "");

function getAllowedDomain() {
  return String(process.env.OSA_ALLOWED_EMAIL_DOMAIN || "").trim().toLowerCase();
}

function getApiKey() {
  return String(process.env.Brevo_API_KEY || "").trim();
}

function normalizeEmail(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase();
}

function isOtpBypassEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const allowed = String(process.env.OTP_TEST_BYPASS_EMAILS || "")
    .split(",")
    .map((v) => normalizeEmail(v))
    .filter(Boolean);
  return allowed.includes(normalized);
}

function isAllowedStudentEmail(email) {
  const domain = getAllowedDomain();
  if (!domain || domain === "*") return true;
  const at = email.lastIndexOf("@");
  if (at < 1) return false;
  return email.slice(at + 1) === domain;
}

function hashOtp(email, code) {
  const pepper = process.env.OTP_PEPPER || "dev-only-pepper-change-me";
  return crypto.createHmac("sha256", pepper).update(`${email}:${code}`).digest("hex");
}

function generateSixDigitOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function isDevBypassCode(rawOtp) {
  const digits = String(rawOtp || "").replace(/\D/g, "");
  if (!OTP_DEV_BYPASS_CODE || !digits) return false;
  return digits === OTP_DEV_BYPASS_CODE;
}

async function issueChatToken(email) {
  const chatToken = crypto.randomUUID();
  await db.query(
    `INSERT INTO chat_auth_tokens (token, email, expires_at) VALUES ($1, $2, NOW() + INTERVAL '5 minutes')`,
    [chatToken, email]
  );
  return chatToken;
}

async function deleteExpiredForEmail(email) {
  await db.query(`DELETE FROM email_otp_codes WHERE email = $1 AND expires_at < NOW()`, [email]);
}

// Returns { used, limit, allowed }. The quota row is created lazily; we only
// bump it AFTER a successful send so a failed-send does not consume a slot.
async function getDailyOtpQuota(email) {
  const result = await db.query(
    `SELECT count FROM email_otp_daily_quota WHERE email = $1 AND day = CURRENT_DATE`,
    [email]
  );
  const used = result.rows.length ? Number(result.rows[0].count) : 0;
  return { used, limit: MAX_OTP_SENDS_PER_DAY, allowed: used < MAX_OTP_SENDS_PER_DAY };
}

async function incrementDailyOtpQuota(email) {
  await db.query(
    `INSERT INTO email_otp_daily_quota (email, day, count)
     VALUES ($1, CURRENT_DATE, 1)
     ON CONFLICT (email, day) DO UPDATE SET count = email_otp_daily_quota.count + 1`,
    [email]
  );
}

async function sendBrevoEmail(toEmail, otp) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Brevo API key is not configured.");
  }

  const senderEmail = String(process.env.BREVO_SENDER_EMAIL || "").trim();
  if (!senderEmail) {
    throw new Error("BREVO_SENDER_EMAIL is not configured.");
  }

  const senderName = String(process.env.BREVO_SENDER_NAME || "OSA System").trim() || "OSA System";

  const html =
    `<div style="font-family:system-ui,sans-serif;max-width:560px;color:#191412">` +
    `<p style="font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#841a2d;margin:0 0 6px">OSA TRANSACTION GUIDE — EMAIL VERIFICATION</p>` +
    `<p style="font-size:22px;font-weight:800;margin:0 0 20px;letter-spacing:-0.02em">Your one-time verification code</p>` +
    `<p style="font-size:14px;line-height:1.6;margin:0 0 16px;color:#191412">Use the code below to verify your student email and access OSA Chat Support. This code is valid for <strong>5 minutes</strong> and can only be used once.</p>` +
    `<div style="background:#fff8f0;border-left:4px solid #841a2d;padding:20px 24px;margin-bottom:20px;text-align:center">` +
      `<p style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#65574d;margin:0 0 10px">Verification Code</p>` +
      `<p style="font-size:40px;font-weight:800;letter-spacing:0.22em;color:#841a2d;margin:0;font-variant-numeric:tabular-nums">${otp}</p>` +
    `</div>` +
    `<table style="width:100%;border-collapse:collapse;margin-bottom:20px">` +
      `<tr><td style="padding:8px 12px;background:#f5ede0;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#65574d;width:120px">Sent to</td><td style="padding:8px 12px;background:#fffaf3;font-size:14px">${toEmail}</td></tr>` +
      `<tr><td style="padding:8px 12px;background:#f5ede0;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#65574d">Expires</td><td style="padding:8px 12px;background:#fffaf3;font-size:14px">5 minutes from send time</td></tr>` +
    `</table>` +
    `<p style="font-size:12px;color:#65574d;margin-top:4px">If you did not request this code, you can safely ignore this email. Do not share this code with anyone.</p>` +
    `<p style="font-size:12px;color:#65574d;margin-top:8px">This is an automated message from the OSA Transaction Guide Portal.</p>` +
    `</div>`;

  const body = {
    sender: { name: senderName, email: senderEmail },
    to: [{ email: toEmail }],
    subject: "Your OSA Verification Code",
    htmlContent: html,
  };

  const res = await fetch(BREVO_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_e) {
    json = null;
  }

  if (!res.ok) {
    const msg = (json && (json.message || json.error)) || text || `Brevo HTTP ${res.status}`;
    throw new Error(msg);
  }

  return json;
}

function registerOtpRoutes(app, apiPrefix) {
  const { otpSendLimiter, otpVerifyLimiter } = app.locals.limiters || {};

  app.post(`${apiPrefix}/otp/send`, ...[otpSendLimiter].filter(Boolean), async (req, res) => {
    const email = normalizeEmail(req.body && req.body.email);
    const bypassLimits = isOtpBypassEmail(email);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: "Valid email is required." });
    }
    if (!isAllowedStudentEmail(email)) {
      const dom = getAllowedDomain();
      return res.status(400).json({
        success: false,
        message:
          `Secure chat is limited to official EAC Cavite student emails (@${dom}). ` +
          `If you are a visitor or not eligible for campus email, please visit the OSA office during posted hours or see https://www.eac.edu.ph/osa/ for official information.`,
      });
    }

    try {
      await deleteExpiredForEmail(email);

      // Daily cap: reject the 6th+ send in a calendar day.
      const quota = await getDailyOtpQuota(email);
      if (!bypassLimits) {
        if (!quota.allowed) {
          return res.status(429).json({
            success: false,
            code: "OTP_DAILY_LIMIT",
            message:
              `You've already requested ${quota.used} verification codes today ` +
              `(max ${quota.limit}). For your security, please try again tomorrow.`,
            dailyLimit: quota.limit,
            dailyUsed: quota.used,
          });
        }
      }

      const existing = await db.query(
        `SELECT last_sent_at FROM email_otp_codes WHERE email = $1 AND expires_at >= NOW()`,
        [email]
      );

      if (existing.rows.length && !bypassLimits) {
        const lastSent = existing.rows[0].last_sent_at;
        const elapsed = Date.now() - new Date(lastSent).getTime();
        if (elapsed < RESEND_COOLDOWN_MS) {
          const retryAfterSeconds = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
          return res.status(429).json({
            success: false,
            message: `Please wait ${retryAfterSeconds}s before requesting another code.`,
            retryAfterSeconds,
            cooldownSeconds: Math.ceil(RESEND_COOLDOWN_MS / 1000),
          });
        }
      }

      const otp = generateSixDigitOtp();
      const codeHash = hashOtp(email, otp);
      const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

      await db.query(
        `INSERT INTO email_otp_codes (email, code_hash, expires_at, last_sent_at, verify_attempts)
         VALUES ($1, $2, $3, NOW(), 0)
         ON CONFLICT (email) DO UPDATE SET
           code_hash = EXCLUDED.code_hash,
           expires_at = EXCLUDED.expires_at,
           last_sent_at = NOW(),
           verify_attempts = 0`,
        [email, codeHash, expiresAt]
      );

      try {
        await sendBrevoEmail(email, otp);
      } catch (sendErr) {
        await db.query(`DELETE FROM email_otp_codes WHERE email = $1`, [email]);
        // eslint-disable-next-line no-console
        console.error("[otp-send:brevo]", sendErr && (sendErr.stack || sendErr.message || sendErr));
        return res.status(502).json({
          success: false,
          message: "Could not send email right now. Please try again.",
        });
      }

      // Only consume a daily quota slot on a confirmed send.
      let updatedQuota = quota;
      if (!bypassLimits) {
        await incrementDailyOtpQuota(email);
        updatedQuota = await getDailyOtpQuota(email);
      }

      return res.json({
        success: true,
        message: "Verification code sent.",
        cooldownSeconds: Math.ceil(RESEND_COOLDOWN_MS / 1000),
        dailyLimit: bypassLimits ? "bypassed" : updatedQuota.limit,
        dailyUsed: bypassLimits ? 0 : updatedQuota.used,
        dailyRemaining: bypassLimits ? "unlimited" : Math.max(0, updatedQuota.limit - updatedQuota.used),
        testBypass: bypassLimits,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[otp-send]", error && (error.stack || error.message || error));
      return res.status(500).json({
        success: false,
        message: "Could not send verification code. Please try again.",
      });
    }
  });

  app.post(`${apiPrefix}/otp/verify`, ...[otpVerifyLimiter].filter(Boolean), async (req, res) => {
    const email = normalizeEmail(req.body && req.body.email);
    const otpRaw = String(req.body && req.body.otp ? req.body.otp : "").trim();
    const otp = otpRaw.replace(/\D/g, "");

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: "Valid email is required." });
    }
    if (!isAllowedStudentEmail(email)) {
      const dom = getAllowedDomain();
      return res.status(400).json({
        success: false,
        message:
          `Secure chat requires an official @${dom} student email. ` +
          `Visitors should use the public OSA website (https://www.eac.edu.ph/osa/) and visit the office during business hours.`,
      });
    }
    if (isDevBypassCode(otpRaw)) {
      try {
        const chatToken = await issueChatToken(email);
        return res.json({
          success: true,
          verified: true,
          message: "Email verified.",
          chat_token: chatToken,
          email,
        });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("[otp-verify:dev-bypass]", error && (error.stack || error.message || error));
        return res.status(500).json({
          success: false,
          message: "Verification failed. Please try again.",
        });
      }
    }

    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ success: false, message: "Enter the 6-digit code from your email." });
    }

    try {
      await deleteExpiredForEmail(email);

      const rowResult = await db.query(
        `SELECT code_hash, expires_at, verify_attempts FROM email_otp_codes WHERE email = $1`,
        [email]
      );

      if (!rowResult.rows.length) {
        return res.status(400).json({
          success: false,
          message: "No active code for this email. Request a new code.",
        });
      }

      const row = rowResult.rows[0];
      if (new Date(row.expires_at).getTime() < Date.now()) {
        await db.query(`DELETE FROM email_otp_codes WHERE email = $1`, [email]);
        return res.status(400).json({
          success: false,
          message: "That code has expired. Request a new one.",
        });
      }

      if (Number(row.verify_attempts) >= MAX_VERIFY_ATTEMPTS) {
        await db.query(`DELETE FROM email_otp_codes WHERE email = $1`, [email]);
        return res.status(400).json({
          success: false,
          message: "Too many attempts. Request a new code.",
        });
      }

      const expectedHash = row.code_hash;
      const actualHash = hashOtp(email, otp);

      const a = Buffer.from(expectedHash, "hex");
      const b = Buffer.from(actualHash, "hex");
      const match =
        a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);

      if (!match) {
        const upd = await db.query(
          `UPDATE email_otp_codes SET verify_attempts = verify_attempts + 1 WHERE email = $1 RETURNING verify_attempts`,
          [email]
        );
        const attempts = Number(upd.rows[0].verify_attempts);
        if (attempts >= MAX_VERIFY_ATTEMPTS) {
          await db.query(`DELETE FROM email_otp_codes WHERE email = $1`, [email]);
          return res.status(400).json({
            success: false,
            message: "Too many attempts. Request a new code.",
          });
        }
        return res.status(400).json({
          success: false,
          message: "Incorrect code. Try again.",
        });
      }

      await db.query(`DELETE FROM email_otp_codes WHERE email = $1`, [email]);

      const chatToken = await issueChatToken(email);

      return res.json({
        success: true,
        verified: true,
        message: "Email verified.",
        chat_token: chatToken,
        email,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[otp-verify]", error && (error.stack || error.message || error));
      return res.status(500).json({
        success: false,
        message: "Verification failed. Please try again.",
      });
    }
  });
}

module.exports = { registerOtpRoutes, isOtpBypassEmail };
