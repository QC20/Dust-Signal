import { OrthographicCamera, Vector3 } from 'three';
import { clamp } from './math';

const UP = new Vector3(0, 1, 0);

/**
 * Orthographic isometric camera. Its position is snapped to whole character
 * cells so static scenery keeps exactly the same glyphs while the camera
 * scrolls, which removes the "crawling text" look of naive ASCII filters.
 */
export class IsoCamera {
  readonly cam = new OrthographicCamera(-1, 1, 1, -1, 1, 400);
  readonly dist = 150;
  halfH = 5.2;
  targetHalfH = 5.2;
  readonly focus = new Vector3();
  readonly offsetDir = new Vector3();
  readonly right = new Vector3();
  readonly up = new Vector3();
  readonly fwd = new Vector3();
  readonly groundFwd = new Vector3();
  readonly groundRight = new Vector3();
  private shake = 0;
  private shakeT = 0;
  private snapped = new Vector3();
  private tmp = new Vector3();

  constructor(elevDeg = 37, azimDeg = 45) {
    this.setAngles(elevDeg, azimDeg);
  }

  setAngles(elevDeg: number, azimDeg: number) {
    const el = (elevDeg * Math.PI) / 180;
    const az = (azimDeg * Math.PI) / 180;
    this.offsetDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
    this.fwd.copy(this.offsetDir).negate();
    this.right.crossVectors(this.fwd, UP).normalize();
    this.up.crossVectors(this.right, this.fwd).normalize();
    this.groundFwd.set(this.fwd.x, 0, this.fwd.z).normalize();
    this.groundRight.set(this.right.x, 0, this.right.z).normalize();
  }

  addShake(amount: number) {
    this.shake = Math.min(3, this.shake + amount);
  }

  zoom(delta: number) {
    this.targetHalfH = clamp(this.targetHalfH * (1 + delta), 4.5, 14);
  }

  update(dt: number, follow: Vector3, aspect: number, cols: number, rows: number, followRate = 5) {
    const k = 1 - Math.exp(-followRate * dt);
    this.focus.lerp(follow, k);
    this.halfH += (this.targetHalfH - this.halfH) * (1 - Math.exp(-8 * dt));
    const halfW = this.halfH * aspect;
    this.cam.left = -halfW;
    this.cam.right = halfW;
    this.cam.top = this.halfH;
    this.cam.bottom = -this.halfH;
    this.cam.updateProjectionMatrix();

    const cw = (2 * halfW) / cols;
    const ch = (2 * this.halfH) / rows;
    const a = this.focus.dot(this.right);
    const b = this.focus.dot(this.up);
    let sa = Math.round(a / cw) * cw - a;
    let sb = Math.round(b / ch) * ch - b;
    this.shakeT += dt;
    if (this.shake > 0.05) {
      sa += Math.round((Math.random() - 0.5) * this.shake * 2) * cw;
      sb += Math.round((Math.random() - 0.5) * this.shake * 2) * ch;
      this.shake *= Math.exp(-9 * dt);
    } else this.shake = 0;
    this.snapped.copy(this.focus).addScaledVector(this.right, sa).addScaledVector(this.up, sb);
    this.cam.position.copy(this.snapped).addScaledVector(this.offsetDir, this.dist);
    this.cam.up.copy(UP);
    this.cam.lookAt(this.snapped);
    this.cam.updateMatrixWorld(true);
  }

  /** World -> cell coordinates (column, row from top). */
  project(v: Vector3, cols: number, rows: number, out: { x: number; y: number; z: number }) {
    this.tmp.copy(v).project(this.cam);
    out.x = Math.floor((this.tmp.x * 0.5 + 0.5) * cols);
    out.y = Math.floor((1 - (this.tmp.y * 0.5 + 0.5)) * rows);
    out.z = this.tmp.z;
    return out;
  }

  /** Normalised device coords -> point on the horizontal plane y = planeY. */
  ndcToGround(nx: number, ny: number, planeY: number, out: Vector3) {
    out.copy(this.cam.position)
      .addScaledVector(this.right, nx * this.cam.right)
      .addScaledVector(this.up, ny * this.cam.top);
    const t = (planeY - out.y) / this.fwd.y;
    return out.addScaledVector(this.fwd, t);
  }
}
