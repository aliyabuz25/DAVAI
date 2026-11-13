#!/usr/bin/env bash
# ============================================================
#  DAVAI — Start All Services
#  Web server: http://localhost:5050
#  App backend: http://localhost:3000
# ============================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
log() { echo -e "${CYAN}[DAVAI]${NC} $1"; }
ok()  { echo -e "${GREEN}[OK]${NC} $1"; }

echo ""
echo "========================================"
echo "  DAVAI — Starting Services"
echo "========================================"

# Kill existing
lsof -ti:5050 | xargs kill -9 2>/dev/null || true
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
sleep 1

# Start proxy (web + admin)
log "Starting web server on :5050..."
cd "$SCRIPT_DIR"
nohup python3 -u proxy.py </dev/null >/tmp/davai-proxy.log 2>&1 &
PROXY_PID=$!

# Ensure backend dependencies
if [ ! -d "$SCRIPT_DIR/davai-mobile/backend/node_modules" ]; then
  log "Installing Node backend dependencies..."
  (cd "$SCRIPT_DIR/davai-mobile/backend" && npm install --silent)
fi

# Start Node backend
log "Starting app backend on :3000..."
cd "$SCRIPT_DIR/davai-mobile/backend"
nohup node server.js </dev/null >/tmp/davai-backend.log 2>&1 &
BACKEND_PID=$!

disown -a 2>/dev/null || true

# Wait for services to be healthy (up to 6s)
WEB="000"
API="000"
for i in {1..12}; do
  sleep 0.5
  WEB=$(/usr/bin/curl -s -o /dev/null -w "%{http_code}" http://localhost:5050/health 2>/dev/null || echo "000")
  API=$(/usr/bin/curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health 2>/dev/null || echo "000")
  if [ "$WEB" = "200" ] && [ "$API" = "200" ]; then
    break
  fi
done

echo ""
ok "Web server  : http://localhost:5050  (HTTP $WEB)"
ok "Admin panel : http://localhost:5050/admin/"
ok "App backend : http://localhost:3000  (HTTP $API)"
echo ""
echo "  Logs:"
echo "    tail -f /tmp/davai-proxy.log"
echo "    tail -f /tmp/davai-backend.log"
echo ""
echo "  Stop:"
echo "    kill $PROXY_PID $BACKEND_PID"
echo "========================================"
echo ""
