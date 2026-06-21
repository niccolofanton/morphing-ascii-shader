// main.js
// Setup three.js: una scena con quad a tutto schermo (camera ortografica) che mostra una
// VideoTexture del video in loop. Sopra si applica l'effetto ASCII con la pipeline di
// postprocessing: EffectComposer -> RenderPass -> EffectPass(AsciiEffect).
// I parametri dell'effetto sono regolabili LIVE tramite un pannello Tweakpane.

import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BlendFunction } from 'postprocessing';
import { Pane } from 'tweakpane';
import { createDriftpane } from '@niccolofanton/driftpane';
import '@niccolofanton/driftpane/theme.css'; // skin "Apple-minimal" frosted di Driftpane
// La demo importa il toolkit dal suo entry point (lo stesso import che userebbe un consumer del
// pacchetto: `from 'evoling-aschii-shader'`). Qui puntiamo alla sorgente per il dev senza build.
import { AsciiEffect, DEFAULT_CHARSET, DEFAULT_EDGE_CHARS, MemoryGrid, InkBleedEffect } from '../src/index.js';
import { createOverlay } from './overlay.js';

// Sorgenti video (fonte unica: alimenta sia la bottom bar sia il picker Tweakpane).
// fit: come adattare il video allo schermo (vedi fitVideo). bad apple/fragole riempiono l'ALTEZZA;
// i fiori (1:1) restano 'contain' (che su schermo orizzontale equivale comunque a riempire l'altezza).
const VIDEOS = [
  { label: '17 flowers', src: 'assets/video.mp4', fit: 'contain' },
  { label: 'bad apple', src: 'assets/sample-badapple.mp4', fit: 'height' },
  { label: 'strawberries', src: 'assets/sample-strawberries.mp4', fit: 'height' },
];

// PRESET PER-TAB: ogni sorgente video ha un set COMPLETO di parametri (il "look" tarato per quel
// video), importato dagli export Driftpane. Selezionando una tab (bottom bar o dropdown) si
// applica il preset corrispondente. Chiave = src del video (deve combaciare con VIDEOS[].src).
const VIDEO_PRESETS = {
  // Preset "Bad Apple" — silhouette nette: contrasto alto, morph SDF, magnetismo pieno.
  'assets/sample-badapple.mp4': {
    gridCss: 18,
    charset: ' ·•+✦★○◯●',
    colorMode: 2,
    ink: { r: 0.451, g: 1, b: 0.451 },
    background: { r: 0, g: 0, b: 0 },
    whiteCutoff: 1,
    brightness: 0,
    contrast: 2,
    gamma: 1,
    edges: false,
    edgeThreshold: 0.3,
    edgeChars: '-|/\\',
    variety: 6,
    asciiBlend: 'NORMAL',
    asciiBlendOpacity: 1,
    bleedAmount: 2,
    bleedRadius: 29,
    bleedBlur: 1,
    bleedBlend: 'MULTIPLY',
    bleedBlendOpacity: 1,
    memoryOn: true,
    morphRate: 17,
    glyphBlend: true,
    magnet: 1.5,
    glyphScale: 1.92,
    sdfMorph: true,
    sdfThreshold: 0.43,
    sdfAA: 0.13,
    noise: 0.155,
    noiseScale: 5,
    noiseMode: 3,
    videoSrc: 'assets/sample-badapple.mp4',
    playbackRate: 1,
    paused: false,
  },
  // Preset "Fragole" — glifi grandi e poco vari su "preserva sfondo", trail rapido.
  'assets/sample-strawberries.mp4': {
    gridCss: 18,
    charset: ' ·•+✦★○◯●',
    colorMode: 1,
    ink: { r: 0.451, g: 1, b: 0.451 },
    background: { r: 0, g: 0, b: 0 },
    whiteCutoff: 1,
    brightness: 0.08,
    contrast: 1,
    gamma: 1,
    edges: false,
    edgeThreshold: 0.3,
    edgeChars: '-|/\\',
    variety: 0.4,
    asciiBlend: 'NORMAL',
    asciiBlendOpacity: 1,
    bleedAmount: 2,
    bleedRadius: 29,
    bleedBlur: 1,
    bleedBlend: 'MULTIPLY',
    bleedBlendOpacity: 1,
    memoryOn: true,
    morphRate: 17.4,
    glyphBlend: true,
    magnet: 1.5,
    glyphScale: 2.74,
    sdfMorph: true,
    sdfThreshold: 0.5,
    sdfAA: 0.105,
    noise: 0.155,
    noiseScale: 5,
    noiseMode: 3,
    videoSrc: 'assets/sample-strawberries.mp4',
    playbackRate: 1,
    paused: false,
  },
  // Preset "Fiori" — trail lungo (morph lento, magnetismo off), grana marcata.
  'assets/video.mp4': {
    gridCss: 20,
    charset: ' ·•+✦★○●',
    colorMode: 2,
    ink: { r: 0.451, g: 1, b: 0.451 },
    background: { r: 0, g: 0, b: 0 },
    whiteCutoff: 1,
    brightness: 0.08,
    contrast: 1,
    gamma: 1,
    edges: false,
    edgeThreshold: 0.3,
    edgeChars: '-|/\\',
    variety: 2.2,
    asciiBlend: 'NORMAL',
    asciiBlendOpacity: 1,
    bleedAmount: 2,
    bleedRadius: 29,
    bleedBlur: 1,
    bleedBlend: 'MULTIPLY',
    bleedBlendOpacity: 1,
    memoryOn: true,
    morphRate: 2.5,
    glyphBlend: true,
    magnet: 0,
    glyphScale: 1.9,
    sdfMorph: true,
    sdfThreshold: 0.46,
    sdfAA: 0.05,
    noise: 0.505,
    noiseScale: 3,
    noiseMode: 3,
    videoSrc: 'assets/video.mp4',
    playbackRate: 1,
    paused: false,
  },
};

