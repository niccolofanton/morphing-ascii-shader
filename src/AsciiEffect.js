// AsciiEffect.js
// Effetto ASCII come sottoclasse di "Effect" della libreria postprocessing (pmndrs).
//
// TECNICA (riferimento adottato):
//  - Mappatura LUMINANZA -> GLIFO tramite ATLANTE costruito a runtime con canvas2D,
//    campionato per UV. Approccio di Maxime Heckel:
//    https://blog.maximeheckel.com/posts/post-processing-as-a-creative-medium/
//    (rebuild dell'ASCII effect di three.js con un atlante di glifi su texture).
//  - EDGE DETECTION con operatore SOBEL e GLIFI DIREZIONALI dedicati ai contorni
//    ( | _ / \ ) scelti in base all'angolo del gradiente. Tecnica del renderer ASCII
//    con edge-detection di humanbydefinition:
//    https://github.com/humanbydefinition/p5js-edge-detection-ascii-renderer
//
// Lo schermo e suddiviso in CELLE quadrate (uCellSize px nel drawing buffer). Per ogni
// cella si campiona il colore/luminanza al centro, si applica brightness/contrast/gamma,
// si sceglie il glifo (densita o, se sul bordo, glifo direzionale del contorno) e lo si
// disegna prelevandolo dall'atlante. NB: l'inputBuffer di postprocessing e LINEARE.

import { Effect } from 'postprocessing';
import { Texture, Uniform, Vector2, Vector3, LinearFilter, RGBAFormat } from 'three';

// Set di caratteri ordinato da "vuoto/chiaro" a "denso/scuro".
// Simboli scelti per somigliare all'immagine di riferimento: puntini, plus, sparkle,
// stelle e cerchi (vuoti/pieni). Lo spazio iniziale = bianco -> nessun glifo.
export const DEFAULT_CHARSET = ' ·•+✦★○◯●';
// Glifi direzionali per i contorni (ordine fisso: orizzontale, verticale, diag /, diag \).
export const DEFAULT_EDGE_CHARS = '-|/\\';

