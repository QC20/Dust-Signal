import { CanvasTexture, NearestFilter, NoColorSpace } from 'three';

// Every glyph the renderer can draw. Index 0 is a space. Lookups never fail:
// unknown characters fall back to index 0 (no "undefined" in this wasteland).
export const CHARSET: string = (() => {
  let s = '';
  for (let c = 32; c < 127; c++) s += String.fromCharCode(c);
  return s + '·•°≈▪↑';
})();

export const ATLAS_COLS = 16;
export const ATLAS_ROWS = Math.ceil(CHARSET.length / ATLAS_COLS);

const INDEX = new Map<string, number>();
for (let i = 0; i < CHARSET.length; i++) INDEX.set(CHARSET[i], i);

export function gi(ch: string): number {
  return INDEX.get(ch) ?? 0;
}

// Candidate glyphs for shape-vector matching (Alex Harri style). Kept to
// characters that read as "contour" pieces rather than noisy letters.
export const SHAPE_SET = " .,:;'`\"^-_~=+*!|/\\()<>[]{}#%&@";

export interface Atlas {
  texture: CanvasTexture;
  canvas: HTMLCanvasElement;
  cellW: number;
  cellH: number;
  /** 6 coverage values per glyph: [col0 row0..2, col1 row0..2] (row 0 = top) */
  shapes: Float32Array;
}

export const FONT_FAMILY = '"JetBrains Mono", "IBM Plex Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';

export function buildAtlas(cellW: number, cellH: number): Atlas {
  const canvas = document.createElement('canvas');
  canvas.width = cellW * ATLAS_COLS;
  canvas.height = cellH * ATLAS_ROWS;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const fontPx = Math.max(6, Math.floor(Math.min(cellH * 0.9, cellW / 0.6)));
  const weight = cellW <= 7 ? 600 : 500;
  ctx.font = `${weight} ${fontPx}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  for (let i = 0; i < CHARSET.length; i++) {
    const cx = (i % ATLAS_COLS) * cellW;
    const cy = Math.floor(i / ATLAS_COLS) * cellH;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx, cy, cellW, cellH);
    ctx.clip();
    ctx.fillText(CHARSET[i], cx + cellW / 2, cy + cellH / 2 + fontPx * 0.04);
    ctx.restore();
  }

  // Shape vectors: average coverage in a 2 x 3 grid of sub-regions.
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const shapes = new Float32Array(CHARSET.length * 6);
  let maxV = 1e-6;
  for (let i = 0; i < CHARSET.length; i++) {
    const ox = (i % ATLAS_COLS) * cellW;
    const oy = Math.floor(i / ATLAS_COLS) * cellH;
    for (let col = 0; col < 2; col++) {
      for (let row = 0; row < 3; row++) {
        const x0 = Math.floor((col * cellW) / 2);
        const x1 = Math.floor(((col + 1) * cellW) / 2);
        const y0 = Math.floor((row * cellH) / 3);
        const y1 = Math.floor(((row + 1) * cellH) / 3);
        let sum = 0;
        let n = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            sum += img[((oy + y) * canvas.width + ox + x) * 4] / 255;
            n++;
          }
        }
        const v = n ? sum / n : 0;
        shapes[i * 6 + col * 3 + row] = v;
        if (v > maxV) maxV = v;
      }
    }
  }
  for (let i = 0; i < shapes.length; i++) shapes[i] /= maxV;

  const texture = new CanvasTexture(canvas);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = NoColorSpace;
  texture.needsUpdate = true;
  return { texture, canvas, cellW, cellH, shapes };
}
