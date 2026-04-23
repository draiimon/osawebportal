const crypto = require("crypto");

function buildCacheKey(parts) {
  const joined = JSON.stringify(parts || {});
  return crypto.createHash("sha256").update(joined).digest("hex");
}

module.exports = { buildCacheKey };
