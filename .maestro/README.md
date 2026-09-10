# POC Maestro — test-suite "barra URL"

Verifica che il rendering fullscreen della demo regga gli edge case provocati dalle
barre URL dei browser mobile (la `100vh` che mente, il toggle della toolbar, i bottom-bar
di Safari iOS).

## Avvio rapido (npm)

Un'unica utility (`tools/launch-mobile.mjs`) fa tutto nell'ordine giusto — dev server +
boot device + apertura demo:

```sh
npm run dev            # solo dev server Vite (come prima)
npm run dev:android    # Vite + emulatore Pixel (Android 16) + demo in Chrome (shader visibile)
npm run dev:ios        # Vite + simulatore iPhone + demo in Safari
# equivalenti: npm run dev --android / npm run dev --ios
```
Poi, per i TEST Maestro, vedi sotto. (Override: `MOBILE_AVD`, `MOBILE_IOS_DEVICE`, `PORT`.)

## Come funziona

Maestro non esegue JS nella pagina in modo affidabile, ma **legge il testo dal DOM**
(`assertVisible`, auto-wait 7s) e fa **screenshot**. Quindi:

1. La pagina, con `?diag=1`, carica `examples/diag.js` (loader opt-in in `index.html`,
   zero impatto in produzione). L'harness mette tre probe nascoste `100lvh / 100svh /
   100dvh` — le calcola il **browser reale** e codificano la geometria della barra URL —
   misura canvas `#scene`, `visualViewport` e card `.bottom-ui`, e stampa un overlay
   testuale con un `PASS/FAIL` per invariante e una riga finale `ALL PASS|FAIL`.
2. I flow Maestro aprono l'URL nel browser del device, asseriscono le stringhe `PASS` e
   catturano gli screenshot ai vari stati della barra.

### Invarianti testati (in `diag.js`)

| ID | Cosa garantisce |
|----|-----------------|
| `CANVAS_COVERS`  | il canvas (alto `lvh`, fixed) copre l'area visibile → niente gap bianco dietro la barra |
| `NO_X_OVERFLOW`  | nessuno scroll orizzontale (elemento troppo largo) |
| `SCROLL_BOUNDED` | lo slack verticale resta piccolo: su mobile la pagina è di proposito ~80px più alta (per minimizzare la barra di Safari), ma non deve diventare overflow di contenuto |
| `DPR_CAP`        | drawing buffer == css × `min(dpr, 2)` → cap a 2, nessuno stretch |
| `CARD_VISIBLE`   | la `.bottom-ui` non finisce dietro la barra (bottom entro `visualViewport`) |

> In Playwright/headless `lvh == svh == dvh` (niente chrome del browser): gli invarianti
> passano ma `BAR 0` segnala che NON stai vedendo la barra vera. La barra emerge solo su
> Safari iOS reale / Chrome Android reale (simulatore, emulatore, device).

## Setup

```sh
# 1. Maestro
curl -Ls "https://get.maestro.mobile.dev" | bash    # poi aggiungi ~/.maestro/bin al PATH

# 2. Dev server della demo (in un terminale a parte, lascialo girare)
npm run dev                       # Vite su http://localhost:5173
# per un DEVICE FISICO: npm run dev -- --host  e usa l'IP LAN del Mac
```

## Android (Chrome)

```sh
# emulatore avviato (Android Studio > Device Manager, oppure `emulator -avd <nome>`)
adb devices                       # verifica che il device sia ONLINE
maestro test .maestro/urlbar-android.yaml
```
L'emulatore raggiunge il Mac a `10.0.2.2` (già nel flow). Il flow swippa per togglare la
barra e ri-asserisce `ALL PASS` ai tre stati (initial / collapsed / expanded).

## iOS (Safari, solo macOS)

```sh
xcrun simctl boot "iPhone 15"     # o apri l'app Simulator
maestro test .maestro/urlbar-ios.yaml
```
Il simulatore condivide la rete dell'host → `localhost` (già nel flow).

## Dove finiscono gli screenshot

Nella cartella da cui lanci `maestro test`, con i nomi passati a `takeScreenshot`
(es. `urlbar-android-2-collapsed.png`). Comodi per un visual-diff in CI.

## Estensione: testare la guardia anti-churn (opzionale)

Per verificare che il toggle della barra **non** scateni la realloc del buffer (il
`if (w === _lastW && h === _lastH) return;` in `main.js:onResize`), esponi un contatore:

```js
// in cima a main.js
window.__diag = { resizes: 0 };
// dentro onResize(), DOPO il lavoro pesante (renderer.setSize ecc.)
window.__diag.resizes++;
```

Poi in `diag.js` stampa `window.__diag?.resizes` nell'overlay come riga `HEAVY <n>` e in
Maestro asserisci che `<n>` non cambia tra `collapsed` ed `expanded`.

