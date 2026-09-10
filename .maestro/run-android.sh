#!/bin/bash
# Avvia l'emulatore Android "sistemato" per VEDERE lo shader WebGL.
#
# Problema: con -gpu host l'"Android Emulator OpenGL ES Translator" (Apple Silicon) renderizza
# la GL ma NON compone il canvas WebGL sullo schermo -> shader bianco.
# Fix: GPU host per la UI (veloce) + Chrome con la GL in SwiftShader -> il canvas si compone.
#
# Uso:  bash .maestro/run-android.sh [AVD] [URL]
set -e
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
AVD="${1:-Pixel_API36}"
URL="${2:-http://10.0.2.2:5173/}"

# 1. avvia l'emulatore se non è già acceso
if ! adb devices | grep -q emulator; then
  echo "Avvio $AVD (-gpu host)..."
  nohup emulator -avd "$AVD" -no-snapshot -no-boot-anim -no-audio -gpu host >/tmp/emu.log 2>&1 &
  adb wait-for-device
  until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 2; done
fi
adb shell input keyevent 82 >/dev/null 2>&1
adb shell settings put global hidden_api_policy 1 >/dev/null 2>&1   # per Maestro

# 2. FIX shader WebGL: Chrome rende la GL in SwiftShader -> il canvas si compone.
#    (richiede adb root, disponibile sulle immagini google_apis)
adb root >/dev/null 2>&1; sleep 1
adb shell 'echo "chrome --disable-fre --no-first-run --use-gl=angle --use-angle=swiftshader --ignore-gpu-blocklist" > /data/local/tmp/chrome-command-line'
adb shell am force-stop com.android.chrome >/dev/null 2>&1

# 3. apri la demo
adb shell am start -a android.intent.action.VIEW -d "$URL" -p com.android.chrome >/dev/null 2>&1
echo "OK: $URL aperto su $AVD. Lo shader si compone (GL via SwiftShader)."
echo "Nota: WebGL gira in software -> framerate ridotto. Per performance reali usa un device fisico."