// Costruisce un atlante orizzontale di N glifi (uno per carattere), bianco su trasparente:
// nello shader usiamo il canale alpha come maschera di presenza del glifo.
// Glifi NITIDI: l'ink bleed e ora un PASS separato a valle (vedi InkBleed.js), non piu un
// alone per-glifo cotto nell'atlante.
function buildGlyphAtlas(charset, glyphSize = 96) {
  const count = Math.max(1, charset.length);
  const canvas = document.createElement('canvas');
  canvas.width = glyphSize * count;
  canvas.height = glyphSize;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.floor(glyphSize * 0.58)}px "Helvetica Neue", Arial, "Apple Symbols", sans-serif`;

  for (let i = 0; i < count; i++) {
    ctx.fillText(charset[i], i * glyphSize + glyphSize / 2, glyphSize / 2);
  }

  const texture = new Texture(canvas);
  texture.format = RGBAFormat;
  texture.magFilter = LinearFilter; // alone morbido (no blocchettatura)
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, count };
}

// --- Distance transform 1D (Felzenszwalb-Huttenlocher, O(n)) ---
// Per ogni indice q calcola min_p( f[p] + (q-p)^2 ): la distanza euclidea AL QUADRATO al
// "seed" (costo 0) piu vicino lungo una riga/colonna. Applicata su righe e colonne -> EDT 2D.
function _edt1d(f, d, v, z, n) {
  let k = 0;
  v[0] = 0;
  z[0] = -1e20;
  z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = 1e20;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dx = q - v[k];
    d[q] = dx * dx + f[v[k]];
  }
}

// EDT 2D in-place su 'grid' (W x H di costi): prima colonne, poi righe. A fine 'grid' contiene
// la distanza euclidea AL QUADRATO verso la cella-seed (costo 0) piu vicina.
function _edt2d(grid, W, H) {
  const maxd = Math.max(W, H);
  const d = new Float64Array(maxd);
  const v = new Int32Array(maxd);
  const z = new Float64Array(maxd + 1);
  const buf = new Float64Array(maxd);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) buf[y] = grid[y * W + x];
    _edt1d(buf, d, v, z, H);
    for (let y = 0; y < H; y++) grid[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) buf[x] = grid[y * W + x];
    _edt1d(buf, d, v, z, W);
    for (let x = 0; x < W; x++) grid[y * W + x] = d[x];
  }
}

// Costruisce un atlante SDF (signed distance field) dei glifi, con la STESSA geometria e
// orientamento dell'atlante alpha (Texture da canvas -> stesso flipY). Nel canale: 0.5 = bordo,
// >0.5 dentro, <0.5 fuori, su un range di +/- 'spread' px. Serve al MORPH DI FORMA: interpolando
// la distanza tra due glifi e sogliando, la forma di uno si trasforma progressivamente nell'altro.
// Generazione una tantum (init / cambio charset) via EDT separabile -> pochi ms.
function buildSdfAtlas(charset, glyphSize = 96, spread = 12) {
  const count = Math.max(1, charset.length);
  const canvas = document.createElement('canvas');
  canvas.width = glyphSize * count;
  canvas.height = glyphSize;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.floor(glyphSize * 0.58)}px "Helvetica Neue", Arial, "Apple Symbols", sans-serif`;
  for (let i = 0; i < count; i++) {
    ctx.fillText(charset[i], i * glyphSize + glyphSize / 2, glyphSize / 2);
  }

  const W = glyphSize, H = glyphSize;
  const src = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const out = new Uint8ClampedArray(canvas.width * canvas.height * 4);

  const mask = new Uint8Array(W * H);
  const inside = new Float64Array(W * H);
  const outside = new Float64Array(W * H);
  const INF = 1e20;

  for (let g = 0; g < count; g++) {
    let anyIn = false, anyOut = false;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const a = src.data[(y * src.width + (g * W + x)) * 4 + 3]; // alpha del glifo (0..255)
        const isIn = a > 127;
        const p = y * W + x;
        mask[p] = isIn ? 1 : 0;
        if (isIn) { inside[p] = 0; outside[p] = INF; anyIn = true; }
        else { inside[p] = INF; outside[p] = 0; anyOut = true; }
      }
    }
    // inside[]  -> dist^2 al pixel INSIDE piu vicino  (valida per i pixel FUORI)
    // outside[] -> dist^2 al pixel OUTSIDE piu vicino (valida per i pixel DENTRO)
    _edt2d(inside, W, H);
    _edt2d(outside, W, H);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        let signed;
        if (!anyIn) signed = -spread;        // glifo vuoto (es. lo spazio): tutto "fuori"
        else if (!anyOut) signed = spread;   // glifo pieno
        else signed = mask[p] ? Math.sqrt(outside[p]) : -Math.sqrt(inside[p]);
        let v01 = 0.5 + (signed / spread) * 0.5;   // 0.5 = bordo, >0.5 dentro
        v01 = v01 < 0 ? 0 : v01 > 1 ? 1 : v01;
        const oi = (y * canvas.width + (g * W + x)) * 4;
        const byte = Math.round(v01 * 255);
        out[oi] = byte; out[oi + 1] = byte; out[oi + 2] = byte; out[oi + 3] = 255;
      }
    }
  }

  ctx.putImageData(new ImageData(out, canvas.width, canvas.height), 0, 0);
  const texture = new Texture(canvas);
  texture.format = RGBAFormat;
  texture.magFilter = LinearFilter; // filtro lineare SULLA DISTANZA = bordo liscio sub-texel
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, count };
}