## Setup che ha funzionato (Android, macOS Apple Silicon)

Note di campo dal primo run riuscito (2026-06-21), per riprodurre senza i vicoli ciechi:

- **Java 21 per il driver Maestro**, NON 23. Con Java 23 il driver Android non parte
  (`AndroidInstrumentationSetupFailure` / `dadb closed` / `EOFException`). Fix:
  `brew install openjdk@21` poi
  `export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`
  solo per il comando `maestro`.
- **Emulatore API 35+ (Chrome 124+)**, NON API 33. Il Chrome dell'immagine API 33 è troppo
  vecchio per `lvh/svh/dvh` (le probe tornano 0 → `BAR 0`) e **crasha sul WebGL** della
  demo ("Chrome keeps stopping"). Immagine usata: `system-images;android-35;google_apis;arm64-v8a`,
  AVD `Pixel_API35`.
- **GPU host**: avvia con `emulator -avd Pixel_API35 -gpu host`. Con `-gpu swiftshader_indirect`
  gli screenshot escono neri/vuoti e Chrome non renderizza il WebGL.
- **Hidden API**: `adb shell settings put global hidden_api_policy 1` (il driver usa reflection).
- **Driver lento al primo avvio**: `export MAESTRO_DRIVER_STARTUP_TIMEOUT_MS=120000`.
- **First-run di Chrome**: su immagine `google_apis` (rootable) `adb root` +
  `echo "chrome --disable-fre --no-first-run" > /data/local/tmp/chrome-command-line`.

Comando completo del run verde:
```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH="$JAVA_HOME/bin:$HOME/.maestro/bin:$ANDROID_HOME/platform-tools:$PATH"
export MAESTRO_DRIVER_STARTUP_TIMEOUT_MS=120000
maestro test .maestro/urlbar-android.yaml
```

Esito: **ALL PASS** in entrambi gli stati barra. Prove visive in `.maestro/screens/`
(`urlbar-android-1-initial.png`, `-2-collapsed.png`, `-3-expanded.png`): al collasso della
barra `DVH` e `visualViewport` crescono da 536→592, la card si riposiziona da 504→560 e
gli invarianti restano verdi.

## iOS (Safari) — verde

Con Xcode installato (verificato: Xcode 26.5, runtime iOS 17 e 26.5), il flow iOS passa.
```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcrun simctl boot "iPhone 15"
maestro --device <UDID-iPhone> test .maestro/urlbar-ios.yaml   # ALL PASS
```
**Gotcha**: con un emulatore Android E un simulatore iOS accesi insieme, Maestro sceglie da
solo il device (di solito l'Android) → passa SEMPRE `--device <UDID>` (da `xcrun simctl list
devices booted`) per forzare l'iPhone. Prova visiva: `.maestro/screens/ios-shader.png`.

## Visibilità dello shader (WebGL) sull'emulatore Android

Lo shader three.js/WebGL **funziona su Android** (dimostrato: `gl.readPixels` torna il colore
atteso, e con rendering software si vede — `.maestro/screens/android-shader-sw.png`, le fragole
in glifi ASCII). MA con **`-gpu host`** il canvas WebGL appare **bianco**: l'"Android Emulator
OpenGL ES Translator" su Apple Silicon renderizza in GL ma **non compone il canvas sullo
schermo**. Verificato identico su immagini API 33 / 35 / 36 (Chrome 124/133) → è un limite
dell'emulatore, NON della demo (su iOS e su device reale lo shader si vede).

### FIX (shader visibile sull'emulatore, GPU host)

Tieni l'emulatore su `-gpu host` (UI veloce) e forza **Chrome a renderizzare la GL in
SwiftShader**: il canvas WebGL passa dal path software e viene composto.
```sh
bash .maestro/run-android.sh          # avvia Pixel_API36 + applica il fix + apre la demo
```
Cosa fa il fix (con `adb root`, immagini `google_apis`):
```sh
adb shell 'echo "chrome --use-gl=angle --use-angle=swiftshader --ignore-gpu-blocklist \
  --disable-fre --no-first-run" > /data/local/tmp/chrome-command-line'
adb shell am force-stop com.android.chrome
```
Risultato: shader **visibile** con `-gpu host` (`.maestro/screens/android-fix-swgl.png`).
WebGL gira in software → framerate ridotto; per performance reali usa un **device fisico**.
(In alternativa, tutto software: `emulator -gpu swiftshader_indirect`, più lento.)
- Il POC degli invarianti barra-URL **non è influenzato**: Maestro legge il testo del DOM
  (overlay), non i pixel WebGL → `urlbar-android.yaml` è verde anche con `-gpu host`.

AVD disponibili: `Pixel_API36` (Android 16, il più recente), `Pixel_API35`, `Pixel_6_Pro_API_33`.
