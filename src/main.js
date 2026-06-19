// main.js
// Setup three.js: una scena con quad a tutto schermo (camera ortografica) che mostra una
// VideoTexture del video in loop. Sopra si applica l'effetto ASCII con la pipeline di
// postprocessing: EffectComposer -> RenderPass -> EffectPass(AsciiEffect).
// I parametri dell'effetto sono regolabili LIVE tramite un pannello Tweakpane.

import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BlendFunction } from 'postprocessing';
import { Pane } from 'tweakpane';
import { AsciiEffect, DEFAULT_CHARSET, DEFAULT_EDGE_CHARS } from './AsciiEffect.js';
import { MemoryGrid } from './MemoryGrid.js';
import { InkBleedEffect } from './InkBleed.js';
import { createOverlay } from './overlay.js';

// Sorgenti video (fonte unica: alimenta sia la bottom bar sia il picker Tweakpane).
const VIDEOS = [
  { label: 'bad apple', src: 'assets/sample-badapple.mp4' },
  { label: 'fragole', src: 'assets/sample-strawberries.mp4' },
  { label: '5 fiori', src: 'assets/video.mp4' },
];

// --- Riferimenti DOM ---
const canvas = document.getElementById('scene');
const video = document.getElementById('video');

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const PIXEL_RATIO = Math.min(window.devicePixelRatio, 2);
renderer.setPixelRatio(PIXEL_RATIO);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0xffffff, 1);

// --- Camera ortografica per la quad a schermo intero (clip-space [-1,1]) ---
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

// --- Scena: quad + VideoTexture ---
const scene = new THREE.Scene();

const videoTexture = new THREE.VideoTexture(video);
videoTexture.minFilter = THREE.LinearFilter;
videoTexture.magFilter = THREE.LinearFilter;
videoTexture.colorSpace = THREE.SRGBColorSpace;

const quadGeo = new THREE.PlaneGeometry(2, 2);
const quadMat = new THREE.MeshBasicMaterial({ map: videoTexture });
const quad = new THREE.Mesh(quadGeo, quadMat);
scene.add(quad);

// --- Effetto ASCII ---
// GRID = 16px a schermo. Il cellSize e in pixel del drawing buffer -> va scalato per il
// pixelRatio (dpr=2 -> 32 device px = 16 css px).
const GRID_CSS = 15;
const ascii = new AsciiEffect({
  charset: DEFAULT_CHARSET,         // ' ·•+✦★○◯●' (stelle, cerchi, plus, puntini)
  edgeChars: DEFAULT_EDGE_CHARS,    // '-|/\\'
  cellSize: Math.round(GRID_CSS * PIXEL_RATIO),
  invert: false,
  colorMode: 2,                     // default: glifi col colore del video su bianco
  whiteCutoff: 0.8,
  brightness: 0.0,
  contrast: 1.0,
  gamma: 1.0,
  edges: false,                     // off: l'immagine di riferimento usa solo simboli
  edgeThreshold: 0.3,
  variety: 1.0,                     // mix di simboli a parita di luminanza
  ink: [0.45, 1.0, 0.45],           // verde fosforo (modalita classica)
  background: [0.0, 0.0, 0.0],
  useMemory: true,                  // memoria per-cella (morph) attiva di default
  glyphScale: 1.0,                  // dimensione glifo dentro la cella (1.0 = look attuale)
  glyphBlend: true,                 // cross-fade glifi attivo di default
  magnet: 0.55,                     // magnetismo del cross-fade (0 = off); tweakabile
  colorVar: 0.0,                    // mottlatura disattivata (controllo rimosso)
  noise: 0.06,                      // grana sopra tutto: opacita del layer
  noiseScale: 1.0,                  // dimensione della grana (1 = puntinato fine)
  noiseMode: 0,                     // modalita di fusione della grana (0 = additivo)
});

// --- Memoria per-cella (ping-pong di RT a risoluzione-griglia) ---
// Mantiene il colore "morphato" di ogni cella tra i frame; vedi src/MemoryGrid.js.
const MORPH_RATE = 2.25;            // velocita morph iniziale (basso = trail piu persistente)
const memoryGrid = new MemoryGrid(renderer, videoTexture, { rate: MORPH_RATE });