// Fragment shader (convenzione postprocessing: mainImage(inputColor, uv, outputColor)).
// "inputBuffer" e "resolution" sono forniti dall'EffectPass.
const FRAGMENT = /* glsl */ `
uniform sampler2D uGlyphAtlas;  // atlante glifi di densita (orizzontale)
uniform float uGlyphCount;      // numero glifi di densita
uniform sampler2D uEdgeAtlas;   // atlante glifi direzionali dei contorni
uniform float uEdgeCount;       // numero glifi contorno (tipicamente 4)
uniform float uCellSize;        // dimensione cella in pixel (drawing buffer)
uniform bool  uInvert;          // inverte la mappatura luminanza->glifo
uniform int   uColorMode;       // 0=ink su nero | 1=preserva sfondo | 2=glifi col video su bianco | 3=glifi su bgColor
uniform vec3  uInk;             // colore glifi (modalita 0)
uniform vec3  uBackground;      // colore di sfondo (modalita 0/3)
uniform float uWhiteCutoff;     // soglia "bianco" (luma lineare): sopra -> niente glifo
uniform float uBrightness;      // offset luminanza
uniform float uContrast;        // contrasto
uniform float uGamma;           // correzione gamma
uniform bool  uEdges;           // edge-detection on/off
uniform float uEdgeThreshold;   // soglia magnitudine gradiente Sobel
uniform float uVariety;         // varieta del glifo per cella (jitter deterministico)

// --- Memoria per-cella (morph temporale) ---
uniform sampler2D uMemory;      // colore memorizzato per cella (lineare), un texel per cella
uniform bool  uUseMemory;       // se true usa la memoria al posto del campione live
uniform vec2  uGridSize;        // numero celle (colonne, righe) della texture memoria

// --- Resa glifo ---
uniform float uGlyphScale;      // scala del glifo dentro la cella (0.1..1.0)
uniform bool  uGlyphBlend;      // cross-fade tra glifi adiacenti invece di scatto
uniform float uMagnet;          // 0..1: magnetismo del cross-fade (alto = aggancio piu deciso/precoce)

// --- Morph di FORMA (SDF) ---
// I glifi sono anche un atlante SDF (signed distance field). Interpolando la DISTANZA tra glifo
// A e B e poi sogliando, la forma di A si TRASFORMA progressivamente in quella di B passando per
// forme intermedie connesse (come un morph tra volti). I caratteri del charset = "keyframe".
uniform sampler2D uGlyphSdf;        // atlante SDF dei glifi di densita (0.5 = bordo, >0.5 dentro)
uniform bool  uSdfMorph;            // usa il morph di forma (SDF) al posto del cross-fade alpha
uniform float uSdfAA;               // ampiezza dell'antialias della soglia (0 = netto, alto = morbido)
uniform float uSdfThreshold;        // soglia (0.5 = neutra; <0.5 ingrassa, >0.5 assottiglia i tratti)

// --- Texture / grana ---
uniform float uColorVar;        // mottlatura per-carattere: spot leggermente piu chiari/scuri (soft)
uniform float uNoise;           // grana (film grain) STATICA sopra tutto: ora = OPACITA del layer
uniform float uNoiseScale;      // dimensione della grana in pixel (1 = puntinato fine, alto = blocchi grossi)
uniform int   uNoiseMode;       // modalita di fusione della grana col colore (vedi blendNoise)

// Luminanza percepita.
float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

// Hash + value-noise (per mottlatura e grana).
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Applica gamma/contrast/brightness ad una luminanza grezza (0..1).
float tuneLuma(float l) {
  l = pow(clamp(l, 0.0, 1.0), 1.0 / max(uGamma, 0.001)); // gamma
  l = (l - 0.5) * uContrast + 0.5 + uBrightness;          // contrast + brightness
  return clamp(l, 0.0, 1.0);
}

// Luminanza dell'inputBuffer ad una uv, con brightness/contrast/gamma applicati.
float tunedLuma(vec2 uvp) {
  return tuneLuma(luma(texture2D(inputBuffer, uvp).rgb));
}

// Campiona la maschera (alpha) di un glifo di densita dall'indice 'idx' usando la coord
// locale 'p' [0,1] dentro la cella. Fuori range -> 0.
float sampleGlyph(float idx, vec2 p) {
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return 0.0;
  idx = clamp(idx, 0.0, uGlyphCount - 1.0);
  vec2 atlasUv = vec2((idx + p.x) / uGlyphCount, p.y);
  return texture2D(uGlyphAtlas, atlasUv).a;
}

// Campiona la DISTANZA CON SEGNO (0.5 = bordo, >0.5 dentro) del glifo 'idx' alla coord locale
// 'p'. Fuori cella -> 0 (ben "fuori"), cosi l'interpolazione non aggancia il bordo dal vuoto.
float sampleSdf(float idx, vec2 p) {
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return 0.0;
  idx = clamp(idx, 0.0, uGlyphCount - 1.0);
  vec2 atlasUv = vec2((idx + p.x) / uGlyphCount, p.y);
  return texture2D(uGlyphSdf, atlasUv).r;
}

// Fonde un layer di grana grigia 'n' (0..1) sul colore 'base' con una BLEND MODE (stile Photoshop).
// Restituisce il colore "a opacita piena"; l'opacita reale e applicata fuori (mix con uNoise).
vec3 blendNoise(vec3 base, float n, int mode) {
  vec3 b = clamp(base, 0.0, 1.0);
  vec3 s = vec3(n);
  vec3 r;
  if (mode == 0) {        // Additivo (neutro): grana centrata su 0, non sposta la luminanza media
    r = b + (n - 0.5);
  } else if (mode == 1) { // Multiply: scurisce
    r = b * s;
  } else if (mode == 2) { // Screen: schiarisce
    r = 1.0 - (1.0 - b) * (1.0 - s);
  } else if (mode == 3) { // Overlay: contrasto (multiply nelle ombre, screen nelle luci)
    r = mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
  } else if (mode == 4) { // Soft Light (Pegtop): contrasto morbido
    r = (1.0 - 2.0 * s) * b * b + 2.0 * s * b;
  } else if (mode == 5) { // Linear Burn: scurisce in modo deciso
    r = max(b + s - 1.0, 0.0);
  } else if (mode == 6) { // Color Burn
    r = 1.0 - (1.0 - b) / max(s, 1e-3);
  } else if (mode == 7) { // Color Dodge
    r = b / max(1.0 - s, 1e-3);
  } else {
    r = b;
  }
  return clamp(r, 0.0, 1.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 fragPx = uv * resolution;

  // Cella che contiene questo frammento.
  vec2 cellIndex = floor(fragPx / uCellSize);
  vec2 cellOriginPx = cellIndex * uCellSize;
  vec2 cellCenterUv = (cellOriginPx + uCellSize * 0.5) / resolution;

  // Colore/luminanza rappresentativi della cella.
  // Con la MEMORIA attiva il colore deriva dalla texture di stato (un texel per cella),
  // campionata al CENTRO della cella -> uv = (cellIndex + 0.5) / uGridSize (stessa
  // convenzione del pass di update). Altrimenti campione LIVE dall'inputBuffer.
  // activity = ATTIVITA DI MORPH della cella (canale ALPHA della memoria): ~0 ferma, ~1 in transizione.
  // Senza memoria non c'e transizione temporale per-cella -> activity=0 (blend "magnetico" disattivo).
  vec3 cellColor;
  float activity = 0.0;
  if (uUseMemory) {
    vec2 memUv = (cellIndex + 0.5) / uGridSize;
    vec4 mem = texture2D(uMemory, memUv);
    cellColor = mem.rgb;
    activity = mem.a;
  } else {
    cellColor = texture2D(inputBuffer, cellCenterUv).rgb;
  }
  float lumRaw = luma(cellColor);
  float lum = tuneLuma(lumRaw); // la luminanza per glifo/cutoff DERIVA dal colore della cella

  // Coordinata locale [0,1] dentro la cella.
  vec2 local = (fragPx - cellOriginPx) / uCellSize;
  // Scala glifo: rimappa attorno al centro cella. uGlyphScale<1 -> glifo piu piccolo
  // (margine vuoto), indipendentemente dalla densita della griglia (uCellSize).
  vec2 pScaled = (local - 0.5) / max(uGlyphScale, 0.001) + 0.5;

  // --- SOBEL edge-detection campionato sulle celle vicine (passo = una cella) ---
  float mask = 0.0;
  bool drewEdge = false;
  if (uEdges) {
    vec2 step = uCellSize / resolution;
    float tl = tunedLuma(cellCenterUv + vec2(-step.x,  step.y));
    float t  = tunedLuma(cellCenterUv + vec2(0.0,      step.y));
    float tr = tunedLuma(cellCenterUv + vec2( step.x,  step.y));
    float l  = tunedLuma(cellCenterUv + vec2(-step.x,  0.0));
    float r  = tunedLuma(cellCenterUv + vec2( step.x,  0.0));
    float bl = tunedLuma(cellCenterUv + vec2(-step.x, -step.y));
    float b  = tunedLuma(cellCenterUv + vec2(0.0,     -step.y));
    float br = tunedLuma(cellCenterUv + vec2( step.x, -step.y));

    float gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
    float gy =  tl + 2.0*t + tr - bl - 2.0*b - br;
    float mag = length(vec2(gx, gy));

    if (mag > uEdgeThreshold) {
      // Il CONTORNO e PERPENDICOLARE al gradiente. Atlante contorni: 0:- 1:| 2:/ 3:\\ .
      // Angolo del gradiente ripiegato in [0, PI); 4 settori da PI/4.
      float ang = atan(gy, gx);                      // [-PI, PI]
      float a = mod(ang + 3.14159265, 3.14159265);   // [0, PI)
      float sector = floor(a / (3.14159265 / 4.0));  // 0..3
      float edgeIdx;
      if (sector == 0.0)      edgeIdx = 1.0; // gradiente ~orizz -> contorno | (verticale)
      else if (sector == 1.0) edgeIdx = 2.0; // gradiente ~45deg  -> contorno /
      else if (sector == 2.0) edgeIdx = 0.0; // gradiente ~vert   -> contorno - (orizz)
      else                    edgeIdx = 3.0; // gradiente ~135deg -> contorno \\
      edgeIdx = clamp(edgeIdx, 0.0, uEdgeCount - 1.0);
      // Glifo contorno con scala applicata (margine vuoto fuori [0,1]).
      if (pScaled.x >= 0.0 && pScaled.x <= 1.0 && pScaled.y >= 0.0 && pScaled.y <= 1.0) {
        vec2 eUv = vec2((edgeIdx + pScaled.x) / uEdgeCount, pScaled.y);
        mask = texture2D(uEdgeAtlas, eUv).a;
      } else {
        mask = 0.0;
      }
      drewEdge = true;
    }
  }

  // --- Glifo di DENSITA (se non abbiamo disegnato un contorno) ---
  if (!drewEdge) {
    float t = clamp(1.0 - lum, 0.0, 1.0);     // chiaro -> glifo vuoto, scuro -> denso
    if (uInvert) t = 1.0 - t;
    float base = t * (uGlyphCount - 1.0);
    // Jitter deterministico per cella (no flicker): a parita di luminanza mostra glifi
    // diversi (stella/cerchio/plus...) per ricreare il mix dell'immagine di riferimento.
    // Applicato PRIMA della scelta dell'indice (sia a scatto che in cross-fade).
    float h = fract(sin(dot(cellIndex, vec2(12.9898, 78.233))) * 43758.5453);
    base = base + (h - 0.5) * 2.0 * uVariety;
    if (uGlyphBlend) {
      // CROSS-FADE "MAGNETICO": il blend tra glifi adiacenti e una TRANSIZIONE, non uno stato
      // stazionario. In pieno morph (activity alta) -> cross-fade pieno (f); a cella ferma
      // (activity ~0) -> aggancio a UN glifo netto (round del fract -> 0 o 1).
      float i = floor(base);
      float f = fract(base);
      // "quanto siamo in transizione" (0 assestati, 1 in pieno morph).
      // NB: 'active' e parola riservata in GLSL ES -> uso 'morphAmt'.
      float morphAmt = clamp(activity * 3.0, 0.0, 1.0); // quanto siamo in transizione (0..1)
      // uMagnet alto -> zona di blend stretta -> aggancio piu precoce/deciso.
      float blendZone = max(0.04, mix(1.0, 0.08, uMagnet)); // floor: sicuro anche con magnetismo > 1
      float tFade = smoothstep(0.0, blendZone, morphAmt);
      // 'snap' = quanto agganciare al glifo netto: 0 in transizione, fino a uMagnet quando
      // la cella e assestata. uMagnet=0 -> snap=0 sempre -> CROSS-FADE PURO (magnetismo OFF).
      float snap = clamp((1.0 - tFade) * uMagnet, 0.0, 1.0); // clamp: magnetismo > 1 non sfora
      // aggancio MORBIDO (anti-flicker): vicino alla soglia 0.5 sfuma invece di scattare di colpo.
      float snapped = smoothstep(0.5 - 0.12, 0.5 + 0.12, f);
      float fAdj = mix(f, snapped, snap);
      if (uSdfMorph) {
        // MORPH DI FORMA (SDF): interpolo la DISTANZA con segno dei due glifi e soglio. La forma
        // di A si TRASFORMA progressivamente in quella di B passando per forme intermedie (come
        // un morph di volti). I caratteri sono i "keyframe"; fAdj e' il parametro di morph (0=A,
        // 1=B), gia agganciato a un glifo netto a cella ferma dal sistema magnetico.
        float dA = sampleSdf(i,       pScaled);
        float dB = sampleSdf(i + 1.0, pScaled);
        float d = mix(dA, dB, fAdj);                  // distanza interpolata = forma intermedia
        float aa = max(uSdfAA, 0.001);
        mask = smoothstep(uSdfThreshold - aa, uSdfThreshold + aa, d);
      } else {
        mask = mix(sampleGlyph(i, pScaled), sampleGlyph(i + 1.0, pScaled), fAdj);
      }
    } else {
      // Comportamento a scatti (default).
      float glyph = clamp(floor(base + 0.5), 0.0, uGlyphCount - 1.0);
      mask = sampleGlyph(glyph, pScaled);
    }
  }

  // Cella (quasi) bianca -> nessun glifo visibile (cutoff su luma LINEARE grezza).
  float notWhite = 1.0 - step(uWhiteCutoff, lumRaw);

  // MOTTLATURA per-carattere: spot piu chiari/scuri DENTRO il glifo (texture organica).
  // Frequenza FISSA in screen-space (~macchie morbide, indipendenti dalla cella) e gain *2
  // perche fosse percepibile: a default ~+/-20% sul colore del glifo, a max molto marcata.
  // Guard bit-identico: a uColorVar==0 la mottlatura e' un no-op (mott=1.0), ma vnoise (4x hash +
  // bilineare) veniva comunque calcolata per ogni pixel. Saltandola il risultato e' identico.
  float mott = 1.0;
  if (uColorVar != 0.0) mott = 1.0 + (vnoise(fragPx * 0.08) - 0.5) * 2.0 * uColorVar;
  vec3 ink = cellColor * mott;     // colore del carattere, mottlato

  if (uColorMode == 0) {
    // Classico: glifi colore uInk su sfondo uBackground.
    outputColor = vec4(mix(uBackground, uInk * mott, mask), 1.0);
  } else if (uColorMode == 1) {
    // Preserva sfondo: glifi scuri "stampati" sul colore della cella.
    outputColor = vec4(mix(ink, vec3(0.05), mask), 1.0);
  } else if (uColorMode == 2) {
    // Default: sfondo BIANCO, glifi col COLORE del video; invisibili dove e bianco.
    outputColor = vec4(mix(vec3(1.0), ink, mask * notWhite), 1.0);
  } else {
    // Glifi col colore del video su uno sfondo configurabile (uBackground).
    outputColor = vec4(mix(uBackground, ink, mask * notWhite), 1.0);
  }

  // GRANA (film grain) STATICA SOPRA TUTTO, fusa col colore tramite una BLEND MODE.
  // uNoiseScale quantizza la coordinata pixel -> grana piu grossa (blocchi) con valori alti.
  // uNoise = OPACITA del layer; uNoiseMode = modalita di fusione (additivo, multiply, overlay, burn...).
  // Guard bit-identico: a uNoise==0 il mix() e' un no-op, ma hash21+blendNoise venivano comunque
  // calcolati. Saltandoli il risultato e' identico. NB: il clamp finale e' LOAD-BEARING (l'rgb
  // pre-grana puo superare 1.0 e l'InkBleed a valle assume input in [0,1]) -> va fatto su ENTRAMBI i rami.
  if (uNoise != 0.0) {
    float g = hash21(floor(fragPx / max(uNoiseScale, 1.0))); // grana STATICA (dipende solo dal pixel, non dal tempo)
    vec3 grainCol = blendNoise(outputColor.rgb, g, uNoiseMode);
    outputColor.rgb = clamp(mix(outputColor.rgb, grainCol, uNoise), 0.0, 1.0);
  } else {
    outputColor.rgb = clamp(outputColor.rgb, 0.0, 1.0);
  }
}
`;