// DEVICE → variante del preset. I 3 preset per-tab esistono in 2 varianti (6 in totale):
//   - DESKTOP: i literal qui sopra (gridCss 18 / 18 / 20);
//   - MOBILE : duplicato del desktop con la SOLA griglia DIMEZZATA (celle piu piccole = piu
//     dettaglio sullo schermo piccolo) -> 9 / 9 / 10.
// 'mobile' = puntatore touch (coarse, stabile alla rotazione) OPPURE viewport stretta (<=768px).
function isMobile() {
  return window.matchMedia('(pointer: coarse), (max-width: 768px)').matches;
}
// Ritorna il preset per il src nella variante adatta al device (mobile = desktop con gridCss/2).
function presetForSrc(src) {
  const base = VIDEO_PRESETS[src];
  if (!base) return null;
  if (!isMobile()) return base;
  return { ...base, gridCss: Math.max(5, Math.round(base.gridCss / 2)) };
}

// --- Riferimenti DOM ---
const canvas = document.getElementById('scene');
const video = document.getElementById('video');

// ALTEZZA della LARGE viewport (100vh / lvh). Su iOS Safari window.innerHeight riporta l'area
// VISIBILE (che si restringe quando appare la barra URL), mentre 100vh = large viewport ed e'
// COSTANTE al toggle della barra. Misuriamo 100vh con una probe e dimensioniamo il canvas su
// quella: cosi' il canvas riempie sempre lo schermo (100vh, anche dietro la barra) e NON si
// ridimensiona/ri-renderizza ad ogni comparsa/scomparsa della toolbar.
const _vhProbe = document.createElement('div');
_vhProbe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:100vh;visibility:hidden;pointer-events:none';
document.body.appendChild(_vhProbe);
function viewportW() { return window.innerWidth; }
function viewportH() { return _vhProbe.offsetHeight || window.innerHeight; }

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
// Il devicePixelRatio puo CAMBIARE a runtime (finestra spostata su un monitor con dpr diverso,
// retina <-> esterno 1x, zoom del browser): NON va "congelato" all'avvio. Lo rileggiamo sempre
// (cap a 2 per non esplodere il drawing buffer su display 3x) e lo riapplichiamo ad ogni resize.
function pixelRatio() { return Math.min(window.devicePixelRatio || 1, 2); }
renderer.setPixelRatio(pixelRatio());
renderer.setSize(viewportW(), viewportH());
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
  cellSize: Math.round(GRID_CSS * pixelRatio()),
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
  ascii.setGridSize(memoryGrid.gridW, memoryGrid.gridH); // no-alloc (prima: new Vector2 per frame)
}

