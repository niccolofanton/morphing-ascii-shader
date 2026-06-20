// index.js — entry point del pacchetto.
// Espone gli effetti compatibili con pmndrs/postprocessing (sottoclassi di Effect) e il
// sistema di memoria per-cella usato dal morph/trail. three e postprocessing sono PEER
// dependencies: li fornisce l'applicazione che consuma il pacchetto.
//
// Uso tipico:
//   import { EffectComposer, RenderPass, EffectPass } from 'postprocessing';
//   import { AsciiEffect, InkBleedEffect, MemoryGrid } from 'evoling-aschii-shader';
//
//   const ascii = new AsciiEffect({ cellSize: 16, useMemory: true, glyphBlend: true });
//   composer.addPass(new EffectPass(camera, ascii));
//   // Per il morph/trail per-cella (opzionale): vedi MemoryGrid nel README.

export { AsciiEffect, DEFAULT_CHARSET, DEFAULT_EDGE_CHARS } from './AsciiEffect.js';
export { InkBleedEffect } from './InkBleed.js';
export { MemoryGrid } from './MemoryGrid.js';