export class AsciiEffect extends Effect {
  /**
   * @param {Object} [options]
   * @param {string}  [options.charset]       glifi di densita (chiaro -> scuro)
   * @param {string}  [options.edgeChars]      glifi contorni (ordine: - | / \)
   * @param {number}  [options.cellSize]       dimensione cella in pixel (drawing buffer)
   * @param {boolean} [options.invert]         inverte mappatura luminanza->glifo
   * @param {number}  [options.colorMode]      0 ink/bg | 1 preserva | 2 video su bianco | 3 video su bg
   * @param {number[]}[options.ink]            colore glifi [r,g,b] 0..1 (modalita 0)
   * @param {number[]}[options.background]     colore sfondo [r,g,b] 0..1 (modalita 0/3)
   * @param {number}  [options.whiteCutoff]    soglia bianco (luma lineare) di invisibilita
   * @param {number}  [options.brightness]
   * @param {number}  [options.contrast]
   * @param {number}  [options.gamma]
   * @param {boolean} [options.edges]          edge-detection Sobel on/off
   * @param {number}  [options.edgeThreshold]  soglia magnitudine gradiente
   * @param {boolean} [options.useMemory]      usa la memoria per-cella (morph) invece del live
   * @param {number}  [options.glyphScale]     scala del glifo dentro la cella (0.1..1.0)
   * @param {boolean} [options.glyphBlend]     cross-fade tra glifi adiacenti
   * @param {number}  [options.magnet]         magnetismo del cross-fade (0..1, alto = aggancio deciso)
   * @param {boolean} [options.sdfMorph]       morph di FORMA via SDF (il glifo si trasforma in target)
   * @param {number}  [options.sdfAA]          antialias della soglia SDF (0 netto .. alto morbido)
   * @param {number}  [options.sdfThreshold]   soglia SDF (0.5 neutra; <0.5 ingrassa, >0.5 assottiglia)
   */
  constructor({
    charset = DEFAULT_CHARSET,
    edgeChars = DEFAULT_EDGE_CHARS,
    cellSize = 16,
    invert = false,
    colorMode = 2,
    ink = [0.45, 1.0, 0.45],
    background = [0.0, 0.0, 0.0],
    whiteCutoff = 0.8,
    brightness = 0.0,
    contrast = 1.0,
    gamma = 1.0,
    edges = true,
    edgeThreshold = 0.3,
    variety = 1.0,
    useMemory = false,
    glyphScale = 1.0,
    glyphBlend = false,
    magnet = 0.6,
    sdfMorph = false,
    sdfAA = 0.04,
    sdfThreshold = 0.5,
    colorVar = 0.10,
    noise = 0.06,
    noiseScale = 1.0,
    noiseMode = 0,
  } = {}) {
    const glyph = buildGlyphAtlas(charset, 96);
    const edge = buildGlyphAtlas(edgeChars, 96);
    const sdf = buildSdfAtlas(charset, 96); // atlante SDF (morph di forma); stesso ordine glifi

    super('AsciiEffect', FRAGMENT, {
      uniforms: new Map([
        ['uGlyphAtlas', new Uniform(glyph.texture)],
        ['uGlyphCount', new Uniform(glyph.count)],
        ['uEdgeAtlas', new Uniform(edge.texture)],
        ['uEdgeCount', new Uniform(edge.count)],
        ['uCellSize', new Uniform(cellSize)],
        ['uInvert', new Uniform(invert)],
        ['uColorMode', new Uniform(colorMode)],
        ['uInk', new Uniform(new Vector3(ink[0], ink[1], ink[2]))],
        ['uBackground', new Uniform(new Vector3(background[0], background[1], background[2]))],
        ['uWhiteCutoff', new Uniform(whiteCutoff)],
        ['uBrightness', new Uniform(brightness)],
        ['uContrast', new Uniform(contrast)],
        ['uGamma', new Uniform(gamma)],
        ['uEdges', new Uniform(edges)],
        ['uEdgeThreshold', new Uniform(edgeThreshold)],
        ['uVariety', new Uniform(variety)],
        // Memoria per-cella.
        ['uMemory', new Uniform(null)],
        ['uUseMemory', new Uniform(useMemory)],
        ['uGridSize', new Uniform(new Vector2(1, 1))],
        // Resa glifo.
        ['uGlyphScale', new Uniform(glyphScale)],
        ['uGlyphBlend', new Uniform(glyphBlend)],
        ['uMagnet', new Uniform(magnet)],
        // Morph di forma (SDF).
        ['uGlyphSdf', new Uniform(sdf.texture)],
        ['uSdfMorph', new Uniform(sdfMorph)],
        ['uSdfAA', new Uniform(sdfAA)],
        ['uSdfThreshold', new Uniform(sdfThreshold)],
        // Texture / grana.
        ['uColorVar', new Uniform(colorVar)],
        ['uNoise', new Uniform(noise)],
        ['uNoiseScale', new Uniform(noiseScale)],
        ['uNoiseMode', new Uniform(noiseMode)],
      ]),
    });

    this._charset = charset;
    this._edgeChars = edgeChars;
    this._glyphTexture = glyph.texture;
    this._edgeTexture = edge.texture;
    this._sdfTexture = sdf.texture;
  }

