const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL || "";
const sslEnabled = String(process.env.DB_SSL || "").toLowerCase() === "true";

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: sslEnabled ? { rejectUnauthorized: false } : false,
    })
  : new Pool({
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME || "admin",
      user: process.env.DB_USER || "postgres",
      password: process.env.DB_PASSWORD || "",
      ssl: sslEnabled ? { rejectUnauthorized: false } : false,
    });

module.exports = {
  query(text, params) {
    return pool.query(text, params);
  },
  pool,
};
