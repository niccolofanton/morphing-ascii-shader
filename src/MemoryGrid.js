// MemoryGrid.js
// MEMORIA PER-CELLA (morph temporale) per l'effetto ASCII.
//
// Problema: un fragment shader dell'EffectPass e STATELESS tra i frame, quindi non puo
// ricordare lo stato precedente di una cella. Soluzione: un ping-pong di due RenderTarget
// a RISOLUZIONE-GRIGLIA (un texel per cella) che mantengono il COLORE memorizzato di ogni
// cella in spazio LINEARE (coerente con l'inputBuffer dell'effetto).
//
// Ad ogni frame, un pass di UPDATE fullscreen:
//   - campiona il video al CENTRO di ogni cella -> colore TARGET (portato in spazio lineare),
//   - legge il colore PRECEDENTE della cella (RT precedente),
//   - morpha con una RAMPA LINEARE a velocita fissa verso il target,
//   - scrive il nuovo colore nel RT corrente.
// L'AsciiEffect legge poi questo RT al centro cella (stessa uv) per scegliere glifo/colore/cutoff.
//
// CANALE ALPHA = ATTIVITA DI MORPH. Oltre al colore (RGB) il buffer memorizza nel canale ALPHA
// un'"attivita" per-cella: ALTA mentre la cella sta cambiando luminanza verso un nuovo target,
// ~0 quando si e assestata. L'effetto la usa per il cross-fade "magnetico" tra glifi (blend
// solo durante la transizione; aggancio a un glifo netto quando la cella e ferma).

import {
  WebGLRenderTarget,
  HalfFloatType,
  FloatType,
  UnsignedByteType,
  RGBAFormat,
  NearestFilter,
  OrthographicCamera,
  Scene,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
} from 'three';

// Vertex shader minimale: passa la uv del fullscreen quad.
const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Fragment shader del pass di update.
// Per ogni texel (= cella i,j) calcola target e morpha verso di esso partendo dal precedente.
const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform sampler2D uPrev;        // RT precedente (colore memorizzato per cella, lineare)
uniform sampler2D uVideo;       // VideoTexture (sRGB)
uniform vec2  uGridSize;        // numero celle (colonne, righe)
uniform vec2  uCellPx;          // dimensione cella in pixel (drawing buffer) -> vec2 per sicurezza
uniform vec2  uBufferPx;        // dimensione drawing buffer in pixel
uniform float uRate;            // velocita morph (unita colore/secondo)
uniform float uDt;              // delta tempo reale clampato [0, 0.1]
uniform bool  uReset;           // se true: scrive direttamente il bianco
uniform vec3  uInitColor;       // colore iniziale (bianco = 1,1,1)
uniform vec2  uActEps;          // (EPS0, EPS1) per lo smoothstep dell'attivita (luminanza residua)

// sRGB -> lineare (la VideoTexture e in spazio sRGB; l'inputBuffer dell'effetto e lineare).
vec3 srgbToLinear(vec3 c) {
  vec3 lo = c / 12.92;
  vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(lo, hi, step(0.04045, c));
}

// Luminanza percepita (stessa convenzione dell'effetto: e la luminanza che guida il glifo).
float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

// Cap del passo per-frame: anche a velocita alta il morph non e mai PERFETTAMENTE istantaneo
// (resta < 1 -> nessuno scatto secco/flicker). Alto abbastanza da permettere cambi RAPIDI a
// uRate alto; ai valori bassi/default non morde (a 60fps con uRate<=~17 lo step e gia < 0.25),
// quindi quei regimi restano identici a prima.
const float MAX_STEP = 0.85;