  // --- Ricostruzione atlanti quando cambiano i set di caratteri ---
  get charset() { return this._charset; }
  set charset(str) {
    this._charset = str && str.length ? str : DEFAULT_CHARSET;
    if (this._glyphTexture) this._glyphTexture.dispose();
    const glyph = buildGlyphAtlas(this._charset, 96);
    this._glyphTexture = glyph.texture;
    this.uniforms.get('uGlyphAtlas').value = glyph.texture;
    this.uniforms.get('uGlyphCount').value = glyph.count;
    // Rigenera anche l'atlante SDF (morph di forma) sullo stesso charset.
    if (this._sdfTexture) this._sdfTexture.dispose();
    const sdf = buildSdfAtlas(this._charset, 96);
    this._sdfTexture = sdf.texture;
    this.uniforms.get('uGlyphSdf').value = sdf.texture;
  }

  get edgeChars() { return this._edgeChars; }
  set edgeChars(str) {
    this._edgeChars = str && str.length ? str : DEFAULT_EDGE_CHARS;
    if (this._edgeTexture) this._edgeTexture.dispose();
    const edge = buildGlyphAtlas(this._edgeChars, 96);
    this._edgeTexture = edge.texture;
    this.uniforms.get('uEdgeAtlas').value = edge.texture;
    this.uniforms.get('uEdgeCount').value = edge.count;
  }