// Allinea la griglia della memoria al drawing buffer + cellSize correnti e propaga
// la dimensione griglia all'effetto (per il campionamento al centro cella).
const _bufSize = new THREE.Vector2();
function syncMemorySize() {
  renderer.getDrawingBufferSize(_bufSize);
  memoryGrid.setSize(_bufSize.x, _bufSize.y, ascii.cellSize);
  ascii.gridSize = memoryGrid.gridSize;
}

// --- Ink bleed: PASS separato (bloom-like) a valle dell'ASCII ---
const inkBleed = new InkBleedEffect({ bleed: 0.5, radius: 24 });

// --- Pipeline postprocessing ---
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new EffectPass(camera, ascii));
composer.addPass(new EffectPass(camera, inkBleed)); // ink bleed come pass separato dopo l'ASCII
composer.setSize(window.innerWidth, window.innerHeight);

// --- Resize ---
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  // Rialloca la griglia di memoria alla nuova risoluzione (re-init a bianco).
  syncMemorySize();
}
window.addEventListener('resize', onResize);

// --- Loop di rendering ---
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  if (video.readyState >= video.HAVE_CURRENT_DATA) {
    videoTexture.needsUpdate = true;
  }
  const dt = clock.getDelta();

  // Allinea la griglia di memoria a eventuali cambi di cellSize (early-return se invariata).
  syncMemorySize();

  // PASS DI MEMORIA: aggiorna il ping-pong PRIMA del render e passa la texture all'effetto.
  // Gira anche a video in pausa (il target resta fermo, le celle convergono).
  const memTex = memoryGrid.update(dt);
  if (memTex) ascii.memoryTexture = memTex;

  composer.render(dt);
}
// Prima allocazione della griglia di memoria (drawing buffer gia dimensionato).
syncMemorySize();
animate();

// --- Autoplay video (muted -> parte da solo). Nessun overlay: se il browser lo blocca,
// riparte SILENZIOSAMENTE alla prima interazione qualsiasi (nessun messaggio a schermo). ---
function tryPlay() {
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.play().catch(() => {});
}
// Fallback invisibile: prima interazione utente -> riprova play (una volta sola).
const resumeOnInteract = () => { video.play().catch(() => {}); };
window.addEventListener('pointerdown', resumeOnInteract, { once: true });
window.addEventListener('keydown', resumeOnInteract, { once: true });
if (video.readyState >= 1) tryPlay();
else video.addEventListener('loadedmetadata', tryPlay, { once: true });

// Cambia la SORGENTE video (picker Tweakpane). Mantiene muted/loop/playsinline e riavvia.
function setVideoSource(path) {
  if (!path || video.src.endsWith(path)) return;
  video.src = path;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.load();
  video.play().catch(() => {});
}

// Handle della bottom bar (impostato dopo createOverlay); usato per la sync UI <-> pannello.
let overlayApi = null;

// Cambia sorgente video e SINCRONIZZA PARAMS + pannello Tweakpane + bottom bar.
function selectVideo(src) {
  setVideoSource(src);
  PARAMS.videoSrc = src;
  pane.refresh();
  save();
  if (overlayApi) overlayApi.setActiveVideo(src);
}

// Toggle play/pausa; sincronizza PARAMS + pannello + bottom bar. Ritorna il nuovo stato "paused".
function togglePlay() {
  const shouldPause = !video.paused;
  if (shouldPause) video.pause(); else video.play().catch(() => {});
  PARAMS.paused = shouldPause;
  pane.refresh();
  save();
  return shouldPause;
}

// Mostra/nasconde il pannello Tweakpane (bottone settings). Ritorna se ora e VISIBILE.
let settingsVisible = true;
function toggleSettings() {
  settingsVisible = !settingsVisible;
  const root = pane.element || document.querySelector('.tp-dfwv');
  if (root) root.classList.toggle('tp-hidden', !settingsVisible);
  return settingsVisible;
}

