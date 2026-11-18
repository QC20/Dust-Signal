import { Vector3 } from 'three';

export interface Collider {
  x: number;
  z: number;
  r: number; // circle radius, or bounding radius for boxes
  box: boolean;
  hx: number;
  hz: number;
  c: number;
  s: number;
  top: number;
}

const CS = 6;
const key = (ix: number, iz: number) => (ix + 512) * 2048 + (iz + 512);

/** Static 2D colliders (circles and oriented boxes) in a spatial hash. */
export class CollisionWorld {
  readonly all: Collider[] = [];
  private cells = new Map<number, Collider[]>();
  private scratch: Collider[] = [];
  private stamp = new Map<Collider, number>();
  private qid = 0;

  private insert(c: Collider) {
    this.all.push(c);
    const x0 = Math.floor((c.x - c.r) / CS);
    const x1 = Math.floor((c.x + c.r) / CS);
    const z0 = Math.floor((c.z - c.r) / CS);
    const z1 = Math.floor((c.z + c.r) / CS);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = key(ix, iz);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(c);
      }
    }
  }

  addCircle(x: number, z: number, r: number, top = 3) {
    this.insert({ x, z, r, box: false, hx: 0, hz: 0, c: 1, s: 0, top });
  }

  /** Box with half extents (hx, hz), rotated like Object3D.rotation.y = rot. */
  addBox(x: number, z: number, hx: number, hz: number, rot: number, top = 3) {
    this.insert({ x, z, r: Math.hypot(hx, hz), box: true, hx, hz, c: Math.cos(rot), s: Math.sin(rot), top });
  }

  query(x: number, z: number, r: number): Collider[] {
    const out = this.scratch;
    out.length = 0;
    const id = ++this.qid;
    const x0 = Math.floor((x - r) / CS);
    const x1 = Math.floor((x + r) / CS);
    const z0 = Math.floor((z - r) / CS);
    const z1 = Math.floor((z + r) / CS);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const list = this.cells.get(key(ix, iz));
        if (!list) continue;
        for (const c of list) {
          if (this.stamp.get(c) === id) continue;
          this.stamp.set(c, id);
          out.push(c);
        }
      }
    }
    return out;
  }

  /** Push a circle out of all colliders. Returns true when a collision happened. */
  resolve(p: Vector3, radius: number): boolean {
    let hit = false;
    for (let iter = 0; iter < 2; iter++) {
      const list = this.query(p.x, p.z, radius + 0.5);
      for (const c of list) {
        const dx = p.x - c.x;
        const dz = p.z - c.z;
        if (!c.box) {
          const d = Math.hypot(dx, dz);
          const min = c.r + radius;
          if (d < min) {
            const k = d > 1e-5 ? (min - d) / d : 0;
            p.x += dx * k + (d > 1e-5 ? 0 : min);
            p.z += dz * k;
            hit = true;
          }
          continue;
        }
        const lx = c.c * dx - c.s * dz;
        const lz = c.s * dx + c.c * dz;
        const cx = Math.max(-c.hx, Math.min(c.hx, lx));
        const cz = Math.max(-c.hz, Math.min(c.hz, lz));
        let px = lx - cx;
        let pz = lz - cz;
        const d = Math.hypot(px, pz);
        let plx = 0;
        let plz = 0;
        if (d > 1e-5) {
          if (d >= radius) continue;
          plx = (px / d) * (radius - d);
          plz = (pz / d) * (radius - d);
        } else {
          const penX = c.hx - Math.abs(lx);
          const penZ = c.hz - Math.abs(lz);
          if (penX < penZ) plx = Math.sign(lx || 1) * (penX + radius);
          else plz = Math.sign(lz || 1) * (penZ + radius);
        }
        p.x += c.c * plx + c.s * plz;
        p.z += -c.s * plx + c.c * plz;
        hit = true;
      }
    }
    return hit;
  }

  /** Is the point (x, y, z) inside a collider volume? Used for bullets. */
  blocked(x: number, y: number, z: number, groundY: number): boolean {
    const list = this.query(x, z, 0.1);
    for (const c of list) {
      if (y > groundY + c.top) continue;
      const dx = x - c.x;
      const dz = z - c.z;
      if (!c.box) {
        if (dx * dx + dz * dz < c.r * c.r) return true;
        continue;
      }
      const lx = c.c * dx - c.s * dz;
      const lz = c.s * dx + c.c * dz;
      if (Math.abs(lx) < c.hx && Math.abs(lz) < c.hz) return true;
    }
    return false;
  }
}