  // --- Getter/setter delle uniform scalari/booleane ---
  get cellSize() { return this.uniforms.get('uCellSize').value; }
  set cellSize(v) { this.uniforms.get('uCellSize').value = v; }

  get invert() { return this.uniforms.get('uInvert').value; }
  set invert(v) { this.uniforms.get('uInvert').value = v; }

  get colorMode() { return this.uniforms.get('uColorMode').value; }
  set colorMode(v) { this.uniforms.get('uColorMode').value = v; }

  get whiteCutoff() { return this.uniforms.get('uWhiteCutoff').value; }
  set whiteCutoff(v) { this.uniforms.get('uWhiteCutoff').value = v; }

  get brightness() { return this.uniforms.get('uBrightness').value; }
  set brightness(v) { this.uniforms.get('uBrightness').value = v; }

  get contrast() { return this.uniforms.get('uContrast').value; }
  set contrast(v) { this.uniforms.get('uContrast').value = v; }

  get gamma() { return this.uniforms.get('uGamma').value; }
  set gamma(v) { this.uniforms.get('uGamma').value = v; }

  get edges() { return this.uniforms.get('uEdges').value; }
  set edges(v) { this.uniforms.get('uEdges').value = v; }

  get edgeThreshold() { return this.uniforms.get('uEdgeThreshold').value; }
  set edgeThreshold(v) { this.uniforms.get('uEdgeThreshold').value = v; }

