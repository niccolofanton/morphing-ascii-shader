# POC Maestro — test-suite "barra URL"

Verifica che il rendering fullscreen della demo regga gli edge case provocati dalle
barre URL dei browser mobile (la `100vh` che mente, il toggle della toolbar, i bottom-bar
di Safari iOS).

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