// La cella e in pixel del DRAWING BUFFER, quindi la dimensione apparente in CSS px e
// gridCss SOLO se cellSize = round(gridCss * pixelRatio). Centralizziamo qui il calcolo
// (un'unica fonte) cosi cambia coerentemente al variare di gridCss o del devicePixelRatio.
function applyCellSize() {
  ascii.cellSize = Math.max(1, Math.round(PARAMS.gridCss * pixelRatio()));
}

// --- Ink bleed: PASS separato (bloom-like) a valle dell'ASCII ---
const inkBleed = new InkBleedEffect({ bleed: 0.5, radius: 24 });

// --- Pipeline postprocessing ---
// depthBuffer:false -> i due RT ping-pong NON allocano un depth renderbuffer: la scena e' un solo
// quad opaco (camera Ortho) e nessun pass legge la profondita' -> bit-identico, libera VRAM/banda.
// (Da ripristinare se in futuro si aggiunge un effetto che usa il depth, es. DoF/SSAO/Outline.)
const composer = new EffectComposer(renderer, { depthBuffer: false });
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
composer.addPass(new EffectPass(camera, ascii));
composer.addPass(new EffectPass(camera, inkBleed)); // ink bleed come pass separato dopo l'ASCII
composer.setSize(viewportW(), viewportH());

// GATE del RenderPass: quando il suo output NON puo' raggiungere l'immagine finale, saltarlo e'
// bit-identico (misurato: l'output ASCII e' byte-identico con scena reale o input qualsiasi).
// Redundant sse: blend ASCII = NORMAL e opacity = 1 (il wrapper dell'EffectPass scarta del tutto
// l'inputColor) AND memoria ON (l'ASCII campiona la memoria, non l'inputBuffer) AND edges OFF (il
// Sobel campionerebbe l'inputBuffer). Legge lo stato LIVE dell'effetto (non PARAMS) e va richiamato
// da OGNI punto che muta uno di questi quattro stati (vedi sotto). RenderPass.needsSwap=false, quindi
// disabilitarlo salta solo il render della scena senza alterare la topologia dei buffer.
function updateRenderPassGate() {
  const bm = ascii.blendMode;
  const redundant =
    bm.blendFunction === BlendFunction.NORMAL &&
    bm.opacity.value >= 1 &&
    ascii.useMemory === true &&
    ascii.edges === false;
  renderPass.enabled = !redundant;
}

// --- Aspect-fit del video (modalita PER-VIDEO, vedi VIDEOS[].fit) ---
// Il quad e a tutto schermo: senza correzione il video viene STRETCHATO alle proporzioni dello
// schermo. Adattiamo SCALANDO LA GEOMETRIA del quad cosi' la sua forma su schermo combacia con
// le proporzioni del video (niente stretch). Il MeshBasicMaterial resta intatto (color management
// invariato). La trasformazione e replicata sul pass di MemoryGrid, che campiona la VideoTexture
// con UV full-screen grezze. Modalita:
//   - 'contain': il video sta tutto a schermo, le bande sono il clear color (bianco).
//   - 'cover'  : il video riempie lo schermo, l'eccedenza viene ritagliata.
//   - 'height' : riempie sempre l'ALTEZZA (sy=1); ai lati crop o bande secondo l'aspect.
//   - 'width'  : riempie sempre la LARGHEZZA (sx=1); sopra/sotto crop o bande.
// Ricava il fit dalla sorgente CORRENTE dell'elemento video (non da PARAMS: fitVideo() gira
// anche in init, prima che PARAMS esista). 'contain' come default.
function videoFitMode() {
  const cur = video.currentSrc || video.src || '';
  return VIDEOS.find((v) => cur.endsWith(v.src))?.fit || 'contain';
}
function fitVideo() {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return; // metadata non ancora pronti: si rifa su 'loadedmetadata'
  const W = viewportW(), H = viewportH();
  if (!W || !H) return; // finestra degenerata: evita /0 e scale 0.
  const videoAspect = vw / vh;
  const screenAspect = W / H; // usa la LARGE viewport (lvh): coerente col canvas, stabile al toggle barra
  // Rapporto scala-x / scala-y necessario perche' la forma del quad su schermo == aspect del video.
  const r = videoAspect / screenAspect;
  const fit = videoFitMode();
  let sx = 1, sy = 1;
  if (fit === 'cover') {
    if (r < 1) sy = 1 / r; else sx = r;       // ingrandisci il lato corto -> crop dell'eccedenza
  } else if (fit === 'height') {
    sx = r;                                    // sy=1: altezza sempre piena; lati crop/bande
  } else if (fit === 'width') {
    sy = 1 / r;                                // sx=1: larghezza sempre piena; sopra/sotto crop/bande
  } else { // contain
    if (r < 1) sx = r; else sy = 1 / r;       // rimpicciolisci il lato lungo -> bande (lettera-box)
  }
  quad.scale.set(sx, sy, 1);
  // La memoria campiona la VideoTexture su UV full-screen: mappatura inversa schermo->video.
  // Fuori da [0,1] (bande della lettera-box) la MemoryGrid scrive il colore di sfondo (bianco).
  memoryGrid.setVideoTransform(1 / sx, 1 / sy, 0, 0);
}
// Ri-adatta ad ogni cambio di metadata video (primo load e cambio sorgente).
video.addEventListener('loadedmetadata', fitVideo);
fitVideo(); // tentativo immediato (se i metadata sono gia disponibili)