// =====================================================================================
// TWEAKPANE: pannello con TUTTI i parametri, aggiornati LIVE.
// =====================================================================================

// Stato dei parametri: i colori sono oggetti {r,g,b} 0..1 per il color picker (type float).
const PARAMS = {
  // Griglia (esposta in CSS px; convertita in device px verso l'uniform).
  gridCss: GRID_CSS,
  charset: ascii.charset,
  colorMode: ascii.colorMode, // 0..3
  ink: { r: 0.45, g: 1.0, b: 0.45 },
  background: { r: 0.0, g: 0.0, b: 0.0 },
  whiteCutoff: 1.0,
  brightness: 0.08,
  contrast: ascii.contrast,
  gamma: ascii.gamma,
  edges: ascii.edges,
  edgeThreshold: ascii.edgeThreshold,
  edgeChars: ascii.edgeChars,
  variety: ascii.variety,
  // Fusione layer ASCII (col video sottostante) — controlli nella cartella Colore.
  asciiBlend: 'NORMAL',             // modalita di fusione del layer ASCII
  asciiBlendOpacity: 1.0,           // opacita del layer ASCII (1 = pieno)
  // Ink bleed (cartella propria).
  bleedAmount: 1.73,                // intensita
  bleedRadius: 16,                  // raggio in px (vale anche per il blur)
  bleedBlur: 0.31,                  // sfocatura (0 = off)
  bleedBlend: 'MULTIPLY',           // modalita di fusione del layer ink bleed (su ASCII)
  bleedBlendOpacity: 1.0,           // opacita del layer ink bleed
  // Memoria / Trail.
  memoryOn: ascii.useMemory,        // memoria per-cella on/off
  morphRate: MORPH_RATE,            // velocita morph (basso = trail piu persistente)
  glyphBlend: ascii.glyphBlend,     // cross-fade glifi
  magnet: 0.85,                     // magnetismo del cross-fade (0..1)
  glyphScale: 1.92,                 // dimensione carattere dentro la cella
  // Grana (cartella propria).
  noise: 0.155,                     // opacita del layer di grana
  noiseScale: 5,                    // dimensione della grana (px)
  noiseMode: 3,                     // modalita di fusione della grana (3 = Overlay)
  // Video.
  videoSrc: 'assets/sample-badapple.mp4', // sorgente selezionata (picker)
  playbackRate: 1.0,
  paused: false,
};

// Sincronizza un colore {r,g,b} verso il Vector3 dell'uniform.
function syncColor(vec3, c) { vec3.set(c.r, c.g, c.b); }

// --- Fusione layer (blend mode NATIVI di postprocessing) ---
// Ogni Effect ha una blendMode (BlendFunction + opacita) con cui si fonde col risultato del
// pass precedente: per l'ASCII l'input e il VIDEO, per l'ink bleed e l'output ASCII.
// Salviamo in PARAMS la CHIAVE stringa (es. 'MULTIPLY') -> robusta tra versioni della libreria.
const BLEND_OPTIONS = {
  'Normale': 'NORMAL',
  'Add': 'ADD',
  'Multiply': 'MULTIPLY',
  'Screen': 'SCREEN',
  'Overlay': 'OVERLAY',
  'Soft Light': 'SOFT_LIGHT',
  'Hard Light': 'HARD_LIGHT',
  'Color Burn': 'COLOR_BURN',
  'Color Dodge': 'COLOR_DODGE',
  'Linear Burn': 'LINEAR_BURN',
  'Darken': 'DARKEN',
  'Lighten': 'LIGHTEN',
  'Difference': 'DIFFERENCE',
  'Exclusion': 'EXCLUSION',
};

// Risolve la chiave (es. 'SOFT_LIGHT') in valore BlendFunction, tollerante al casing della
// libreria: prova UPPERCASE_SNAKE e PascalCase ('SoftLight'). undefined se non esiste.
function resolveBlend(key) {
  if (key in BlendFunction) return BlendFunction[key];
  const pascal = key.toLowerCase().replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase());
  if (pascal in BlendFunction) return BlendFunction[pascal];
  return undefined;
}