void main() {
  // Reset: scrive direttamente lo stato iniziale (bianco). Alpha=0 -> cella ASSESTATA (no blend).
  if (uReset) {
    gl_FragColor = vec4(uInitColor, 0.0);
    return;
  }

  // Indice cella (i,j) da questo texel. vUv copre [0,1] sull'intera griglia.
  vec2 cellIndex = floor(vUv * uGridSize);

  // Centro cella nel video (stessa convenzione dell'effetto: (idx + 0.5) * cellPx / bufferPx).
  vec2 uvVideo = ((cellIndex + 0.5) * uCellPx) / uBufferPx;
  vec3 target = srgbToLinear(texture2D(uVideo, uvVideo).rgb);

  // Colore precedente memorizzato (centro del texel della cella corrente).
  vec2 prevUv = (cellIndex + 0.5) / uGridSize;
  vec3 prev = texture2D(uPrev, prevUv).rgb;

  // INERZIA: avvicinamento ESPONENZIALE al target -> sempre graduale, decelera vicino al target,
  // mai istantaneo, e filtra (low-pass) il rumore/gli scatti del video. uRate = responsivita
  // (basso = trail lungo). Il cap MAX_STEP garantisce "mai troppo veloce" anche ad uRate alto.
  float k = min(1.0 - exp(-uDt * uRate), MAX_STEP);
  vec3 next = mix(prev, target, k);

  // ATTIVITA DI MORPH (canale ALPHA): distanza RESIDUA in LUMINANZA verso il target DOPO lo step.
  // Con lo smoothing esponenziale il residuo tende rapidamente a ~0 a regime (aggancio pulito al
  // glifo). smoothstep(EPS0, EPS1, residuo): ~0 quando assestata, ~1 in pieno morph.
  float residual = abs(luma(target) - luma(next));
  float activity = smoothstep(uActEps.x, uActEps.y, residual);

  gl_FragColor = vec4(next, activity);
}
`;

export class MemoryGrid {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Texture} videoTexture  VideoTexture sorgente (sRGB)
   * @param {Object} [opts]
   * @param {number} [opts.rate]  velocita morph iniziale
   */
  constructor(renderer, videoTexture, { rate = 1.2 } = {}) {
    this.renderer = renderer;
    this.videoTexture = videoTexture;
    this.rate = rate;

    // Tipo dei RT: preferiamo half-float; fallback a float, poi a byte.
    this.rtType = this._pickRenderTargetType();

    // Scena/camera dedicate per il fullscreen pass (indipendenti dalla scena principale).
    this.scene = new Scene();
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uPrev: { value: null },
        uVideo: { value: videoTexture },
        uGridSize: { value: new Vector2(1, 1) },
        uCellPx: { value: new Vector2(16, 16) },
        uBufferPx: { value: new Vector2(1, 1) },
        uRate: { value: rate },
        uDt: { value: 0 },
        uReset: { value: false },
        uInitColor: { value: [1, 1, 1] },
        // Soglie (EPS0, EPS1) dello smoothstep dell'attivita sulla luminanza residua.
        // Piccole e tarabili: sotto EPS0 = assestata (alpha 0), sopra EPS1 = pieno morph (alpha 1).
        uActEps: { value: new Vector2(0.01, 0.12) },
      },
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    this.scene.add(this.quad);

    // Coppia di RT (ping-pong). Allocati al primo setSize().
    this.rtA = null;
    this.rtB = null;
    this.gridW = 0;
    this.gridH = 0;
    this.cellSize = 16;

    // Flag: al prossimo update riparti dal bianco (usato da reset/realloc).
    this._needsInit = true;
  }

  // Sceglie il miglior tipo di RT supportato (half-float > float > byte).
  _pickRenderTargetType() {
    const gl = this.renderer.getContext();
    const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    // Half-float color buffer: nativo in WebGL2, via estensione in WebGL1.
    if (isWebGL2 || this.renderer.extensions.get('EXT_color_buffer_half_float')) {
      return HalfFloatType;
    }
    if (this.renderer.extensions.get('EXT_color_buffer_float')) {
      return FloatType;
    }
    // Fallback finale: 8 bit. La rampa lenta potrebbe "incastrarsi" per arrotondamento;
    // lo shader gestisce comunque la convergenza (lo step minimo emerge da min(1, step/dist)).
    return UnsignedByteType;
  }

  // Crea un RenderTarget a risoluzione-griglia.
  _makeRT(w, h) {
    const rt = new WebGLRenderTarget(w, h, {
      type: this.rtType,
      format: RGBAFormat,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    return rt;
  }

  // (Ri)alloca i RT alla griglia derivata da drawingBuffer e cellSize. Re-inizializza a bianco.
  // bufferW/bufferH = dimensioni del DRAWING BUFFER (device px). cellSize = uCellSize (device px).
  setSize(bufferW, bufferH, cellSize) {
    const cs = Math.max(1, Math.round(cellSize));
    const gw = Math.max(1, Math.ceil(bufferW / cs));
    const gh = Math.max(1, Math.ceil(bufferH / cs));

    // Niente da fare se nulla e cambiato.
    if (gw === this.gridW && gh === this.gridH && cs === this.cellSize && this.rtA && this.rtB) {
      // Aggiorna comunque le uniform dipendenti dal buffer (es. resize che non cambia la grid).
      this.material.uniforms.uBufferPx.value.set(bufferW, bufferH);
      return;
    }

    // Dispose dei vecchi RT (no leak).
    if (this.rtA) this.rtA.dispose();
    if (this.rtB) this.rtB.dispose();

    this.gridW = gw;
    this.gridH = gh;
    this.cellSize = cs;

    this.rtA = this._makeRT(gw, gh);
    this.rtB = this._makeRT(gw, gh);

    // Uniform geometriche.
    this.material.uniforms.uGridSize.value.set(gw, gh);
    this.material.uniforms.uCellPx.value.set(cs, cs);
    this.material.uniforms.uBufferPx.value.set(bufferW, bufferH);

    // Nuova allocazione -> stato iniziale bianco.
    this._needsInit = true;
  }

  // Re-inizializza esplicitamente la memoria a bianco (reset utente).
  reset() {
    this._needsInit = true;
  }

  // Esegue il pass di update per un frame e ritorna la texture col risultato (RT corrente).
  // dt = delta tempo reale del frame (in secondi); viene clampato in [0, 0.1].
  // Va chiamato PRIMA di composer.render(). Ripristina il render target a null al termine.
  update(dt) {
    if (!this.rtA || !this.rtB) return null;

    const renderer = this.renderer;
    const prevRT = renderer.getRenderTarget();

    const u = this.material.uniforms;
    u.uRate.value = this.rate;
    u.uVideo.value = this.videoTexture;

    if (this._needsInit) {
      // Passata di reset: scrive il bianco in ENTRAMBI i RT cosi qualunque sia il prossimo
      // "corrente" parte pulito. Non serve dt ne uPrev.
      u.uReset.value = true;
      renderer.setRenderTarget(this.rtA);
      renderer.render(this.scene, this.camera);
      renderer.setRenderTarget(this.rtB);
      renderer.render(this.scene, this.camera);
      u.uReset.value = false;
      this._needsInit = false;
      // Dopo l'init il "corrente" e rtA (rtB e la copia precedente).
      this.current = this.rtA;
      this.previous = this.rtB;
      renderer.setRenderTarget(prevRT);
      return this.current.texture;
    }

    // Ping-pong: leggi da previous, scrivi in current, poi swap.
    // Garantiamo che current/previous siano inizializzati.
    if (!this.current) { this.current = this.rtA; this.previous = this.rtB; }

    const clampedDt = Math.min(0.1, Math.max(0, dt));
    u.uDt.value = clampedDt;

    // Scriviamo nel target NON-correntemente-letto. Leggiamo dal corrente attuale.
    const src = this.current;       // contiene lo stato piu recente
    const dst = this.previous;      // target di scrittura (verra il nuovo "current")
    u.uPrev.value = src.texture;
    renderer.setRenderTarget(dst);
    renderer.render(this.scene, this.camera);

    // Swap: dst diventa il corrente.
    this.current = dst;
    this.previous = src;

    renderer.setRenderTarget(prevRT);
    return this.current.texture;
  }

  // Dimensioni griglia correnti (per l'uniform uGridSize dell'effetto).
  get gridSize() { return new Vector2(this.gridW, this.gridH); }

  dispose() {
    if (this.rtA) this.rtA.dispose();
    if (this.rtB) this.rtB.dispose();
    this.quad.geometry.dispose();
    this.material.dispose();
  }
}