  get variety() { return this.uniforms.get('uVariety').value; }
  set variety(v) { this.uniforms.get('uVariety').value = v; }

  get colorVar() { return this.uniforms.get('uColorVar').value; }
  set colorVar(v) { this.uniforms.get('uColorVar').value = v; }

  get noise() { return this.uniforms.get('uNoise').value; }
  set noise(v) { this.uniforms.get('uNoise').value = v; }

  // Dimensione della grana in pixel: 1 = puntinato fine (look attuale), alto = blocchi piu grossi.
  get noiseScale() { return this.uniforms.get('uNoiseScale').value; }
  set noiseScale(v) { this.uniforms.get('uNoiseScale').value = v; }

  // Modalita di fusione della grana (0 additivo, 1 multiply, 2 screen, 3 overlay, 4 soft light,
  // 5 linear burn, 6 color burn, 7 color dodge).
  get noiseMode() { return this.uniforms.get('uNoiseMode').value; }
  set noiseMode(v) { this.uniforms.get('uNoiseMode').value = v; }

  // --- Memoria per-cella ---
  // Texture di stato (RT corrente del ping-pong, gestito da MemoryGrid).
  get memoryTexture() { return this.uniforms.get('uMemory').value; }
  set memoryTexture(t) { this.uniforms.get('uMemory').value = t; }