// Applica blend function (per chiave) + opacita ad un Effect. Usa setBlendFunction() (emette
// l'evento 'change' -> l'EffectPass ricompila) se disponibile, altrimenti assegna la proprieta.
// Chiave ignota -> lascia invariata la funzione corrente (no crash).
function setBlend(effect, key, opacity) {
  const bf = resolveBlend(key);
  const bm = effect.blendMode;
  if (typeof bf !== 'undefined') {
    if (typeof bm.setBlendFunction === 'function') bm.setBlendFunction(bf);
    else bm.blendFunction = bf;
  }
  bm.opacity.value = Math.min(1, Math.max(0, opacity));
}

// -------------------------------------------------------------------------------------
// PERSISTENZA (localStorage) + EXPORT/IMPORT JSON + RESET DEFAULT
// -------------------------------------------------------------------------------------
const STORE_KEY = 'evoling-ascii-shader/params/v7';

// Valori di default ORIGINARI, catturati prima di caricare lo stato salvato.
const DEFAULTS = JSON.parse(JSON.stringify(PARAMS));

const clamp01 = (n, fb) => {
  const v = typeof n === 'number' && isFinite(n) ? n : fb;
  return Math.min(1, Math.max(0, v));
};

// Copia in PARAMS solo le chiavi note e con il tipo corretto (robusto a JSON malformati).
function assignParams(src) {
  if (!src || typeof src !== 'object') return;
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in src)) continue;
    const dv = DEFAULTS[key];
    const sv = src[key];
    if (dv && typeof dv === 'object' && 'r' in dv) {
      if (sv && typeof sv === 'object') {
        PARAMS[key] = { r: clamp01(sv.r, dv.r), g: clamp01(sv.g, dv.g), b: clamp01(sv.b, dv.b) };
      }
    } else if (typeof dv === 'number' && typeof sv === 'number' && isFinite(sv)) {
      PARAMS[key] = sv;
    } else if (typeof dv === 'boolean' && typeof sv === 'boolean') {
      PARAMS[key] = sv;
    } else if (typeof dv === 'string' && typeof sv === 'string') {
      PARAMS[key] = sv;
    }
  }
}

// Applica TUTTI i parametri di PARAMS all'effetto/video. Necessario dopo load/import/reset:
// pane.refresh() aggiorna l'UI ma NON rilancia gli handler 'change' delle singole binding.
function applyAll() {
  ascii.cellSize = Math.round(PARAMS.gridCss * PIXEL_RATIO);
  ascii.charset = PARAMS.charset;
  ascii.colorMode = PARAMS.colorMode;
  syncColor(ascii.ink, PARAMS.ink);
  syncColor(ascii.background, PARAMS.background);
  ascii.whiteCutoff = PARAMS.whiteCutoff;
  ascii.brightness = PARAMS.brightness;
  ascii.contrast = PARAMS.contrast;
  ascii.gamma = PARAMS.gamma;
  ascii.edges = PARAMS.edges;
  ascii.edgeThreshold = PARAMS.edgeThreshold;
  ascii.edgeChars = PARAMS.edgeChars;
  ascii.variety = PARAMS.variety;
  inkBleed.bleed = PARAMS.bleedAmount;
  inkBleed.radius = PARAMS.bleedRadius;
  inkBleed.blur = PARAMS.bleedBlur;
  // Fusione layer.
  setBlend(ascii, PARAMS.asciiBlend, PARAMS.asciiBlendOpacity);
  setBlend(inkBleed, PARAMS.bleedBlend, PARAMS.bleedBlendOpacity);
  // Memoria / Trail.
  ascii.useMemory = PARAMS.memoryOn;
  ascii.glyphBlend = PARAMS.glyphBlend;
  ascii.magnet = PARAMS.magnet;
  ascii.glyphScale = PARAMS.glyphScale;
  ascii.noise = PARAMS.noise;
  ascii.noiseScale = PARAMS.noiseScale;
  ascii.noiseMode = PARAMS.noiseMode;
  memoryGrid.rate = PARAMS.morphRate;
  setVideoSource(PARAMS.videoSrc);
  video.playbackRate = PARAMS.playbackRate;
  if (PARAMS.paused) video.pause(); else video.play().catch(() => {});
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(PARAMS)); } catch (e) { /* storage non disponibile */ }
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) assignParams(JSON.parse(raw));
  } catch (e) { /* JSON salvato invalido: ignora */ }
}

