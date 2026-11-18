import { DataTexture, RGBAFormat, UnsignedByteType, NearestFilter } from 'three';
import { gi } from './glyphs';

export type RGB = readonly [number, number, number];

/**
 * A character grid written by the CPU every frame (name tags, prompts,
 * particles, damage numbers). It is composited inside the ASCII pass so
 * overlay glyphs glow and sit on exactly the same grid as the world.
 */
export class Overlay {
  readonly data: Uint8Array;
  readonly texture: DataTexture;
  constructor(readonly cols: number, readonly rows: number) {
    this.data = new Uint8Array(cols * rows * 4);
    this.texture = new DataTexture(this.data, cols, rows, RGBAFormat, UnsignedByteType);
    this.texture.minFilter = NearestFilter;
    this.texture.magFilter = NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
  }
  clear() {
    this.data.fill(0);
  }
  inside(x: number, yTop: number) {
    return x >= 0 && yTop >= 0 && x < this.cols && yTop < this.rows;
  }
  put(x: number, yTop: number, ch: string | number, c: RGB, k = 1) {
    x = Math.round(x);
    yTop = Math.round(yTop);
    if (!this.inside(x, yTop)) return;
    const g = typeof ch === 'number' ? ch : gi(ch);
    const i = ((this.rows - 1 - yTop) * this.cols + x) * 4;
    this.data[i] = Math.max(0, Math.min(255, c[0] * k * 255));
    this.data[i + 1] = Math.max(0, Math.min(255, c[1] * k * 255));
    this.data[i + 2] = Math.max(0, Math.min(255, c[2] * k * 255));
    this.data[i + 3] = g + 1;
  }
  /** Mark a cell as "blank but occupied" so the world does not show through. */
  blank(x: number, yTop: number) {
    this.put(x, yTop, ' ', [0, 0, 0]);
  }
  text(x: number, yTop: number, s: string, c: RGB, k = 1, opaque = false) {
    const chars = [...s];
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] === ' ' && !opaque) continue;
      this.put(x + i, yTop, chars[i], c, k);
    }
  }
  textCenter(cx: number, yTop: number, s: string, c: RGB, k = 1, opaque = false) {
    this.text(Math.round(cx - [...s].length / 2), yTop, s, c, k, opaque);
  }
  upload() {
    this.texture.needsUpdate = true;
  }
  dispose() {
    this.texture.dispose();
  }
}
