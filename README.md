# ASCII Shader

Real-time **ASCII / halftone** post-processing toolkit for
[three.js](https://threejs.org/) + [`pmndrs/postprocessing`](https://github.com/pmndrs/postprocessing).
Maps video (or any rendered scene) to a glyph atlas by luminance, with Sobel edge glyphs,
per-cell **temporal memory** (each cell morphs gradually toward its target), a bloom-like ink
bleed, film grain with blend modes, and **SDF shape morphing** between glyphs.

Ships as an installable package of `Effect` subclasses — drop them into your own
`postprocessing` pipeline. The repo also includes a full demo (`examples/`) with a
frosted-glass UI.

<p align="center">
  <img src="examples/public/assets/preview.gif" alt="ASCII shader — Bad Apple!! rendered as colored halftone glyphs on white" width="520">
</p>

<p align="center"><sub>Real canvas capture (effect applied to “Bad Apple!!”).</sub></p>

## Install

```bash
npm install @niccolofanton/morphing-ascii-shader three postprocessing
```

`three` and `postprocessing` are **peer dependencies** — you provide them in your app.

## Usage

```js
import { EffectComposer, RenderPass, EffectPass } from 'postprocessing';
import { AsciiEffect, InkBleedEffect } from '@niccolofanton/morphing-ascii-shader';

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const ascii = new AsciiEffect({
  cellSize: 16,
  colorMode: 2,       // glyphs in the video's color on white
  glyphBlend: true,   // cross-fade between adjacent glyphs
  edges: true,        // Sobel contour glyphs
});
composer.addPass(new EffectPass(camera, ascii));

// optional: ink bleed as a separate pass downstream
composer.addPass(new EffectPass(camera, new InkBleedEffect({ bleed: 0.5, radius: 24 })));

// in your render loop:
composer.render(dt);
```

### Per-cell memory & SDF shape morph (optional)

`MemoryGrid` gives each cell **memory** so it morphs gradually toward its target instead of
snapping. It is not an `Effect` — update it each frame before `composer.render()`:

```js
import { MemoryGrid } from '@niccolofanton/morphing-ascii-shader';

const ascii = new AsciiEffect({ useMemory: true, glyphBlend: true, sdfMorph: true });
const memory = new MemoryGrid(renderer, videoTexture, { rate: 2.25 });

function animate(dt) {
  memory.setSize(bufferW, bufferH, ascii.cellSize);
  ascii.gridSize = memory.gridSize;
  ascii.memoryTexture = memory.update(dt);
  composer.render(dt);
}
```

With `sdfMorph: true` the current glyph **transforms into the shape of the target** glyph
(distance-field interpolation, “face-morph” style) instead of cross-fading.

## API

| Export | Type | Notes |
|---|---|---|
| `AsciiEffect` | `Effect` | glyph-atlas ASCII effect (luminance, Sobel, grain, memory, SDF morph) |
| `InkBleedEffect` | `Effect` | bloom-like ink bleed (Vogel-disk sampling + blur) |
| `MemoryGrid` | helper | per-cell temporal memory (ping-pong RT); update each frame |
| `DEFAULT_CHARSET` | `string` | default density glyphs `' ·•+✦★○◯●'` |
| `DEFAULT_EDGE_CHARS` | `string` | default edge glyphs `- \| / \\` |

TypeScript definitions are bundled (`types/index.d.ts`).

📖 **Full parameter reference**, with an animated GIF for every parameter:
[`docs/PARAMETERS.md`](docs/PARAMETERS.md).

## Features

- **Glyph-atlas ASCII** — per-cell luminance picks a glyph from a runtime atlas, with per-cell
  variety for the “mixed symbols” look.
- **Sobel edge detection** (optional) with dedicated directional glyphs (`- | / \`) on contours.
- **Per-cell memory** — each cell morphs *gradually* toward its target color/luminance
  (exponential smoothing, no flicker), with a **“magnetic” cross-fade** between glyphs.
- **SDF shape morph** — glyphs transform into one another via signed-distance-field
  interpolation (the characters act as keyframes).
- **Ink bleed** as a separate bloom-like pass (Vogel-disk sampling) with built-in blur.
- **Film grain** (static) with selectable blend modes (Add, Multiply, Screen, Overlay, Soft
  Light, Burn, Dodge…).
- **Layer blending** — every effect composites with `postprocessing`'s native blend functions.

## Run the demo

```bash
npm install        # install dev dependencies (three, postprocessing, tweakpane, …)
npm run dev        # Vite dev server serving examples/ (default http://localhost:5173)
```

Build the demo as a static site: `npm run build:demo` (outputs `demo-dist/`).

> The demo's panel uses [`driftpane`](https://www.npmjs.com/package/driftpane) for persistence,
> drag and presets. If a clone fails to install it, it only affects the demo, not the library.

## Build the library

```bash
npm run build      # bundles src/ → dist/index.js (ESM), three & postprocessing external
```

`npm pack` produces the publishable tarball (`dist/`, `types/`, `src/`, `README.md`).

## How it works

The demo is a full-screen quad with a `VideoTexture`; on top runs the pipeline
`EffectComposer → RenderPass → EffectPass(ASCII) → EffectPass(InkBleed)`.

- **Luminance → glyph** (UV-sampled atlas) — technique by
  [Maxime Heckel](https://blog.maximeheckel.com/posts/post-processing-as-a-creative-medium/).
- **Sobel contour glyphs** — inspired by
  [humanbydefinition](https://github.com/humanbydefinition/p5js-edge-detection-ascii-renderer).
- **Per-cell memory**: a ping-pong of grid-resolution render targets (one texel per cell) keeps
  state between frames; each cell converges with exponential inertia. The “morph activity”
  drives the magnetic cross-fade / SDF morph.
- **SDF morph**: glyphs are also rasterized to a signed-distance-field atlas (EDT at init);
  interpolating the two distance fields and thresholding produces in-between shapes.

## Project structure

```
package.json            # package manifest + scripts (dev / build / build:demo)
vite.config.js          # library build (lib mode → dist/)
vite.config.demo.js     # demo dev/build (root = examples/)
src/                    # the published package
  index.js              # entry point (re-exports)
  AsciiEffect.js        # ASCII effect (glyph atlas + Sobel + grain + SDF morph)
  MemoryGrid.js         # per-cell memory (ping-pong RT, morph)
  InkBleed.js           # bloom-like ink bleed (Vogel spiral + blur)
types/index.d.ts        # TypeScript definitions
examples/               # demo app (uses the library)
  index.html, main.js, overlay.js
  public/assets/        # source videos + preview.gif
tools/                  # procedural video generators (numpy + ffmpeg)
```

> Source code comments are in Italian.

## Stack

[three.js](https://threejs.org/) `0.161` · [postprocessing](https://github.com/pmndrs/postprocessing)
`6.36.3` (peer) · demo UI via [Tweakpane](https://tweakpane.github.io/docs/) `4.0.5` +
[`driftpane`](https://www.npmjs.com/package/driftpane) — bundled by [Vite](https://vitejs.dev/).

## Assets

The “flower” videos are **procedurally generated** (`tools/gen_flowers.py`,
`tools/gen_flower.py`) with numpy + ffmpeg.

Credits / licenses of the demo sources included:

- **Bad Apple!!** — the well-known Touhou shadow-art PV; copyright of its respective authors.
- **Big Buck Bunny** — © Blender Foundation, [CC-BY 3.0](https://peach.blender.org/about/).
- **Fragole** (strawberries) — sample clip.
- **5 fiori** (5 flowers) — procedurally generated (see `tools/`).

## License

MIT © Niccolò Fanton