// Esporta i parametri correnti come file JSON scaricabile.
function exportJson() {
  const blob = new Blob([JSON.stringify(PARAMS, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ascii-shader-preset.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Importa parametri da un file JSON scelto dall'utente.
function importJson() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        assignParams(JSON.parse(String(reader.result)));
        pane.refresh();
        applyAll();
        save();
      } catch (e) {
        console.error('[ASCII] JSON non valido:', e);
        alert('File JSON non valido.');
      }
    };
    reader.readAsText(file);
  });
  input.click();
}

// Ripristina i valori di default originari (e li rende persistenti).
function resetDefaults() {
  assignParams(JSON.parse(JSON.stringify(DEFAULTS)));
  pane.refresh();
  applyAll();
  save();
}

// Carica lo stato salvato PRIMA di costruire il pannello: cosi le binding nascono gia coi valori persistiti.
load();
// Se la sorgente salvata non e piu tra quelle disponibili (es. video rimosso), torna al default.
if (!VIDEOS.some((v) => v.src === PARAMS.videoSrc)) PARAMS.videoSrc = DEFAULTS.videoSrc;

const pane = new Pane({ title: 'ASCII Shader' });

// --- Cartella: Griglia ---
const fGrid = pane.addFolder({ title: 'Griglia' });
fGrid.addBinding(PARAMS, 'gridCss', { label: 'cella (css px)', min: 5, max: 144, step: 1 })
  .on('change', (ev) => { ascii.cellSize = Math.round(ev.value * PIXEL_RATIO); });

// --- Cartella: Caratteri ---
const fChars = pane.addFolder({ title: 'Caratteri' });
fChars.addBinding(PARAMS, 'charset', { label: 'set (chiaro→scuro)' })
  .on('change', (ev) => { ascii.charset = ev.value; });
fChars.addBinding(PARAMS, 'variety', { label: 'varieta glifi', min: 0.0, max: 6.0, step: 0.1 })
  .on('change', (ev) => { ascii.variety = ev.value; });
fChars.addBinding(PARAMS, 'glyphScale', { label: 'dimensione carattere', min: 0.3, max: 4.0, step: 0.01 })
  .on('change', (ev) => { ascii.glyphScale = ev.value; });

// --- Cartella: Grana (con la propria fusione) ---
const fGrain = pane.addFolder({ title: 'Grana' });
fGrain.addBinding(PARAMS, 'noise', { label: 'grana (opacita)', min: 0.0, max: 1.0, step: 0.01 })
  .on('change', (ev) => { ascii.noise = ev.value; });
fGrain.addBinding(PARAMS, 'noiseScale', { label: 'dimensione', min: 1.0, max: 24.0, step: 0.5 })
  .on('change', (ev) => { ascii.noiseScale = ev.value; });
fGrain.addBinding(PARAMS, 'noiseMode', {
  label: 'fusione ↔ output',
  options: {
    'Additivo': 0,
    'Multiply': 1,
    'Screen': 2,
    'Overlay': 3,
    'Soft Light': 4,
    'Linear Burn': 5,
    'Color Burn': 6,
    'Color Dodge': 7,
  },
}).on('change', (ev) => { ascii.noiseMode = ev.value; });

// --- Cartella: Ink bleed (con la propria fusione) ---
const fBleed = pane.addFolder({ title: 'Ink bleed' });
fBleed.addBinding(PARAMS, 'bleedAmount', { label: 'intensita', min: 0.0, max: 2.0, step: 0.01 })
  .on('change', (ev) => { inkBleed.bleed = ev.value; });
fBleed.addBinding(PARAMS, 'bleedRadius', { label: 'raggio bleed/blur (px)', min: 0.0, max: 80, step: 1 })
  .on('change', (ev) => { inkBleed.radius = ev.value; });
