require("dotenv").config();

const fs = require("fs");
const path = require("path");
const db = require("./db");

async function runFile(fileName) {
  const filePath = path.resolve(__dirname, fileName);
  const sql = fs.readFileSync(filePath, "utf8");
  await db.query(sql);
  // eslint-disable-next-line no-console
  console.log("Applied:", fileName);
}

async function main() {
  try {
    await runFile("schema.sql");
    await runFile("seed.sql");
    // eslint-disable-next-line no-console
    console.log("Database schema + seed completed.");
    await db.pool.end();
    process.exit(0);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("DB setup failed:", error.message);
    try {
      await db.pool.end();
    } catch (_e) {
      // Ignore close errors.
    }
    process.exit(1);
  }
}

main();