// --- Resize ---
// Dimensioniamo sulla LARGE viewport (viewportW/H). Su iOS la barra URL che appare/sparisce cambia
// innerHeight ma NON la large viewport: con la guardia w/h invariati saltiamo il lavoro pesante
// (re-size buffer + realloc memoria), evitando churn ad ogni toggle della toolbar. La card si
// riposiziona da sola in CSS (dvh), senza toccare il canvas.
let _lastW = 0, _lastH = 0;
function onResize() {
  const w = viewportW();
  const h = viewportH();
  if (!w || !h) return; // finestra degenerata (es. minimizzata): niente da fare, evita /0 e RT 0px.
  if (w === _lastW && h === _lastH) return; // solo la toolbar e' cambiata: il canvas (lvh) resta uguale.
  _lastW = w; _lastH = h;
  // Il devicePixelRatio puo essere cambiato (spostamento tra monitor / zoom): riallinealo SEMPRE.
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(w, h);
  composer.setSize(w, h);
  // Cella in device px: ricalcola dal dpr corrente cosi resta GRID_CSS px apparenti a ogni dpr.
  applyCellSize();
  // Rialloca la griglia di memoria alla nuova risoluzione (re-init a bianco).
  syncMemorySize();
  // Ricalcola l'aspect-fit: cambiando le proporzioni dello schermo cambiano scala quad e bande.
  fitVideo();
}
window.addEventListener('resize', onResize);
// Su iOS il viewport "large" diventa noto/cambia leggermente dopo il primo layout/orientamento:
// orientationchange e un re-check ritardato riallineano canvas + fit senza intervento utente.
window.addEventListener('orientationchange', () => setTimeout(onResize, 300));

// --- Loop di rendering ---
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  if (window.__benchHold) return; // bench: congela il loop durante la misura (no-op in uso normale)
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

// Applica il PRESET PER-TAB associato a una sorgente video: sovrascrive TUTTI i parametri col
// "look" tarato per quel video, poi applica all'effetto e sincronizza pannello + bottom bar.
// Ritorna true se per quel src esiste un preset. (ink/background sono oggetti -> clona per non
// mutare il literal del preset quando l'utente poi tocca i color picker.)
function applyVideoPreset(src) {
  const preset = presetForSrc(src); // variante desktop o mobile (griglia dimezzata) in base al device
  if (!preset) return false;
  Object.assign(PARAMS, JSON.parse(JSON.stringify(preset)));
  PARAMS.videoSrc = src; // garantisce coerenza col src richiesto
  applyAll();            // applica i parametri all'effetto + cambia/riavvia il video
  updateColorDisabled();
  updateMorphDisabled();
  pane.refresh();
  save();
  if (overlayApi) overlayApi.setActiveVideo(src);
  return true;
}

