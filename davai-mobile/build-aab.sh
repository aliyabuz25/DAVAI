#!/usr/bin/env bash
# =============================================================================
#  DAVAI — AAB (Android App Bundle) Build Script
#  Reads config from connection.json and produces a signed release AAB
#  Output: dist/DAVAI-v1.0.0.aab  (ready for Google Play Console upload)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${CYAN}[DAVAI]${NC} $1"; }
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

echo ""
echo "========================================"
echo "  DAVAI Mobile — AAB Builder"
echo "  (Google Play Store)"
echo "========================================"
echo ""

# ── 1. Read connection.json ───────────────────────────────────────────────────
log "Reading connection.json..."
if [ ! -f connection.json ]; then
  err "connection.json not found."
fi

APP_ID=$(python3 -c "import json; d=json.load(open('connection.json')); print(d['appId'])")
APP_NAME=$(python3 -c "import json; d=json.load(open('connection.json')); print(d['appName'])")
VERSION_NAME=$(python3 -c "import json; d=json.load(open('connection.json')); print(d['versionName'])")
VERSION_CODE=$(python3 -c "import json; d=json.load(open('connection.json')); print(d['versionCode'])")
BACKEND_URL=$(python3 -c "import json; d=json.load(open('connection.json')); print(d.get('backendUrl',''))")
KEYSTORE_FILE=$(python3 -c "import json; d=json.load(open('connection.json')); print(d.get('keystoreFile','davai-release.keystore'))")
KEYSTORE_ALIAS=$(python3 -c "import json; d=json.load(open('connection.json')); print(d.get('keystoreAlias','davai-key'))")
STORE_PW=$(python3 -c "import json; d=json.load(open('connection.json')); print(d['signingConfig']['storePassword'])")
KEY_PW=$(python3 -c "import json; d=json.load(open('connection.json')); print(d['signingConfig']['keyPassword'])")

ok "App: $APP_NAME ($APP_ID) v$VERSION_NAME ($VERSION_CODE)"
log "Backend: $BACKEND_URL"
log "Build type: AAB (Google Play)"

# ── 2. Check / setup Android SDK ─────────────────────────────────────────────
ANDROID_SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_HOME="$ANDROID_SDK"
export ANDROID_SDK_ROOT="$ANDROID_SDK"
export PATH="$ANDROID_SDK/platform-tools:$ANDROID_SDK/cmdline-tools/latest/bin:$PATH"

log "Checking Android SDK at $ANDROID_SDK..."

SDKMANAGER="$ANDROID_SDK/cmdline-tools/latest/bin/sdkmanager"
if [ ! -f "$SDKMANAGER" ]; then
  warn "sdkmanager not found. Installing cmdline-tools..."
  TOOLS_ZIP="/tmp/commandlinetools.zip"
  curl -sL "https://dl.google.com/android/repository/commandlinetools-mac-11076708_latest.zip" -o "$TOOLS_ZIP"
  mkdir -p "$ANDROID_SDK/cmdline-tools"
  unzip -q "$TOOLS_ZIP" -d "/tmp/cmdtools_extract"
  mv "/tmp/cmdtools_extract/cmdline-tools" "$ANDROID_SDK/cmdline-tools/latest"
  rm "$TOOLS_ZIP"
  ok "sdkmanager installed"
fi

log "Installing Android SDK packages (platform 34, build-tools 34)..."
yes | "$SDKMANAGER" --licenses > /dev/null 2>&1 || true
"$SDKMANAGER" "platform-tools" "platforms;android-34" "build-tools;34.0.0" > /dev/null 2>&1
ok "Android SDK packages ready"

# ── 3. Check Java ─────────────────────────────────────────────────────────────
log "Checking Java..."
if ! java -version > /dev/null 2>&1; then
  err "Java not found. Install with: brew install openjdk@17"
fi
JAVA_VER=$(java -version 2>&1 | head -1)
ok "Java: $JAVA_VER"

# ── 4. Update environment with backend URL ────────────────────────────────────
log "Writing production environment..."
cat > src/environments/environment.prod.ts << EOF
export const environment = {
  production: true,
  apiUrl: '$BACKEND_URL',
};
EOF
ok "environment.prod.ts → $BACKEND_URL"

# ── 5. Update capacitor.config ────────────────────────────────────────────────
log "Configuring Capacitor..."
cat > capacitor.config.ts << EOF
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: '$APP_ID',
  appName: '$APP_NAME',
  webDir: 'www',
  server: {
    androidScheme: 'https'
  }
};

export default config;
EOF

# ── 6. Install npm deps ───────────────────────────────────────────────────────
log "Installing npm dependencies..."
npm install --silent
ok "npm dependencies ready"

# ── 7. Build Angular (production) ────────────────────────────────────────────
log "Building Angular app (production)..."
npx ng build --configuration production
ok "Angular build complete → www/"

