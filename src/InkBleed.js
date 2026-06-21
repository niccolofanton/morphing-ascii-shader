// InkBleed.js
// Effetto "ink bleed" come PASS SEPARATO, a valle dell'AsciiEffect, in stile BLOOM.
// Va aggiunto come SECONDO EffectPass dopo quello dell'ASCII: il suo inputBuffer e quindi
// l'output ASCII gia renderizzato (glifi nitidi su sfondo bianco).
//
// Idea: l'"inchiostro" (le aree NON bianche) viene diffuso morbidamente su piu anelli
// (blur multi-tap) e usato per tingere i dintorni col COLORE dell'inchiostro -> alone colorato
// che attraversa i confini delle celle (non e piu un alone per-singolo-glifo cotto nell'atlante).
// Su sfondo bianco l'alone resta colorato e morbido; il glifo originale resta dov'e.
//
// PERFORMANCE (misurato su Apple M1 Pro, 7.72 MP, GPU timing reale):
//   Il pass e' nettamente ALU-bound: i 64 campioni del disco di Vogel ricalcolavano per OGNI
//   pixel le quantita' costanti del kernel (sqrt/exp/cos/sin), ~74% del costo del pass. Quelle
//   quantita' dipendono SOLO dall'indice del campione, non dal pixel -> ora sono PRE-CALCOLATE
//   una volta sola e lette da uno uniform array (uKernel). E' bit-identico perche' il kernel e'
//   "cotto" DALLA STESSA GPU con le STESSE intrinseche (cos/sin/sqrt/exp in highp) e riletto in
//   float32 esatto: i valori coincidono con quelli che il loop avrebbe calcolato a runtime su
//   quella GPU. (NB: NON si usano Math.cos di JS, che differirebbero di qualche ULP dalle
//   intrinseche GPU e potrebbero spostare un pixel a 8 bit.) Guadagno misurato ~35% del pass.

