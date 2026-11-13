#!/usr/bin/env bash
# =============================================================================
#  DAVAI — APK Build Script
#  Reads config from connection.json and produces a signed release APK
#  Output: android/app/build/outputs/apk/release/app-release.apk
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
echo "  DAVAI Mobile — APK Builder"
echo "========================================"
echo ""

# ── 1. Read connection.json ───────────────────────────────────────────────────
log "Reading connection.json..."
if [ ! -f connection.json ]; then
  err "connection.json not found. Copy connection.json.example and fill in your values."
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

# Accept licenses and install required packages
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
log "Patching build.gradle with version $VERSION_NAME ($VERSION_CODE)..."
GRADLE_FILE="android/app/build.gradle"
if [ -f "$GRADLE_FILE" ]; then
  sed -i '' "s/versionCode .*/versionCode $VERSION_CODE/" "$GRADLE_FILE"
  sed -i '' "s/versionName .*/versionName \"$VERSION_NAME\"/" "$GRADLE_FILE"
  ok "build.gradle patched"
fi

# ── 10. Keystore ──────────────────────────────────────────────────────────────
if [ ! -f "$KEYSTORE_FILE" ]; then
  warn "Keystore not found — generating a new one at $KEYSTORE_FILE"
  warn "For Play Store: use the same keystore every time (back it up!)"
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

# Insert signingConfigs before buildTypes if not present
if 'signingConfigs' not in content:
    content = content.replace('buildTypes {', signing_block + '\n    buildTypes {')

# Set release buildType to use signingConfig
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

# ── 11. Build APK ─────────────────────────────────────────────────────────────
log "Building release APK..."
cd android
chmod +x gradlew
export GRADLE_OPTS="-Dorg.gradle.daemon=false -Xmx2g"
./gradlew assembleRelease --quiet
cd ..

APK_PATH="android/app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$APK_PATH" ]; then
  err "APK not found at expected path. Check android/app/build/outputs/"
fi

APK_SIZE=$(du -sh "$APK_PATH" | cut -f1)
ok "APK built: $APK_PATH ($APK_SIZE)"

# ── 12. Copy to output ────────────────────────────────────────────────────────
OUT_DIR="dist"
mkdir -p "$OUT_DIR"
FINAL_APK="$OUT_DIR/${APP_NAME// /-}-v${VERSION_NAME}.apk"
cp "$APK_PATH" "$FINAL_APK"

echo ""
echo "========================================"
echo -e "  ${GREEN}APK Ready!${NC}"
echo "========================================"
echo "  File : $FINAL_APK"
echo "  Size : $APK_SIZE"
echo "  ID   : $APP_ID"
echo "  Ver  : $VERSION_NAME ($VERSION_CODE)"
echo ""
echo "  Install on device:"
echo "  adb install -r $FINAL_APK"
echo "========================================"
echo ""
