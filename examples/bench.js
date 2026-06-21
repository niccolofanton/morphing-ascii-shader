// bench.js
// HARNESS DI BENCHMARK GPU per la pipeline ASCII (three.js + postprocessing).
//
// Obiettivo: MISURARE (non stimare) il costo GPU di OGNI pass e di ogni "passaggio" interno
// dello shader ASCII, A TUTTO SCHERMO, sulla GPU reale. Non altera in alcun modo la resa:
// gira solo quando la pagina e' caricata con `?bench` e ripristina ogni uniform/stato toccato.
//
// METODO: "isolated render + GPU sync via readback".
//   Per ogni pass P (con gli stessi buffer del composer) si esegue P.render(...) M volte e si
//   forza la GPU a finire il lavoro con renderer.readRenderTargetPixels(rt, 1,1,1,1) (legge 1
//   pixel dal target scritto: e' una BARRIERA reale che attende la GPU). Si cronometra con
//   performance.now(), si ripete R volte e si prende la MEDIANA + MIN.
//   NB IMPORTANTE: su questo backend ANGLE/Metal `gl.finish()` NON blocca (riporterebbe tempi
//   ~1000x troppo bassi) e EXT_disjoint_timer_query_webgl2 esiste ma segnala sempre GPU_DISJOINT
//   (risultati inutilizzabili). Il readback e' la barriera affidabile. Si misura anche l'overhead
//   del readback (loop di soli sync) per documentare il bias (~1/M per chiamata, trascurabile).
//
//   Attribuzione PER-STEP dello shader ASCII: i passaggi sono branchati su `uniform bool`
//   (uEdges, uUseMemory, uGlyphBlend, uSdfMorph). Si misura il pass attivando/disattivando UNA
//   feature alla volta (i bool sono uniform, non #define -> nessuna ricompilazione: si misura
//   proprio il ramo dinamico). La differenza = costo marginale REALE di quel passaggio.

import { Vector2 } from 'three';

const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const min = (a) => a.reduce((m, x) => (x < m ? x : m), Infinity);
const r4 = (x) => Math.round(x * 10000) / 10000;

/**
 * @param {Object} ctx { renderer, composer, scene, camera, memoryGrid, ascii, inkBleed, video, hold }
 * @param {Object} [opts] { M, R, warm }
 */