import { Effect } from 'postprocessing';
import {
  Uniform,
  WebGLRenderTarget,
  FloatType,
  RGBAFormat,
  NearestFilter,
  Scene,
  OrthographicCamera,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';

// Numero di campioni del disco (deve combaciare con SAMPLES nel fragment).
const SAMPLES = 64;
const GOLDEN = 2.39996323;          // angolo aureo in radianti
const INV_SAMPLES = 1.0 / SAMPLES;

const FRAGMENT = /* glsl */ `
uniform float uBleed;    // intensita del bleed (0 = off)
uniform float uRadius;   // raggio del bleed/blur in pixel
uniform float uBlur;     // sfocatura: 0 = nessuna, 1 = piena (media dei campioni nel disco)

// Kernel del disco di Vogel PRE-CALCOLATO (una volta, sulla GPU): per ogni campione i
// uKernel[i] = (cos(ang), sin(ang), rn, w) con ang/rn/w come nel commento sotto. Cosi' il loop
// per-pixel non ricalcola piu 64x le transcendenti (sqrt/exp/cos/sin): solo offset, fetch e somme.
uniform vec4 uKernel[${SAMPLES}];

float lumv(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Campioni distribuiti su TUTTO il disco con la spirale di Vogel (golden angle): copertura
// uniforme e senza buchi -> niente "copie fantasma" del glifo ad anello quando il raggio cresce.
// I valori per-campione [ rn = sqrt((i+0.5)/SAMPLES), ang = i*GOLDEN, w = exp(-rn*rn*2.2) ]
// sono ora in uKernel (vedi _bakeKernel): identici a quelli che questo shader calcolava prima.
const int SAMPLES = ${SAMPLES};

// Fetch del campione: su WebGL2 usa textureLod a LOD 0 (l'inputBuffer e' un RT a un solo livello,
// senza mipmap, LinearFilter -> identico al texture2D implicito, ma salta il calcolo delle
// derivate/selezione mip). Su WebGL1 resta texture2D (textureLod non compilerebbe).
#ifdef texture2DLodEXT
  #define INK_FETCH(uvc) textureLod(inputBuffer, (uvc), 0.0)
#else
  #define INK_FETCH(uvc) texture2D(inputBuffer, (uvc))
#endif

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // Early-out bit-identico: se bleed e blur sono entrambi a 0 il risultato e' esattamente
  // l'input (i due mix() collassano a no-op). Salta l'intero loop a 64 tap.
  if (uBleed <= 0.0 && uBlur <= 0.0) {
    outputColor = inputColor;
    return;
  }

  vec2 px = vec2(uRadius) / resolution;   // raggio in coordinate uv (corretto per aspect)
  float aspect = resolution.x / resolution.y;

  vec3  inkSum = vec3(0.0);   // colore inchiostro pesato (solo aree non bianche)
  float presSum = 0.0;        // "presenza" di inchiostro pesata
  vec3  colSum = vec3(0.0);   // colore di TUTTI i campioni pesato (per la sfocatura gaussiana)
  float wTotal = 0.0;         // somma pesi totale

  // Gate uniform-coherent: salta l'accumulo "solo-ink" o "solo-blur" quando il relativo
  // parametro e' 0 (il mix() corrispondente sarebbe comunque un no-op). wTotal resta sempre
  // accumulato (serve a coverage E a blurColor). Bit-identico: rami uniformi, stesso ordine
  // di somma, stessi operandi.
  bool doBleed = (uBleed > 0.0);
  bool doBlur  = (uBlur  > 0.0);

  for (int i = 0; i < SAMPLES; i++) {
    vec4 k = uKernel[i];                       // (cos(ang), sin(ang), rn, w) pre-calcolati
    vec2 dir = vec2(k.x, k.y * aspect);        // mantiene il disco circolare a schermo
    vec2 o = dir * k.z * px;                    // == dir * rn * px (stessa associazione)

    vec3 c = INK_FETCH(uv + o).rgb;
    float w = k.w;                             // == exp(-rn*rn*2.2)

    if (doBleed) {
      float p = clamp(1.0 - lumv(c), 0.0, 1.0); // alta dove e scuro/colorato (inchiostro)
      inkSum  += c * p * w;
      presSum += p * w;
    }
    if (doBlur) {
      colSum += c * w;
    }
    wTotal += w;
  }

  vec3 col = inputColor.rgb;

  if (doBleed) {
    // Colore medio dell'inchiostro diffuso e copertura 0..1 (frazione di inchiostro nel disco).
    vec3 inkColor = inkSum / max(presSum, 1e-4);
    float coverage = presSum / max(wTotal, 1e-4);
    float bleed = clamp(coverage * uBleed * 2.5, 0.0, 1.0);
    col = mix(col, inkColor, bleed);            // tinge verso l'inchiostro diffuso (alone)
  }

  if (doBlur) {
    // Colore SFOCATO (media gaussiana di tutti i campioni nel disco).
    vec3 blurColor = colSum / max(wTotal, 1e-4);
    col = mix(col, blurColor, clamp(uBlur, 0.0, 1.0)); // sfuma verso la media (blur)
  }

  outputColor = vec4(col, inputColor.a);
}
`;

// Shader del BAKE del kernel: scrive in una texture 64x1 (float) i valori per-campione, con le
// STESSE espressioni/costanti del loop originale, cosi' i valori coincidono bit-per-bit con quelli
// che il fragment avrebbe calcolato a runtime sulla stessa GPU.
const BAKE_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const BAKE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
const float GOLDEN = ${GOLDEN};
const float INV_SAMPLES = 1.0 / float(${SAMPLES});
void main() {
  float i = floor(vUv.x * float(${SAMPLES}));   // indice del campione 0..SAMPLES-1
  float rn = sqrt((i + 0.5) * INV_SAMPLES);
  float ang = i * GOLDEN;
  float w = exp(-rn * rn * 2.2);
  gl_FragColor = vec4(cos(ang), sin(ang), rn, w);
}
`;

export class InkBleedEffect extends Effect {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.bleed]   intensita (0 = off)
   * @param {number} [opts.radius]  raggio del bleed/blur in pixel
   * @param {number} [opts.blur]    sfocatura (0 = off, 1 = piena)
   */
  constructor({ bleed = 0.5, radius = 24, blur = 0.0 } = {}) {
    super('InkBleedEffect', FRAGMENT, {
      uniforms: new Map([
        ['uBleed', new Uniform(bleed)],
        ['uRadius', new Uniform(radius)],
        ['uBlur', new Uniform(blur)],
        // Kernel: riempito host nel costruttore (fallback, mai null) e RI-COTTO sulla GPU in
        // initialize() per la bit-identita' su qualunque hardware.
        ['uKernel', new Uniform(_hostKernel())],
      ]),
    });
    this._kernelBaked = false;
  }

  get bleed() { return this.uniforms.get('uBleed').value; }
  set bleed(v) { this.uniforms.get('uBleed').value = v; }

  get radius() { return this.uniforms.get('uRadius').value; }
  set radius(v) { this.uniforms.get('uRadius').value = v; }

  get blur() { return this.uniforms.get('uBlur').value; }
  set blur(v) { this.uniforms.get('uBlur').value = v; }

  // postprocessing chiama initialize(renderer, ...) prima del primo render: qui "cuociamo" il
  // kernel sulla GPU (stesse intrinseche del fragment -> valori bit-identici) e lo carichiamo
  // nello uniform array. Cosi' il loop per-pixel non ricalcola piu le transcendenti.
  initialize(renderer, alpha, frameBufferType) {
    if (super.initialize) super.initialize(renderer, alpha, frameBufferType);
    this._bakeKernel(renderer);
  }

  _bakeKernel(renderer) {
    if (!renderer) return;
    const gl = renderer.getContext();
    // Per fare il bake serve poter renderizzare su un color buffer FLOAT (per non perdere bit).
    const canFloat = !!(renderer.extensions && renderer.extensions.get('EXT_color_buffer_float'));
    if (!canFloat) {
      // Fallback (raro, es. WebGL1): resta il kernel host del costruttore. Praticamente identico;
      // la bit-identita' su QUALUNQUE GPU richiede il bake GPU, qui non disponibile.
      this._kernelBaked = true;
      return;
    }
    const rt = new WebGLRenderTarget(SAMPLES, 1, {
      type: FloatType, format: RGBAFormat,
      minFilter: NearestFilter, magFilter: NearestFilter,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    });
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const material = new ShaderMaterial({ vertexShader: BAKE_VERT, fragmentShader: BAKE_FRAG, depthTest: false, depthWrite: false });
    const quad = new Mesh(new PlaneGeometry(2, 2), material);
    scene.add(quad);

    const prevRT = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    const data = new Float32Array(SAMPLES * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, SAMPLES, 1, data);
    renderer.setRenderTarget(prevRT);

    rt.dispose();
    material.dispose();
    quad.geometry.dispose();

    this.uniforms.get('uKernel').value = data;
    this._kernelBaked = true;
  }
}

// Kernel calcolato in JS: solo FALLBACK (e valore iniziale non-null prima del bake GPU).
// In condizioni normali viene SOVRASCRITTO dal bake GPU in initialize() (bit-identico).
function _hostKernel() {
  const data = new Float32Array(SAMPLES * 4);
  for (let i = 0; i < SAMPLES; i++) {
    const rn = Math.sqrt((i + 0.5) * INV_SAMPLES);
    const ang = i * GOLDEN;
    data[i * 4 + 0] = Math.cos(ang);
    data[i * 4 + 1] = Math.sin(ang);
    data[i * 4 + 2] = rn;
    data[i * 4 + 3] = Math.exp(-rn * rn * 2.2);
  }
  return data;
}
