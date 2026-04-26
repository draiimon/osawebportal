#!/bin/sh
set -e

export API_PORT="${PORT:-10000}"

echo "[startup] Applying database schema and seed..."
node server/run-sql.js

echo "[startup] Starting OSA API on port $API_PORT..."
exec node server/index.js
