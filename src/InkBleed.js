// InkBleed.js
// Effetto "ink bleed" come PASS SEPARATO, a valle dell'AsciiEffect, in stile BLOOM.
// Va aggiunto come SECONDO EffectPass dopo quello dell'ASCII: il suo inputBuffer e quindi
// l'output ASCII gia renderizzato (glifi nitidi su sfondo bianco).
//
// Idea: l'"inchiostro" (le aree NON bianche) viene diffuso morbidamente su piu anelli
// (blur multi-tap) e usato per tingere i dintorni col COLORE dell'inchiostro -> alone colorato
// che attraversa i confini delle celle (non e piu un alone per-singolo-glifo cotto nell'atlante).
// Su sfondo bianco l'alone resta colorato e morbido; il glifo originale resta dov'e.

import { Effect } from 'postprocessing';
import { Uniform } from 'three';

const FRAGMENT = /* glsl */ `
uniform float uBleed;    // intensita del bleed (0 = off)
uniform float uRadius;   // raggio del bleed/blur in pixel
uniform float uBlur;     // sfocatura: 0 = nessuna, 1 = piena (media dei campioni nel disco)

float lumv(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Campioni distribuiti su TUTTO il disco con la spirale di Vogel (golden angle): copertura
// uniforme e senza buchi -> niente "copie fantasma" del glifo ad anello quando il raggio cresce.
const int SAMPLES = 64;
const float GOLDEN = 2.39996323;   // angolo aureo in radianti
const float INV_SAMPLES = 1.0 / float(SAMPLES);

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 px = vec2(uRadius) / resolution;   // raggio in coordinate uv (corretto per aspect)
  float aspect = resolution.x / resolution.y;

  vec3  inkSum = vec3(0.0);   // colore inchiostro pesato (solo aree non bianche)
  float presSum = 0.0;        // "presenza" di inchiostro pesata
  vec3  colSum = vec3(0.0);   // colore di TUTTI i campioni pesato (per la sfocatura gaussiana)
  float wTotal = 0.0;         // somma pesi totale

  for (int i = 0; i < SAMPLES; i++) {
    float fi = float(i);
    // raggio normalizzato 0..1: sqrt -> densita uniforme sul disco (non concentrata al centro).
    float rn = sqrt((fi + 0.5) * INV_SAMPLES);
    float ang = fi * GOLDEN;
    vec2 dir = vec2(cos(ang), sin(ang) * aspect);   // mantiene il disco circolare a schermo
    vec2 o = dir * rn * px;

    vec3 c = texture2D(inputBuffer, uv + o).rgb;
    float p = clamp(1.0 - lumv(c), 0.0, 1.0);       // alta dove e scuro/colorato (inchiostro)
    float w = exp(-rn * rn * 2.2);                  // peso gaussiano: centro pesa piu del bordo

    inkSum  += c * p * w;
    presSum += p * w;
    colSum  += c * w;
    wTotal  += w;
  }

  // Colore medio dell'inchiostro diffuso e copertura 0..1 (frazione di inchiostro nel disco).
  vec3 inkColor = inkSum / max(presSum, 1e-4);
  float coverage = presSum / max(wTotal, 1e-4);
  float bleed = clamp(coverage * uBleed * 2.5, 0.0, 1.0);

  // Colore SFOCATO (media gaussiana di tutti i campioni nel disco).
  vec3 blurColor = colSum / max(wTotal, 1e-4);

  // 1) Tinge verso l'inchiostro diffuso (alone). 2) Sfuma verso la media (blur). Entrambi
  // usano lo stesso uRadius (a raggio 0 non c'e ne alone ne blur).
  vec3 col = mix(inputColor.rgb, inkColor, bleed);
  col = mix(col, blurColor, clamp(uBlur, 0.0, 1.0));
  outputColor = vec4(col, inputColor.a);
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
      ]),
    });
  }

  get bleed() { return this.uniforms.get('uBleed').value; }
  set bleed(v) { this.uniforms.get('uBleed').value = v; }

  get radius() { return this.uniforms.get('uRadius').value; }
  set radius(v) { this.uniforms.get('uRadius').value = v; }

  get blur() { return this.uniforms.get('uBlur').value; }
  set blur(v) { this.uniforms.get('uBlur').value = v; }
}