export async function runBenchmark(ctx, opts = {}) {
  const { renderer, composer, memoryGrid, ascii, inkBleed, video, hold } = ctx;
  const M = opts.M ?? 100;
  const R = opts.R ?? 9;
  const WARM = opts.warm ?? 16;

  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
  const dprSize = new Vector2();
  renderer.getDrawingBufferSize(dprSize);

  const passes = composer.passes;
  const renderPass = passes.find((p) => p.constructor.name === 'RenderPass') || passes[0];
  const effectPasses = passes.filter((p) => p.constructor.name === 'EffectPass');
  const asciiPass = effectPasses[0];
  const inkPass = effectPasses[1];
  const inBuf = composer.inputBuffer;
  const outBuf = composer.outputBuffer;

  // Barriera GPU affidabile: legge 1 px dal target scritto (attende il completamento del lavoro).
  const px1 = new Uint8Array(4);
  const sync = (rt) => renderer.readRenderTargetPixels(rt, 1, 1, 1, 1, px1);

  function timeCall(fn, syncRT) {
    for (let i = 0; i < WARM; i++) fn();
    sync(syncRT);
    const runs = [];
    for (let k = 0; k < R; k++) {
      const t0 = performance.now();
      for (let i = 0; i < M; i++) fn();
      sync(syncRT);
      runs.push((performance.now() - t0) / M);
    }
    return { median: r4(median(runs)), min: r4(min(runs)) };
  }

  // --- Setup: congela la demo, video in pausa (input statico), scalda la memoria ---
  hold(true);
  const wasPaused = video.paused;
  try { video.pause(); } catch (e) {}
  await new Promise((res) => requestAnimationFrame(res));
  for (let i = 0; i < 40; i++) memoryGrid.update(0.016);

  const savedRTS = [renderPass.renderToScreen, asciiPass.renderToScreen, inkPass.renderToScreen];
  renderPass.renderToScreen = asciiPass.renderToScreen = inkPass.renderToScreen = false;

  const dt = 0.016;
  const fnRender = () => renderPass.render(renderer, inBuf, inBuf, dt, false);
  const fnAscii = () => asciiPass.render(renderer, inBuf, outBuf, dt, false);
  const fnInk = () => inkPass.render(renderer, outBuf, inBuf, dt, false);
  const fnMem = () => memoryGrid.update(dt);

  // Calibrazione overhead readback (solo sync, niente render).
  const rb = [];
  for (let k = 0; k < R; k++) { const t0 = performance.now(); for (let i = 0; i < M; i++) sync(outBuf); rb.push((performance.now() - t0) / M); }
  const readbackOverhead = r4(median(rb));

  const results = { passes: {}, asciiSteps: {}, meta: {} };

  fnRender(); sync(inBuf);
  results.passes['RenderPass'] = timeCall(fnRender, inBuf);
  fnRender(); sync(inBuf);
  results.passes['EffectPass:ASCII'] = timeCall(fnAscii, outBuf);
  fnAscii(); sync(outBuf);
  results.passes['EffectPass:InkBleed'] = timeCall(fnInk, inBuf);
  results.passes['MemoryGrid.update'] = timeCall(fnMem, memoryGrid.current);
  // pipeline completa (sanity-check vs somma)
  const fnPipe = () => { memoryGrid.update(dt); fnRender(); fnAscii(); fnInk(); };
  results.passes['__pipeline_total'] = timeCall(fnPipe, inBuf);

  // --- ASCII per-step (toggle uniform bool): costo marginale reale ---
  fnRender(); sync(inBuf);
  const u = ascii.uniforms;
  const snap = { edges: u.get('uEdges').value, mem: u.get('uUseMemory').value, gb: u.get('uGlyphBlend').value, sdf: u.get('uSdfMorph').value };
  const setU = (o) => { u.get('uEdges').value = o.edges; u.get('uUseMemory').value = o.mem; u.get('uGlyphBlend').value = o.gb; u.get('uSdfMorph').value = o.sdf; };
  const base = { edges: false, mem: true, gb: true, sdf: true };
  const cfg = {};
  setU(base); cfg.base = timeCall(fnAscii, outBuf).median;
  setU({ ...base, edges: true }); cfg.edgesOn = timeCall(fnAscii, outBuf).median;
  setU({ ...base, mem: false }); cfg.memOff = timeCall(fnAscii, outBuf).median;
  setU({ ...base, gb: false }); cfg.glyphBlendOff = timeCall(fnAscii, outBuf).median;
  setU({ ...base, sdf: false }); cfg.sdfOff = timeCall(fnAscii, outBuf).median;
  setU(snap);
  results.asciiSteps = {
    'edges (Sobel 8-tap)': r4(cfg.edgesOn - cfg.base),
    'memory sample vs live': r4(cfg.base - cfg.memOff),
    'glyphBlend+SDF path': r4(cfg.base - cfg.glyphBlendOff),
    'sdfMorph (SDF vs alpha)': r4(cfg.base - cfg.sdfOff),
    '_configs': cfg,
  };

  // --- Ripristino + ripresa demo ---
  renderPass.renderToScreen = savedRTS[0];
  asciiPass.renderToScreen = savedRTS[1];
  inkPass.renderToScreen = savedRTS[2];
  if (!wasPaused) { try { await video.play(); } catch (e) {} }
  hold(false);

  results.meta = {
    gpu,
    drawingBuffer: `${dprSize.x}x${dprSize.y}`,
    pixelsMP: r4((dprSize.x * dprSize.y) / 1e6),
    dpr: renderer.getPixelRatio(),
    method: 'readback-sync isolated-render timing (median/min over runs)',
    readbackOverhead_ms: readbackOverhead,
    M, R, warm: WARM,
    inkBleedSamples: 64,
    inkBleed: { bleed: inkBleed.bleed, radius: inkBleed.radius, blur: inkBleed.blur },
    asciiUniforms: { cellSize: u.get('uCellSize').value, edges: u.get('uEdges').value, useMemory: u.get('uUseMemory').value, glyphBlend: u.get('uGlyphBlend').value, sdfMorph: u.get('uSdfMorph').value, colorMode: u.get('uColorMode').value },
  };

  console.log('%c=== ASCII shader GPU benchmark ===', 'font-weight:bold');
  console.log('GPU:', gpu, '| buffer:', results.meta.drawingBuffer, `(${results.meta.pixelsMP} MP)`, '| readback overhead:', readbackOverhead, 'ms');
  console.table(Object.fromEntries(Object.entries(results.passes).map(([k, v]) => [k, { 'ms (median)': v.median, 'ms (min)': v.min }])));
  console.table(results.asciiSteps);
  return results;
}