# ── 8. Add / sync Android platform ───────────────────────────────────────────
log "Syncing Capacitor Android platform..."
if [ ! -d android ]; then
  npx cap add android
  ok "Android platform added"
fi
npx cap sync android
ok "Capacitor sync complete"

# ── 9. Patch version in build.gradle ─────────────────────────────────────────
log "Patching build.gradle → v$VERSION_NAME ($VERSION_CODE)..."
GRADLE_FILE="android/app/build.gradle"
if [ -f "$GRADLE_FILE" ]; then
  sed -i '' "s/versionCode .*/versionCode $VERSION_CODE/" "$GRADLE_FILE"
  sed -i '' "s/versionName .*/versionName \"$VERSION_NAME\"/" "$GRADLE_FILE"
  ok "build.gradle version patched"
fi

# ── 10. Keystore ──────────────────────────────────────────────────────────────
if [ ! -f "$KEYSTORE_FILE" ]; then
  warn "Keystore not found — generating at $KEYSTORE_FILE"
  warn "IMPORTANT: Back up this keystore — you need it for every Play Store update!"
  keytool -genkeypair \
    -alias "$KEYSTORE_ALIAS" \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -keystore "$KEYSTORE_FILE" \
    -storepass "$STORE_PW" \
    -keypass "$KEY_PW" \
    -dname "CN=$APP_NAME, OU=Mobile, O=$APP_NAME, L=Baku, S=Baku, C=AZ" \
    2>/dev/null
  ok "Keystore generated: $KEYSTORE_FILE"
else
  ok "Using existing keystore: $KEYSTORE_FILE"
fi

# Write signing config into build.gradle
log "Configuring signing in build.gradle..."
KEYSTORE_ABS="$(cd "$(dirname "$KEYSTORE_FILE")" && pwd)/$(basename "$KEYSTORE_FILE")"
python3 - << PYEOF
import re

with open('$GRADLE_FILE', 'r') as f:
    content = f.read()

signing_block = """
    signingConfigs {
        release {
            storeFile file('$KEYSTORE_ABS')
            storePassword '$STORE_PW'
            keyAlias '$KEYSTORE_ALIAS'
            keyPassword '$KEY_PW'
        }
    }
"""

if 'signingConfigs' not in content:
    content = content.replace('buildTypes {', signing_block + '\n    buildTypes {')

content = re.sub(
    r'(release \{[^}]*)\}',
    r'\1    signingConfig signingConfigs.release\n        }',
    content,
    count=1
)

with open('$GRADLE_FILE', 'w') as f:
    f.write(content)
PYEOF
ok "Signing config written"

# ── 11. Build AAB ─────────────────────────────────────────────────────────────
log "Building release AAB (Android App Bundle)..."
log "This may take 3-8 minutes on first run (Gradle downloads)..."
cd android
chmod +x gradlew
export GRADLE_OPTS="-Dorg.gradle.daemon=false -Xmx2g"
./gradlew bundleRelease --quiet
cd ..

AAB_PATH="android/app/build/outputs/bundle/release/app-release.aab"
if [ ! -f "$AAB_PATH" ]; then
  err "AAB not found. Check android/app/build/outputs/bundle/"
fi

AAB_SIZE=$(du -sh "$AAB_PATH" | cut -f1)
ok "AAB built: $AAB_PATH ($AAB_SIZE)"

# ── 12. Copy to output ────────────────────────────────────────────────────────
OUT_DIR="dist"
mkdir -p "$OUT_DIR"
FINAL_AAB="$OUT_DIR/${APP_NAME// /-}-v${VERSION_NAME}.aab"
cp "$AAB_PATH" "$FINAL_AAB"

# ── 13. Verify with bundletool if available ───────────────────────────────────
BUNDLETOOL=$(find "$HOME" /usr/local /opt/homebrew -name "bundletool*.jar" 2>/dev/null | head -1)
if [ -n "$BUNDLETOOL" ]; then
  log "Verifying AAB with bundletool..."
  java -jar "$BUNDLETOOL" validate --bundle="$FINAL_AAB" 2>/dev/null && ok "AAB validation passed"
fi

echo ""
echo "========================================"
echo -e "  ${GREEN}AAB Ready for Google Play!${NC}"
echo "========================================"
echo "  File    : $FINAL_AAB"
echo "  Size    : $AAB_SIZE"
echo "  App ID  : $APP_ID"
echo "  Version : $VERSION_NAME ($VERSION_CODE)"
echo ""
echo "  Next steps:"
echo "  1. Go to play.google.com/console"
echo "  2. Create app → Production → Create new release"
echo "  3. Upload: $FINAL_AAB"
echo "  4. Fill release notes and submit for review"
echo ""
echo "  IMPORTANT: Back up your keystore!"
echo "  Keystore : $KEYSTORE_FILE"
echo "  Alias    : $KEYSTORE_ALIAS"
echo "========================================"
echo ""
