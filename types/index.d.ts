// Type definitions for evoling-aschii-shader
// Toolkit di effetti ASCII/halftone per three.js + pmndrs/postprocessing.

import { Effect } from 'postprocessing';
import { Texture, Vector2, Vector3, WebGLRenderer } from 'three';

/** Set di glifi di densità di default (chiaro → scuro): `' ·•+✦★○◯●'`. */
export const DEFAULT_CHARSET: string;
/** Glifi direzionali di default per i contorni (ordine: `-`, `|`, `/`, `\`). */
export const DEFAULT_EDGE_CHARS: string;

/** Modalità colore dell'AsciiEffect. */
export type AsciiColorMode = 0 | 1 | 2 | 3;

/** Componente RGB (0..1) accettata dai colori (ink/background). */
export type RGBTriplet = [number, number, number];

export interface AsciiEffectOptions {
  /** Glifi di densità, ordinati chiaro → scuro. Default `DEFAULT_CHARSET`. */
  charset?: string;
  /** Glifi dei contorni (ordine: `-`, `|`, `/`, `\`). Default `DEFAULT_EDGE_CHARS`. */
  edgeChars?: string;
  /** Dimensione della cella in pixel del drawing buffer. Default `16`. */
  cellSize?: number;
  /** Inverte la mappatura luminanza → glifo. Default `false`. */
  invert?: boolean;
  /** 0 ink/bg · 1 preserva sfondo · 2 video su bianco · 3 video su bg. Default `2`. */
  colorMode?: AsciiColorMode;
  /** Colore dei glifi (modalità 0). Default `[0.45, 1.0, 0.45]`. */
  ink?: RGBTriplet;
  /** Colore di sfondo (modalità 0/3). Default `[0, 0, 0]`. */
  background?: RGBTriplet;
  /** Soglia "bianco" (luma lineare): sopra → nessun glifo. Default `0.8`. */
  whiteCutoff?: number;
  /** Offset di luminanza. Default `0`. */
  brightness?: number;
  /** Contrasto. Default `1`. */
  contrast?: number;
  /** Correzione gamma. Default `1`. */
  gamma?: number;
  /** Edge-detection Sobel on/off. Default `true`. */
  edges?: boolean;
  /** Soglia della magnitudine del gradiente Sobel. Default `0.3`. */
  edgeThreshold?: number;
  /** Varietà del glifo per cella (jitter deterministico). Default `1`. */
  variety?: number;
  /** Usa la memoria per-cella (morph temporale) invece del campione live. Default `false`. */
  useMemory?: boolean;
  /** Scala del glifo dentro la cella. Default `1`. */
  glyphScale?: number;
  /** Cross-fade tra glifi adiacenti invece dello scatto. Default `false`. */
  glyphBlend?: boolean;
  /** Magnetismo del cross-fade (0 = morbido, alto = aggancio deciso). Default `0.6`. */
  magnet?: number;
  /** Morph di FORMA via SDF: il glifo si trasforma nella forma del target. Default `false`. */
  sdfMorph?: boolean;
  /** Antialias della soglia SDF (0 netto .. alto morbido). Default `0.04`. */
  sdfAA?: number;
  /** Soglia SDF (0.5 neutra; <0.5 ingrassa, >0.5 assottiglia i tratti). Default `0.5`. */
  sdfThreshold?: number;
  /** Mottlatura per-carattere. Default `0.10`. */
  colorVar?: number;
  /** Grana (film grain): opacità del layer. Default `0.06`. */
  noise?: number;
  /** Dimensione della grana in pixel (1 = puntinato fine). Default `1`. */
  noiseScale?: number;
  /** Modalità di fusione della grana (0 additivo .. 7 color dodge). Default `0`. */
  noiseMode?: number;
}

/**
 * Effetto ASCII/halftone (sottoclasse di `Effect` di postprocessing): mappa la luminanza del
 * video su un atlante di glifi, con edge-detection Sobel, memoria per-cella opzionale e
 * morph di forma via SDF. Si aggiunge a un `EffectPass`.
 */
export class AsciiEffect extends Effect {
  constructor(options?: AsciiEffectOptions);

  charset: string;
  edgeChars: string;
  cellSize: number;
  invert: boolean;
  colorMode: AsciiColorMode;
  whiteCutoff: number;
  brightness: number;
  contrast: number;
  gamma: number;
  edges: boolean;
  edgeThreshold: number;
  variety: number;
  colorVar: number;
  noise: number;
  noiseScale: number;
  noiseMode: number;
  useMemory: boolean;
  glyphScale: number;
  glyphBlend: boolean;
  magnet: number;
  sdfMorph: boolean;
  sdfAA: number;
  sdfThreshold: number;

  /** Texture di stato della memoria per-cella (output corrente di `MemoryGrid.update`). */
  memoryTexture: Texture | null;
  /** Dimensione della griglia (numero celle). Accetta `Vector2` o `[w, h]`. */
  gridSize: Vector2 | [number, number];
  /** Colore dei glifi (modalità 0), come `Vector3` 0..1 (sola lettura del riferimento). */
  readonly ink: Vector3;
  /** Colore di sfondo (modalità 0/3), come `Vector3` 0..1 (sola lettura del riferimento). */
  readonly background: Vector3;

  dispose(): void;
}

export interface InkBleedEffectOptions {
  /** Intensità del bleed. Default `0.5`. */
  bleed?: number;
  /** Raggio del bleed/blur in pixel. Default `24`. */
  radius?: number;
  /** Sfocatura (0 = off). Default `0`. */
  blur?: number;
}

/**
 * Pass di "ink bleed" (bloom-like) da applicare a valle dell'AsciiEffect: alone/sbavatura
 * dell'inchiostro con campionamento a spirale di Vogel. Sottoclasse di `Effect`.
 */
export class InkBleedEffect extends Effect {
  constructor(options?: InkBleedEffectOptions);
  bleed: number;
  radius: number;
  blur: number;
}

export interface MemoryGridOptions {
  /** Velocità del morph (basso = trail più persistente). Default `1.2`. */
  rate?: number;
}

/**
 * Memoria per-cella (morph temporale) per l'AsciiEffect. Mantiene tra i frame il colore
 * "morphato" di ogni cella in un ping-pong di RenderTarget a risoluzione-griglia. NON è un
 * `Effect`: va aggiornata manualmente nel render loop, prima di `composer.render()`.
 *
 * ```js
 * const memory = new MemoryGrid(renderer, videoTexture, { rate: 2.25 });
 * // nel loop:
 * memory.setSize(bufferW, bufferH, ascii.cellSize);
 * ascii.gridSize = memory.gridSize;
 * ascii.memoryTexture = memory.update(dt);
 * composer.render(dt);
 * ```
 */
export class MemoryGrid {
  constructor(renderer: WebGLRenderer, videoTexture: Texture, options?: MemoryGridOptions);
  /** Velocità del morph (modificabile a runtime). */
  rate: number;
  /** (Ri)alloca la griglia a partire dalle dimensioni del drawing buffer e dalla cellSize. */
  setSize(bufferW: number, bufferH: number, cellSize: number): void;
  /** Re-inizializza la memoria allo stato iniziale (bianco). */
  reset(): void;
  /** Esegue il pass di update di un frame e ritorna la texture risultante (o null). */
  update(dt: number): Texture | null;
  /** Dimensione corrente della griglia (numero celle). */
  readonly gridSize: Vector2;
  dispose(): void;
}