fBleed.addBinding(PARAMS, 'bleedBlur', { label: 'blur', min: 0.0, max: 1.0, step: 0.01 })
  .on('change', (ev) => { inkBleed.blur = ev.value; });
fBleed.addBinding(PARAMS, 'bleedBlend', { label: 'fusione ↔ ASCII', options: BLEND_OPTIONS })
  .on('change', (ev) => { setBlend(inkBleed, ev.value, PARAMS.bleedBlendOpacity); });
fBleed.addBinding(PARAMS, 'bleedBlendOpacity', { label: 'opacita', min: 0.0, max: 1.0, step: 0.01 })
  .on('change', (ev) => { inkBleed.blendMode.opacity.value = ev.value; });

// --- Cartella: Memoria / Trail ---
const fMem = pane.addFolder({ title: 'Memoria / Trail' });
fMem.addBinding(PARAMS, 'memoryOn', { label: 'memoria' })
  .on('change', (ev) => { ascii.useMemory = ev.value; });
fMem.addBinding(PARAMS, 'morphRate', { label: 'velocita cambio (basso=lento/trail, alto=rapido)', min: 0.075, max: 60, step: 0.05 })
  .on('change', (ev) => { memoryGrid.rate = ev.value; });
fMem.addBinding(PARAMS, 'glyphBlend', { label: 'cross-fade glifo' })
  .on('change', (ev) => { ascii.glyphBlend = ev.value; });
fMem.addBinding(PARAMS, 'magnet', { label: 'magnetismo (0=off)', min: 0.0, max: 1.5, step: 0.01 })
  .on('change', (ev) => { ascii.magnet = ev.value; });
fMem.addButton({ title: 'reset memoria' }).on('click', () => memoryGrid.reset());

// --- Cartella: Luminanza ---
const fLum = pane.addFolder({ title: 'Luminanza' });
fLum.addBinding(PARAMS, 'brightness', { min: -0.5, max: 0.5, step: 0.01 })
  .on('change', (ev) => { ascii.brightness = ev.value; });
fLum.addBinding(PARAMS, 'contrast', { min: 0.0, max: 3.0, step: 0.01 })
  .on('change', (ev) => { ascii.contrast = ev.value; });
fLum.addBinding(PARAMS, 'gamma', { min: 0.2, max: 3.0, step: 0.01 })
  .on('change', (ev) => { ascii.gamma = ev.value; });

// --- Cartella: Colore ---
const fColor = pane.addFolder({ title: 'Colore' });
// Abilita 'inchiostro' solo in modalita 0 (ink classico) e 'sfondo' nelle modalita che lo usano
// (0 ink classico, 3 video su sfondo). Le altre modalita non li usano -> binding disabilitato.
const updateColorDisabled = () => {
  inkBinding.disabled = PARAMS.colorMode !== 0;
  bgBinding.disabled = !(PARAMS.colorMode === 0 || PARAMS.colorMode === 3);
};
fColor.addBinding(PARAMS, 'colorMode', {
  label: 'modalita',
  options: {
    'video su bianco (default)': 2,
    'video su sfondo': 3,
    'ink classico su bg': 0,
    'preserva sfondo': 1,
  },
}).on('change', (ev) => { ascii.colorMode = ev.value; updateColorDisabled(); });
// Fusione del layer ASCII col video sottostante (compositing del layer principale).
fColor.addBinding(PARAMS, 'asciiBlend', { label: 'ASCII ↔ video', options: BLEND_OPTIONS })
  .on('change', (ev) => { setBlend(ascii, ev.value, PARAMS.asciiBlendOpacity); });
fColor.addBinding(PARAMS, 'asciiBlendOpacity', { label: 'opacita ASCII', min: 0.0, max: 1.0, step: 0.01 })
  .on('change', (ev) => { ascii.blendMode.opacity.value = ev.value; });
const inkBinding = fColor.addBinding(PARAMS, 'ink', { label: 'inchiostro', color: { type: 'float' } })
  .on('change', (ev) => { syncColor(ascii.ink, ev.value); });