  get useMemory() { return this.uniforms.get('uUseMemory').value; }
  set useMemory(v) { this.uniforms.get('uUseMemory').value = v; }

  // Dimensione griglia (numero celle). Accetta {x,y}/Vector2 o [w,h].
  get gridSize() { return this.uniforms.get('uGridSize').value; }
  set gridSize(v) {
    const g = this.uniforms.get('uGridSize').value;
    if (Array.isArray(v)) g.set(v[0], v[1]);
    else if (v && 'x' in v) g.set(v.x, v.y);
  }
  // No-alloc: setta direttamente le componenti (evita di allocare un Vector2 per frame lato chiamante).
  setGridSize(x, y) { this.uniforms.get('uGridSize').value.set(x, y); }

  // --- Resa glifo ---
  get glyphScale() { return this.uniforms.get('uGlyphScale').value; }
  set glyphScale(v) { this.uniforms.get('uGlyphScale').value = v; }

  get glyphBlend() { return this.uniforms.get('uGlyphBlend').value; }
  set glyphBlend(v) { this.uniforms.get('uGlyphBlend').value = v; }

  // Magnetismo del cross-fade (0..1): 0 = blend morbido prolungato, 1 = aggancio molto deciso.
  get magnet() { return this.uniforms.get('uMagnet').value; }
  set magnet(v) { this.uniforms.get('uMagnet').value = v; }

  // --- Morph di forma (SDF) ---
  // Quando attivo, il glifo si TRASFORMA progressivamente nella forma del target via SDF.
  get sdfMorph() { return this.uniforms.get('uSdfMorph').value; }
  set sdfMorph(v) { this.uniforms.get('uSdfMorph').value = v; }

  get sdfAA() { return this.uniforms.get('uSdfAA').value; }
  set sdfAA(v) { this.uniforms.get('uSdfAA').value = v; }

  get sdfThreshold() { return this.uniforms.get('uSdfThreshold').value; }
  set sdfThreshold(v) { this.uniforms.get('uSdfThreshold').value = v; }

  // Colori esposti come Vector3 (componenti 0..1) per il color picker di Tweakpane.
  get ink() { return this.uniforms.get('uInk').value; }
  get background() { return this.uniforms.get('uBackground').value; }

  dispose() {
    if (this._glyphTexture) this._glyphTexture.dispose();
    if (this._edgeTexture) this._edgeTexture.dispose();
    if (this._sdfTexture) this._sdfTexture.dispose();
    super.dispose();
  }
}
