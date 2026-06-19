# ASCII Shader

Effetto **ASCII / halftone** in tempo reale applicato a un video, costruito con
[three.js](https://threejs.org/) + [`pmndrs/postprocessing`](https://github.com/pmndrs/postprocessing).
Ogni cella della griglia ha **memoria** (morphing graduale verso colore e luminanza target),
ink bleed in stile bloom, grana con blend mode e una UI in vetro smerigliato (frosted glass).

Vanilla JS: **niente framework, niente bundler, niente build step** — solo file statici e una
import-map da CDN.

<p align="center">
  <img src="assets/preview.gif" alt="ASCII shader — Bad Apple!! reso in glifi halftone colorati su bianco" width="520">
</p>

<p align="center"><sub>Cattura reale del canvas (effetto applicato a “Bad Apple!!”).</sub></p>

## Caratteristiche

- **Effetto ASCII a atlante di glifi** — la luminanza di ogni cella sceglie un glifo da un
  atlante costruito a runtime (`' ·•+✦★○◯●'`), con varietà per-cella per il look “misto”.
- **Edge-detection Sobel** opzionale con glifi direzionali dedicati (`- | / \`) sui contorni.
- **Memoria per-cella** — ogni cella morpha *gradualmente* verso il colore/luminanza target
  (smoothing esponenziale, niente flicker); velocità di cambio regolabile da lentissima a
  quasi istantanea, con **cross-fade “magnetico”** tra glifi.
- **Ink bleed** come pass separato in stile bloom (campionamento a spirale di Vogel) con
  **blur** integrato e raggio regolabile.
- **Grana** statica con **blend mode** selezionabili (Additivo, Multiply, Screen, Overlay,
  Soft Light, Burn, Dodge…), dimensione e opacità regolabili.
- **Fusione dei layer** — il layer ASCII si fonde col video sottostante con i blend mode
  nativi di `postprocessing` (Multiply, Screen, Overlay…).
- **UI frosted glass** (stile Apple): selettore sorgenti a *segmented control*, play/pausa e
  toggle per mostrare/nascondere il pannello.
- **Pannello Tweakpane** completo con **persistenza** (localStorage), **export/import JSON** e
  reset ai default.

## Avvio rapido

Serve un semplice server statico (i moduli ES e i video locali non funzionano via `file://`):

```bash
python3 -m http.server 8000
# poi apri http://localhost:8000
```

Il video parte da solo (muted autoplay); scegli la sorgente dal selettore in basso.

## Controlli

In basso una barra in vetro smerigliato con: **selettore sorgente** (bad apple · fragole ·
5 fiori), **play/pausa** e **⚙ settings** (mostra/nasconde il pannello).

Il pannello **Tweakpane** (in alto a destra) raggruppa tutti i parametri:

| Cartella | Cosa regola |
|---|---|
| **Griglia** | dimensione cella |
| **Caratteri** | set di glifi, varietà, dimensione del carattere |
| **Grana** | opacità, dimensione e blend mode della grana |
| **Ink bleed** | intensità, raggio, blur, fusione ↔ ASCII |
| **Memoria / Trail** | on/off, velocità di cambio, cross-fade, magnetismo |
| **Luminanza** | brightness, contrast, gamma |
| **Colore** | modalità, fusione ASCII ↔ video, inchiostro/sfondo, soglia bianco |
| **Contorni (Sobel)** | edge-detection on/off, soglia, glifi |
| **Video** | sorgente, velocità, pausa |
| **Preset / Stato** | export / import JSON, reset default |

## Come funziona

La scena è un quad a tutto schermo con una `VideoTexture`; sopra gira la pipeline
`EffectComposer → RenderPass → EffectPass(ASCII) → EffectPass(InkBleed)`.

- **Luminanza → glifo** (atlante campionato per UV) — tecnica di
  [Maxime Heckel](https://blog.maximeheckel.com/posts/post-processing-as-a-creative-medium/).
- **Glifi di contorno via Sobel** — ispirato a
  [humanbydefinition](https://github.com/humanbydefinition/p5js-edge-detection-ascii-renderer).
- **Memoria per-cella**: un ping-pong di render target a risoluzione-griglia (un texel per
  cella) mantiene lo stato tra i frame; ogni cella converge al target con inerzia
  esponenziale. L'“attività di morph” pilota il cross-fade magnetico tra glifi.

## Struttura

```
index.html              # markup, stile UI, import-map CDN
src/
  main.js               # setup three.js, pipeline, Tweakpane, persistenza
  AsciiEffect.js        # effetto ASCII (atlante glifi + Sobel + grana)
  MemoryGrid.js         # memoria per-cella (ping-pong RT, morph)
  InkBleed.js           # ink bleed bloom-like (spirale di Vogel + blur)
  overlay.js            # bottom bar frosted glass (selettore + play + settings)
assets/                 # video sorgente + preview.gif
tools/                  # generatori procedurali dei video (numpy + ffmpeg)
```

## Stack

[three.js](https://threejs.org/) `0.161` · [postprocessing](https://github.com/pmndrs/postprocessing)
`6.36.3` · [Tweakpane](https://tweakpane.github.io/docs/) `4.0.5` — tutti via import-map da
[jsDelivr](https://www.jsdelivr.com/). Nessuna dipendenza da installare.

## Asset

I video “fiore” sono **generati proceduralmente** (`tools/gen_flowers.py`, `tools/gen_flower.py`)
con numpy + ffmpeg.

Crediti / licenze delle sorgenti incluse a scopo dimostrativo:

- **Bad Apple!!** — celebre PV shadow-art della community Touhou; copyright dei rispettivi autori.
- **Big Buck Bunny** — © Blender Foundation, [CC-BY 3.0](https://peach.blender.org/about/).
- **Fragole** — clip di esempio.
- **5 fiori** — generato proceduralmente (vedi `tools/`).
