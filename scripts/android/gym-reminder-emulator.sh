#!/usr/bin/env bash
# Proves the gym reminder (#614) on the Android emulator: a gym is saved through the app's own
# plugin, the emulator's GPS is moved far away and then into the gym, and the notification has to
# show up in the shade. Nothing here touches a real device or the network.
#
#   scripts/android/gym-reminder-emulator.sh <debug apk>
#
# Needs a running emulator (adb devices) with the debug build's WebView debuggable, Node 22 and
# the CDP driver (CDP=/root/homelab/scripts/android-repro/cdp.mjs by default). Exits 0 when the
# notification fired, 1 when it did not within the time allowed.
set -euo pipefail
APK=${1:?debug apk}
ADB=${ADB:-/opt/android-sdk/platform-tools/adb}
CDP=${CDP:-/root/homelab/scripts/android-repro/cdp.mjs}
PKG=${PKG:-ch.duartesantos.opengym.test}
# A gym in Zurich, and a point 5 km away.
LAT=47.3769; LNG=8.5417
FAR_LAT=47.4200; FAR_LNG=8.5900
cdp() { PKG=$PKG node --experimental-websocket "$CDP" "$@"; }

$ADB install -r -g "$APK" >/dev/null
for p in ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION ACCESS_BACKGROUND_LOCATION POST_NOTIFICATIONS; do
  $ADB shell pm grant "$PKG" "android.permission.$p" 2>/dev/null || true
done
$ADB shell cmd location set-location-enabled true || true
$ADB shell cmd notification post -S bigtext -t clear x x >/dev/null 2>&1 || true
$ADB shell cmd notification cancel_all "$PKG" >/dev/null 2>&1 || true

echo "== far away"
$ADB emu geo fix $FAR_LNG $FAR_LAT >/dev/null
$ADB shell am start -n "$PKG/ch.duartesantos.opengym.MainActivity" >/dev/null
sleep 12

echo "== save a gym through the plugin (as Settings does)"
cdp eval "(async () => { const P = window.Capacitor.Plugins.GymReminder;
  await P.status({ trainedOn: '2000-01-01', quietOn: '', activeSince: 0, title: 'Gym spotted', body: 'Ready for your workout? 💪', channel: 'Gym reminder' });
  return JSON.stringify(await P.configure({ config: { on: true, window: null, gyms: [{ id: 'emu', name: 'Emulator gym', lat: $LAT, lng: $LNG, radius: 100, text: '' }] } })) })()"

echo "== app to the background, wait out the 90 s arming grace"
$ADB shell input keyevent KEYCODE_HOME
for i in $(seq 1 10); do $ADB emu geo fix $FAR_LNG $FAR_LAT >/dev/null; sleep 10; done

echo "== walk into the gym"
for step in 0.0300 0.0200 0.0100 0.0050 0.0020 0.0005 0; do
  $ADB emu geo fix "$(python3 -c "print($LNG+$step)")" "$(python3 -c "print($LAT+$step)")" >/dev/null
  sleep 5
done
start=$(date +%s)
while [ $(( $(date +%s) - start )) -lt 240 ]; do
  $ADB emu geo fix $LNG $LAT >/dev/null
  if $ADB shell dumpsys notification --noredact | grep -q "Gym spotted"; then
    echo "== notification fired after $(( $(date +%s) - start )) s inside the radius"
    $ADB shell dumpsys notification --noredact | grep -E "pkg=$PKG|android.title=|android.text=" | grep -A2 "pkg=$PKG" | head -12
    exit 0
  fi
  sleep 5
done
echo "== no notification within 240 s"
exit 1
