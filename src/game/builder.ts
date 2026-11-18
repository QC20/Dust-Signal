import {
  BufferGeometry,
  Float32BufferAttribute,
  Matrix4,
  Vector3,
  Euler,
  Quaternion,
  BoxGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
  ConeGeometry,
} from 'three';
import { RNG } from '../engine/math';

export type Col = number | readonly [number, number, number];
export interface PartOpts {
  color: Col;
  mat: number;
  emit?: number;
  jitter?: number;
}
export interface Rot {
  x?: number;
  y?: number;
  z?: number;
}

export function rgb(c: Col): [number, number, number] {
  if (typeof c === 'number') return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
  return [c[0], c[1], c[2]];
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _s = new Vector3();
const _p = new Vector3();
const _up = new Vector3(0, 1, 0);

/** Accumulates many primitives into one non-indexed geometry with ASCII material attributes. */
export class GeometryBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private mat: number[] = [];
  private emi: number[] = [];
  private rng: RNG;

  constructor(seed = 1) {
    this.rng = new RNG(seed);
  }

  get vertexCount() {
    return this.pos.length / 3;
  }

  addGeometry(g: BufferGeometry, m: Matrix4, o: PartOpts, flat = false) {
    let geo = g.index ? g.toNonIndexed() : g;
    if (geo !== g) g.dispose();
    if (flat) {
      geo.deleteAttribute('normal');
      geo.computeVertexNormals();
    }
    geo.applyMatrix4(m);
    const p = geo.attributes.position;
    const n = geo.attributes.normal;
    const base = rgb(o.color);
    const j = o.jitter ?? 0.08;
    for (let i = 0; i < p.count; i++) {
      if (i % 3 === 0) {
        const f = 1 + (this.rng.next() - 0.5) * 2 * j;
        _s.set(base[0] * f, base[1] * f, base[2] * f);
      }
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(_s.x, _s.y, _s.z);
      this.mat.push(o.mat);
      this.emi.push(o.emit ?? 0);
    }
    geo.dispose();
  }

  private matrix(x: number, y: number, z: number, rot?: Rot, sx = 1, sy = 1, sz = 1) {
    _e.set(rot?.x ?? 0, rot?.y ?? 0, rot?.z ?? 0, 'YXZ');
    _q.setFromEuler(_e);
    return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)).clone();
  }

  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, o: PartOpts, rot?: Rot) {
    this.addGeometry(new BoxGeometry(sx, sy, sz), this.matrix(x, y, z, rot), o);
  }

  cyl(x: number, y: number, z: number, rTop: number, rBot: number, h: number, seg: number, o: PartOpts, rot?: Rot, flat = false) {
    this.addGeometry(new CylinderGeometry(rTop, rBot, h, seg, 1), this.matrix(x, y, z, rot), o, flat);
  }

  cone(x: number, y: number, z: number, r: number, h: number, seg: number, o: PartOpts, rot?: Rot) {
    this.addGeometry(new ConeGeometry(r, h, seg, 1), this.matrix(x, y, z, rot), o, true);
  }

  rock(x: number, y: number, z: number, r: number, o: PartOpts, sx = 1, sy = 1, sz = 1, rot?: Rot) {
    const g = this.rng.chance(0.5) ? new DodecahedronGeometry(r, 0) : new IcosahedronGeometry(r, 0);
    this.addGeometry(g, this.matrix(x, y, z, rot, sx, sy, sz), o, true);
  }

  /** A square beam from a to b. */
  beam(a: Vector3, b: Vector3, t: number, o: PartOpts) {
    const len = a.distanceTo(b);
    if (len < 1e-4) return;
    const dir = b.clone().sub(a).normalize();
    _q.setFromUnitVectors(_up, dir);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const m = new Matrix4().compose(mid, _q, new Vector3(1, 1, 1));
    this.addGeometry(new BoxGeometry(t, len, t), m, o);
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aColor', new Float32BufferAttribute(this.col, 3));
    g.setAttribute('aMat', new Float32BufferAttribute(this.mat, 1));
    g.setAttribute('aEmit', new Float32BufferAttribute(this.emi, 1));
    g.computeBoundingSphere();
    return g;
  }
}
