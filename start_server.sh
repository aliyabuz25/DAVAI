#!/usr/bin/env bash
# ============================================================
#  DAVAI — Start All Integrated Services
#  Web & Admin Server : http://localhost:5050/admin/
#  Mobile App Backend : http://localhost:3000/
# ============================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${CYAN}[DAVAI]${NC} $1"; }
ok()  { echo -e "${GREEN}[OK]${NC} $1"; }
warn(){ echo -e "${YELLOW}[WARN]${NC} $1"; }
err() { echo -e "${RED}[ERR]${NC} $1"; }

echo ""
echo "============================================================"
echo "  DAVAI — Starting Integrated Backend & Admin Services"
echo "============================================================"

# Kill any existing processes on ports 5050 and 3000
lsof -ti:5050 | xargs kill -9 2>/dev/null || true
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
sleep 1

# Locate mobile backend
BACKEND_DIR=""
if [ -d "$SCRIPT_DIR/davai-mobile/backend" ]; then
  BACKEND_DIR="$SCRIPT_DIR/davai-mobile/backend"
elif [ -d "$SCRIPT_DIR/../davai-mobile/backend" ]; then
  BACKEND_DIR="$SCRIPT_DIR/../davai-mobile/backend"
elif [ -d "/Users/ali_new/Desktop/davai-mobile/backend" ]; then
  BACKEND_DIR="/Users/ali_new/Desktop/davai-mobile/backend"
fi

if [ -z "$BACKEND_DIR" ]; then
  err "Could not locate davai-mobile/backend directory!"
  exit 1
fi

# Start Python Proxy + Admin server
log "Starting Web & Admin Server on :5050..."
cd "$SCRIPT_DIR"
(nohup python3 -u proxy.py < /dev/null > /tmp/davai-proxy.log 2>&1 &)
sleep 1
PROXY_PID=$(lsof -ti:5050 | head -n1 || echo "")

# Start Node Mobile Backend
log "Starting Mobile App Backend on :3000..."
cd "$BACKEND_DIR"
(nohup node server.js < /dev/null > /tmp/davai-backend.log 2>&1 &)
sleep 1
BACKEND_PID=$(lsof -ti:3000 | head -n1 || echo "")

sleep 2

# Verify services
WEB=$(/usr/bin/curl -s -o /dev/null -w "%{http_code}" http://localhost:5050/health 2>/dev/null || echo "000")
API=$(/usr/bin/curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health 2>/dev/null || echo "000")

echo ""
if [ "$WEB" = "200" ]; then
  ok "Web Server & Admin Panel : http://localhost:5050/admin/"
else
  warn "Web Server returned HTTP $WEB (check /tmp/davai-proxy.log)"
fi

if [ "$API" = "200" ]; then
  ok "Mobile App Backend       : http://localhost:3000/health"
else
  warn "App Backend returned HTTP $API (check /tmp/davai-backend.log)"
fi

echo ""
echo "  Shared Database : $BACKEND_DIR/data/davai.db"
echo "  Logs:"
echo "    tail -f /tmp/davai-proxy.log"
echo "    tail -f /tmp/davai-backend.log"
echo ""
echo "  To stop all services:"
echo "    kill $PROXY_PID $BACKEND_PID"
echo "============================================================"
echo ""
