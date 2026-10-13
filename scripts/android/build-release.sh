#!/usr/bin/env bash
# Builds and signs both Android releases on the release machine, from one phone build:
#   openGym-<version>.apk   the sideloaded APK (GitHub, opengym.ch): updates itself
#   openGym-<version>.aab   the Google Play bundle: Play updates it
# Both carry the 240 px animations built in (the box-free set, quality/240); the Play bundle also
# carries the sharper ones as on-demand Play asset packs (scripts/android/make-asset-packs.mjs:
# every quality above 240 whose folder exists), which Google Play delivers when someone picks
# them. These animations go into the packages and nowhere else (Gym visual licence, Part B), which
# is why this runs here and not in CI; the pack modules are taken out of the project again at the
# end. Same key for both: a phone can move from the APK to Google Play and keep its data, as long
# as Play App Signing uses this key too (docs/APP_STORES.md).
#
# Usage: scripts/android/build-release.sh <keystore> <password-file> <alias-file> [out-dir]
#   APP_MEDIA_DIR        the built-in animations, default /mnt/backup-hdd/opengym-media/quality/240
#   VITE_BUILTIN_CLIP_PX their size, default 240
#   PACK_SRC_ROOT        the quality folders the packs come from, default .../opengym-media/quality
#   NO_PACKS=1           a Play bundle without asset packs
set -euo pipefail

KS=${1:?keystore}; PASS=${2:?file with the keystore password}; ALIAS=$(cat "${3:?file with the key alias}")
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT=${4:-$PWD}
export APP_MEDIA_DIR=${APP_MEDIA_DIR:-/mnt/backup-hdd/opengym-media/quality/240}
export VITE_BUILTIN_CLIP_PX=${VITE_BUILTIN_CLIP_PX:-240}
export VITE_CLIP_EXT=webp
PACK_SRC_ROOT=${PACK_SRC_ROOT:-/mnt/backup-hdd/opengym-media/quality}
: "${ANDROID_HOME:?set ANDROID_HOME}"
BT=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)

cd "$ROOT/frontend"
VER=$(node -p "require('./package.json').version")
GRADLE_VER=$(sed -n 's/.*versionName "\(.*\)"/\1/p' android/app/build.gradle)
[ "$VER" = "$GRADLE_VER" ] || { echo "package.json says $VER, build.gradle says $GRADLE_VER" >&2; exit 1; }

npm run build:mobile
if [ -z "${NO_PACKS:-}" ]; then
  trap 'node "$ROOT/scripts/android/make-asset-packs.mjs" --clean' EXIT
  node "$ROOT/scripts/android/make-asset-packs.mjs" --builtin "$VITE_BUILTIN_CLIP_PX" --src-root "$PACK_SRC_ROOT"
fi
(cd android && ./gradlew --no-daemon clean assembleSideloadRelease bundlePlayRelease)

APK_IN=android/app/build/outputs/apk/sideload/release/app-sideload-release-unsigned.apk
AAB_IN=android/app/build/outputs/bundle/playRelease/app-play-release.aab

"$BT/zipalign" -f -p 4 "$APK_IN" "$OUT/aligned.apk"
"$BT/apksigner" sign --ks "$KS" --ks-pass "file:$PASS" --ks-key-alias "$ALIAS" \
  --out "$OUT/openGym-$VER.apk" "$OUT/aligned.apk"
rm -f "$OUT/aligned.apk" "$OUT/openGym-$VER.apk.idsig"
"$BT/apksigner" verify --print-certs "$OUT/openGym-$VER.apk" | grep -i "SHA-256"
(cd "$OUT" && sha256sum "openGym-$VER.apk" > "openGym-$VER.apk.sha256")

# An app bundle is signed like a jar; Play checks it with the upload key and re-signs the APKs
# it builds from it with the app signing key.
cp "$AAB_IN" "$OUT/openGym-$VER.aab"
jarsigner -keystore "$KS" -storepass:file "$PASS" -keypass:file "$PASS" \
  -sigalg SHA256withRSA -digestalg SHA-256 "$OUT/openGym-$VER.aab" "$ALIAS" >/dev/null
jarsigner -verify "$OUT/openGym-$VER.aab" | grep -q "jar verified" || { echo "the bundle did not verify" >&2; exit 1; }

ls -la "$OUT/openGym-$VER.apk" "$OUT/openGym-$VER.aab"
# Google Play's limits: 500 MB for the base module, 1.5 GB per asset pack (the packs are split
# below that by make-asset-packs.mjs). The base is what the bundle holds outside the packs.
BASE=$(unzip -l "$OUT/openGym-$VER.aab" | awk '$4 != "" && $4 !~ /^anim_/ {s+=$1} END {print s}')
echo "base module: $((BASE / 1024 / 1024)) MB (Play allows 500 MB)"
[ "$BASE" -lt $((500 * 1024 * 1024)) ] || { echo "the base module is over Play's 500 MB" >&2; exit 1; }
