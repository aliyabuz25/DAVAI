#!/bin/sh
set -e

echo "[DAVAI] Initializing production container..."

# Ensure persistent mount directories exist
mkdir -p /app/data /app/uploads

# Ensure SQLite file has write access
if [ -f "/app/data/davai.db" ]; then
  chmod 666 /app/data/davai.db* 2>/dev/null || true
fi

# Export internal database path for persistent volume
export DAVAI_DB_PATH="/app/data/davai.db"
export DATA_DIR="/app/data"
export NODE_PORT="3000"

echo "[DAVAI] Starting Node.js mobile backend on 127.0.0.1:3000..."
cd /app/davai-mobile/backend
node server.js &
NODE_PID=$!

echo "[DAVAI] Waiting for Node.js backend readiness..."
for i in $(seq 1 30); do
  if curl -s http://127.0.0.1:3000/health >/dev/null 2>&1; then
    echo "[DAVAI] Node.js backend is active and healthy!"
    break
  fi
  sleep 0.5
done

echo "[DAVAI] Starting Web, Admin & Reverse-Proxy on port ${PORT:-4320}..."
cd /app
exec python3 -u proxy.py
