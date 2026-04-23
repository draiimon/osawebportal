const jwt = require("jsonwebtoken");

const JWT_SECRET = String(process.env.JWT_SECRET || "dev-local-jwt-secret").trim();
const JWT_EXPIRES_IN = String(process.env.JWT_EXPIRES_IN || "8h").trim();

function signAuthToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyAuthToken(token) {
  return jwt.verify(String(token || ""), JWT_SECRET);
}

function requireAuth(req, res, next) {
  try {
    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) {
      return res.status(401).json({ success: false, message: "Missing bearer token." });
    }
    const decoded = verifyAuthToken(token);
    req.user = decoded;
    return next();
  } catch (_error) {
    return res.status(401).json({ success: false, message: "Invalid or expired token." });
  }
}

function requireRole(...roles) {
  const allowed = roles.map((v) => String(v || "").toUpperCase());
  return (req, res, next) => {
    const role = String((req.user && req.user.role) || "").toUpperCase();
    if (!role || !allowed.includes(role)) {
      return res.status(403).json({ success: false, message: "Forbidden." });
    }
    return next();
  };
}

module.exports = {
  signAuthToken,
  verifyAuthToken,
  requireAuth,
  requireRole,
};