// Cambia sorgente video e SINCRONIZZA PARAMS + pannello Tweakpane + bottom bar.
// Se la tab ha un preset dedicato, applica quello (parametri completi); altrimenti cambia solo
// la sorgente.
function selectVideo(src) {
  if (applyVideoPreset(src)) return;
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

// Mostra/nasconde il pannello Tweakpane (bottone settings). Nascosto di DEFAULT.
let settingsVisible = false;
// Allinea la visibilita del pannello al flag. Driftpane sposta il pane dentro un container
// .driftpane-drag-container (draggabile): nascondiamo quello, cosi sparisce anche la maniglia.
function applySettingsVisibility() {
  const root = pane.element.closest('.driftpane-drag-container') || pane.element;
  root.classList.toggle('tp-hidden', !settingsVisible);
}
function toggleSettings() {
  settingsVisible = !settingsVisible;
  applySettingsVisibility();
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
  // Morph di forma (SDF) — sottomenu dedicato. Default OFF: comportamento identico a oggi.
  sdfMorph: ascii.sdfMorph,             // attiva il morph di FORMA (il glifo si trasforma nel target)
  sdfThreshold: ascii.sdfThreshold,     // spessore tratti (0.5 neutra)
  sdfAA: ascii.sdfAA,                   // morbidezza del bordo
  // Grana (cartella propria).
  noise: 0.155,                     // opacita del layer di grana
  noiseScale: 5,                    // dimensione della grana (px)
  noiseMode: 3,                     // modalita di fusione della grana (3 = Overlay)
  // Video.
  videoSrc: 'assets/video.mp4', // selected source (picker)
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
  'Normal': 'NORMAL',
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
// PERSISTENZA / PRESET / DRAG: delegati a DRIFTPANE (vedi createDriftpane piu sotto).
// Prima erano fatti a mano (localStorage + export/import/reset). Ora il layer Driftpane
// copre: persistenza dei valori, stato aperto/chiuso delle folder, drag del pannello e
// preset nominati con export/import JSON e reset.
// -------------------------------------------------------------------------------------

// Default dei parametri (snapshot prima di ogni ripristino): usati come fallback, es. se
// la sorgente video salvata non esiste piu.
const DEFAULTS = JSON.parse(JSON.stringify(PARAMS));

// Istanza Driftpane (creata dopo la costruzione del pannello).
let dp = null;
// Instrada i salvataggi dei cambi PROGRAMMATICI (tastiera / bottom bar) verso la
// persistenza di Driftpane: quei cambi fanno PARAMS + pane.refresh() e non emettono
// l'evento 'change' che Driftpane intercetta da solo per i cambi via UI del pannello.
function save() {
  if (dp) dp.persistence.scheduleSave();
}

// Applica TUTTI i parametri di PARAMS all'effetto/video. Necessario dopo load/import/reset:
// pane.refresh() aggiorna l'UI ma NON rilancia gli handler 'change' delle singole binding.
function applyAll() {
  applyCellSize();
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
  // Morph di forma (SDF).
  ascii.sdfMorph = PARAMS.sdfMorph;
  ascii.sdfThreshold = PARAMS.sdfThreshold;
  ascii.sdfAA = PARAMS.sdfAA;
  ascii.noise = PARAMS.noise;
  ascii.noiseScale = PARAMS.noiseScale;
  ascii.noiseMode = PARAMS.noiseMode;
  memoryGrid.rate = PARAMS.morphRate;
  setVideoSource(PARAMS.videoSrc);
  video.playbackRate = PARAMS.playbackRate;
  if (PARAMS.paused) video.pause(); else video.play().catch(() => {});
  updateRenderPassGate(); // ri-valuta se il RenderPass e' ridondante col nuovo stato
}

// (export/import JSON, reset e persistenza su localStorage sono ora forniti da Driftpane:
//  il menu Preset ha Esporta/Importa JSON + Resetta posizione, e la persistenza dei valori
//  e dello stato folder e automatica.)

const pane = new Pane({ title: 'ASCII Shader' });

// --- Cartella: Griglia ---
const fGrid = pane.addFolder({ title: 'Grid' });
fGrid.addBinding(PARAMS, 'gridCss', { label: 'cell (css px)', min: 5, max: 144, step: 1 })
  .on('change', () => { applyCellSize(); });

// --- Cartella: Caratteri ---
const fChars = pane.addFolder({ title: 'Characters' });
fChars.addBinding(PARAMS, 'charset', { label: 'set (light→dark)' })
  .on('change', (ev) => { ascii.charset = ev.value; });
fChars.addBinding(PARAMS, 'variety', { label: 'glyph variety', min: 0.0, max: 6.0, step: 0.1 })
  .on('change', (ev) => { ascii.variety = ev.value; });
fChars.addBinding(PARAMS, 'glyphScale', { label: 'glyph size', min: 0.3, max: 4.0, step: 0.01 })
  .on('change', (ev) => { ascii.glyphScale = ev.value; });

// --- Cartella: Grana (con la propria fusione) ---
const fGrain = pane.addFolder({ title: 'Grain' });
fGrain.addBinding(PARAMS, 'noise', { label: 'grain (opacity)', min: 0.0, max: 1.0, step: 0.01 })
  .on('change', (ev) => { ascii.noise = ev.value; });
fGrain.addBinding(PARAMS, 'noiseScale', { label: 'size', min: 1.0, max: 24.0, step: 0.5 })
  .on('change', (ev) => { ascii.noiseScale = ev.value; });
fGrain.addBinding(PARAMS, 'noiseMode', {
  label: 'blend ↔ output',
  options: {
    'Additive': 0,
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
fBleed.addBinding(PARAMS, 'bleedAmount', { label: 'intensity', min: 0.0, max: 2.0, step: 0.01 })
  .on('change', (ev) => { inkBleed.bleed = ev.value; });
fBleed.addBinding(PARAMS, 'bleedRadius', { label: 'bleed/blur radius (px)', min: 0.0, max: 80, step: 1 })
  .on('change', (ev) => { inkBleed.radius = ev.value; });
fBleed.addBinding(PARAMS, 'bleedBlur', { label: 'blur', min: 0.0, max: 1.0, step: 0.01 })
  .on('change', (ev) => { inkBleed.blur = ev.value; });
fBleed.addBinding(PARAMS, 'bleedBlend', { label: 'blend ↔ ASCII', options: BLEND_OPTIONS })
  .on('change', (ev) => { setBlend(inkBleed, ev.value, PARAMS.bleedBlendOpacity); });
fBleed.addBinding(PARAMS, 'bleedBlendOpacity', { label: 'opacity', min: 0.0, max: 1.0, step: 0.01 })
  .on('change', (ev) => { inkBleed.blendMode.opacity.value = ev.value; });

// --- Cartella: Memoria / Trail ---
const fMem = pane.addFolder({ title: 'Memory / Trail' });
fMem.addBinding(PARAMS, 'memoryOn', { label: 'memory' })
  .on('change', (ev) => { ascii.useMemory = ev.value; updateRenderPassGate(); });
fMem.addBinding(PARAMS, 'morphRate', { label: 'change speed (low=slow/trail, high=fast)', min: 0.075, max: 60, step: 0.05 })
  .on('change', (ev) => { memoryGrid.rate = ev.value; });
fMem.addBinding(PARAMS, 'glyphBlend', { label: 'glyph cross-fade' })
  .on('change', (ev) => { ascii.glyphBlend = ev.value; });
fMem.addBinding(PARAMS, 'magnet', { label: 'magnetism (0=off)', min: 0.0, max: 1.5, step: 0.01 })
  .on('change', (ev) => { ascii.magnet = ev.value; });
fMem.addButton({ title: 'reset memory' }).on('click', () => memoryGrid.reset());

// --- Cartella: Morph di forma (sperimentale) ---
// Il glifo si TRASFORMA progressivamente nella forma del target (morph di forma vero, come tra
// due volti) interpolando i distance field (SDF) dei glifi. I caratteri = keyframe. NON
// distruttivo: con "attivo" OFF il risultato e identico a prima. Richiede "cross-fade glifo"
// (Memoria/Trail) attivo per avere una transizione; i controlli sono disabilitati a OFF.
const fMorph = pane.addFolder({ title: 'Shape morph', expanded: false });
const morphCtrls = [];
const updateMorphDisabled = () => { morphCtrls.forEach((c) => { c.disabled = !PARAMS.sdfMorph; }); };
fMorph.addBinding(PARAMS, 'sdfMorph', { label: 'enabled' })
  .on('change', (ev) => { ascii.sdfMorph = ev.value; updateMorphDisabled(); });
morphCtrls.push(
  fMorph.addBinding(PARAMS, 'sdfThreshold', { label: 'stroke weight', min: 0.2, max: 0.8, step: 0.01 })
    .on('change', (ev) => { ascii.sdfThreshold = ev.value; }),
  fMorph.addBinding(PARAMS, 'sdfAA', { label: 'edge softness', min: 0.0, max: 0.3, step: 0.005 })
    .on('change', (ev) => { ascii.sdfAA = ev.value; }),
);
updateMorphDisabled();

// --- Cartella: Luminanza ---
const fLum = pane.addFolder({ title: 'Luminance' });
fLum.addBinding(PARAMS, 'brightness', { min: -0.5, max: 0.5, step: 0.01 })
  .on('change', (ev) => { ascii.brightness = ev.value; });
fLum.addBinding(PARAMS, 'contrast', { min: 0.0, max: 3.0, step: 0.01 })
  .on('change', (ev) => { ascii.contrast = ev.value; });
fLum.addBinding(PARAMS, 'gamma', { min: 0.2, max: 3.0, step: 0.01 })
  .on('change', (ev) => { ascii.gamma = ev.value; });

// --- Cartella: Colore ---
const fColor = pane.addFolder({ title: 'Color' });
// Abilita 'inchiostro' solo in modalita 0 (ink classico) e 'sfondo' nelle modalita che lo usano
// (0 ink classico, 3 video su sfondo). Le altre modalita non li usano -> binding disabilitato.
const updateColorDisabled = () => {
  inkBinding.disabled = PARAMS.colorMode !== 0;
  bgBinding.disabled = !(PARAMS.colorMode === 0 || PARAMS.colorMode === 3);
};
fColor.addBinding(PARAMS, 'colorMode', {
  label: 'mode',
  options: {
    'video on white (default)': 2,
    'video on background': 3,
    'classic ink on bg': 0,
    'preserve background': 1,
  },
}).on('change', (ev) => { ascii.colorMode = ev.value; updateColorDisabled(); });
// Fusione del layer ASCII col video sottostante (compositing del layer principale).
fColor.addBinding(PARAMS, 'asciiBlend', { label: 'ASCII ↔ video', options: BLEND_OPTIONS })
  .on('change', (ev) => { setBlend(ascii, ev.value, PARAMS.asciiBlendOpacity); updateRenderPassGate(); });
fColor.addBinding(PARAMS, 'asciiBlendOpacity', { label: 'ASCII opacity', min: 0.0, max: 1.0, step: 0.01 })
  .on('change', (ev) => { ascii.blendMode.opacity.value = ev.value; updateRenderPassGate(); });
const inkBinding = fColor.addBinding(PARAMS, 'ink', { label: 'ink', color: { type: 'float' } })
  .on('change', (ev) => { syncColor(ascii.ink, ev.value); });
const bgBinding = fColor.addBinding(PARAMS, 'background', { label: 'background', color: { type: 'float' } })
  .on('change', (ev) => { syncColor(ascii.background, ev.value); });
fColor.addBinding(PARAMS, 'whiteCutoff', { label: 'white cutoff', min: 0.0, max: 1.0, step: 0.01 })
  .on('change', (ev) => { ascii.whiteCutoff = ev.value; });
updateColorDisabled();

// --- Cartella: Contorni (Sobel) ---
const fEdge = pane.addFolder({ title: 'Edges (Sobel)' });
fEdge.addBinding(PARAMS, 'edges', { label: 'enabled' })
  .on('change', (ev) => { ascii.edges = ev.value; updateRenderPassGate(); });
fEdge.addBinding(PARAMS, 'edgeThreshold', { label: 'threshold', min: 0.0, max: 2.0, step: 0.01 })
  .on('change', (ev) => { ascii.edgeThreshold = ev.value; });
fEdge.addBinding(PARAMS, 'edgeChars', { label: 'glyphs (- | / \\)' })
  .on('change', (ev) => { ascii.edgeChars = ev.value; });

// --- Cartella: Video ---
const fVideo = pane.addFolder({ title: 'Video' });
fVideo.addBinding(PARAMS, 'videoSrc', {
  label: 'source',
  options: Object.fromEntries(VIDEOS.map((v) => [v.label, v.src])),
}).on('change', (ev) => selectVideo(ev.value));
fVideo.addBinding(PARAMS, 'playbackRate', { label: 'speed', min: 0.1, max: 3.0, step: 0.05 })
  .on('change', (ev) => { video.playbackRate = ev.value; });
fVideo.addBinding(PARAMS, 'paused', { label: 'paused' })
  .on('change', (ev) => { ev.value ? video.pause() : video.play().catch(() => {}); if (overlayApi) overlayApi.setPlaying(ev.value); });

// --- DRIFTPANE: persistenza valori + stato folder, drag del pannello, preset nominati ---
// Una riga abilita le 4 feature; sostituisce la cartella "Preset / Stato" e tutta la
// persistenza fatta a mano. Il menu "Preset" (in cima al pannello) offre salva / applica /
// rinomina / esporta+importa JSON e resetta posizione.
dp = createDriftpane(pane, {
  storageNamespace: 'evoling-ascii-shader',
  draggable: true,
  presetsEnabled: true,
  presetFolderTitle: 'Presets',
  clampToViewport: true,
  theme: 'light', // skin chiara (Driftpane setta data-theme="light" sul pannello)
  // Mostra TUTTI i controlli opzionali del menu preset (di default nascosti):
  // selettore tema, "Resetta posizione" ed "Elimina preset".
  showThemeControl: true,
  showResetPosition: true,
  showDeletePreset: true,
});

// Driftpane ha gia ripristinato lo stato salvato (valori + stato folder) via
// pane.importState(), che NON rilancia gli handler 'change' delle singole binding:
// riallineiamo l'effetto a PARAMS e l'abilitazione condizionale dei color picker.
// Se la sorgente video salvata non esiste piu tra quelle disponibili, torniamo al default.
if (!VIDEOS.some((v) => v.src === PARAMS.videoSrc)) PARAMS.videoSrc = DEFAULTS.videoSrc;
// Applica il preset per-tab del video iniziale (la tab attiva deve mostrare il suo look anche
// al primo caricamento). Fallback ad applyAll() se per quel src non esistesse un preset.
if (!applyVideoPreset(PARAMS.videoSrc)) applyAll();
updateColorDisabled();
updateMorphDisabled();
pane.refresh();
// Pannello nascosto di default: applica lo stato iniziale al container Driftpane.
applySettingsVisibility();

// --- Bottom bar (branding + selettore video + play/pausa), sincronizzata col pannello ---
overlayApi = createOverlay({
  videos: VIDEOS,
  currentSrc: PARAMS.videoSrc,
  paused: PARAMS.paused,
  onSelect: (src) => selectVideo(src),
  onTogglePlay: () => togglePlay(),
  onToggleSettings: () => toggleSettings(),
  settingsVisible: settingsVisible,
});

// --- Controlli da tastiera (scorciatoie rapide; restano sincronizzati col pannello) ---
window.addEventListener('keydown', (e) => {
  if (e.key === '[') { PARAMS.gridCss = Math.max(5, PARAMS.gridCss - 1); applyCellSize(); pane.refresh(); save(); }
  if (e.key === ']') { PARAMS.gridCss = Math.min(144, PARAMS.gridCss + 1); applyCellSize(); pane.refresh(); save(); }
  if (e.key === 'c') { PARAMS.colorMode = (PARAMS.colorMode + 1) % 4; ascii.colorMode = PARAMS.colorMode; updateColorDisabled(); pane.refresh(); save(); }
});

// --- Debug ---
window.__ascii = ascii;
window.__pane = pane;
window.__memory = memoryGrid;
window.__inkBleed = inkBleed;
window.__composer = composer;
window.__renderer = renderer;
window.__scene = scene;
window.__camera = camera;
window.__quad = quad;
window.__video = video;

// BENCH GPU per-pass / per-step: attivo SOLO con ?bench (vedi examples/bench.js). Non altera la
// resa (congela il loop, misura, ripristina, riprende). Risultato in window.__benchResult.
if (new URLSearchParams(location.search).has('bench')) {
  window.__benchHold = false;
  const start = () => import('./bench.js')
    .then((m) => m.runBenchmark({
      renderer, composer, scene, camera, memoryGrid, ascii, inkBleed, video,
      hold: (v) => { window.__benchHold = v; },
    }))
    .then((r) => { window.__benchResult = r; window.__benchDone = true; })
    .catch((e) => { window.__benchError = String(e); window.__benchDone = true; console.error(e); });
  // Attende un frame decodificato + breve warmup (video in play, memoria popolata) per misurare a regime.
  const waitReady = () => { (video.readyState >= 2) ? setTimeout(start, 1500) : setTimeout(waitReady, 200); };
  waitReady();
}