const bgBinding = fColor.addBinding(PARAMS, 'background', { label: 'sfondo', color: { type: 'float' } })
  .on('change', (ev) => { syncColor(ascii.background, ev.value); });
fColor.addBinding(PARAMS, 'whiteCutoff', { label: 'soglia bianco', min: 0.0, max: 1.0, step: 0.01 })
  .on('change', (ev) => { ascii.whiteCutoff = ev.value; });
updateColorDisabled();

// --- Cartella: Contorni (Sobel) ---
const fEdge = pane.addFolder({ title: 'Contorni (Sobel)' });
fEdge.addBinding(PARAMS, 'edges', { label: 'attivi' })
  .on('change', (ev) => { ascii.edges = ev.value; });
fEdge.addBinding(PARAMS, 'edgeThreshold', { label: 'soglia', min: 0.0, max: 2.0, step: 0.01 })
  .on('change', (ev) => { ascii.edgeThreshold = ev.value; });
fEdge.addBinding(PARAMS, 'edgeChars', { label: 'glifi (- | / \\)' })
  .on('change', (ev) => { ascii.edgeChars = ev.value; });

// --- Cartella: Video ---
const fVideo = pane.addFolder({ title: 'Video' });
fVideo.addBinding(PARAMS, 'videoSrc', {
  label: 'sorgente',
  options: Object.fromEntries(VIDEOS.map((v) => [v.label, v.src])),
}).on('change', (ev) => selectVideo(ev.value));
fVideo.addBinding(PARAMS, 'playbackRate', { label: 'velocita', min: 0.1, max: 3.0, step: 0.05 })
  .on('change', (ev) => { video.playbackRate = ev.value; });
fVideo.addBinding(PARAMS, 'paused', { label: 'in pausa' })
  .on('change', (ev) => { ev.value ? video.pause() : video.play().catch(() => {}); if (overlayApi) overlayApi.setPlaying(ev.value); });

// --- Cartella: Preset / Stato (esporta, importa, reset) ---
const fPreset = pane.addFolder({ title: 'Preset / Stato' });
fPreset.addButton({ title: 'Esporta JSON' }).on('click', exportJson);
fPreset.addButton({ title: 'Importa JSON' }).on('click', importJson);
fPreset.addButton({ title: 'Reset default' }).on('click', resetDefaults);

// PERSISTENZA: salva su localStorage ad ogni modifica del pannello + prima di lasciare la pagina
// (insurance: garantisce il salvataggio anche se un evento 'change' sfuggisse).
pane.on('change', () => save());
window.addEventListener('beforeunload', save);
window.addEventListener('pagehide', save);

// Applica all'effetto i parametri eventualmente caricati da localStorage e allinea l'UI.
applyAll();
pane.refresh();

// --- Bottom bar (branding + selettore video + play/pausa), sincronizzata col pannello ---
overlayApi = createOverlay({
  videos: VIDEOS,
  currentSrc: PARAMS.videoSrc,
  paused: PARAMS.paused,
  onSelect: (src) => selectVideo(src),
  onTogglePlay: () => togglePlay(),
  onToggleSettings: () => toggleSettings(),
  settingsVisible: true,
});

// --- Controlli da tastiera (scorciatoie rapide; restano sincronizzati col pannello) ---
window.addEventListener('keydown', (e) => {
  if (e.key === '[') { PARAMS.gridCss = Math.max(5, PARAMS.gridCss - 1); ascii.cellSize = Math.round(PARAMS.gridCss * PIXEL_RATIO); pane.refresh(); save(); }
  if (e.key === ']') { PARAMS.gridCss = Math.min(144, PARAMS.gridCss + 1); ascii.cellSize = Math.round(PARAMS.gridCss * PIXEL_RATIO); pane.refresh(); save(); }
  if (e.key === 'c') { PARAMS.colorMode = (PARAMS.colorMode + 1) % 4; ascii.colorMode = PARAMS.colorMode; updateColorDisabled(); pane.refresh(); save(); }
});

// --- Debug ---
window.__ascii = ascii;
window.__pane = pane;
window.__memory = memoryGrid;
