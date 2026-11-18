import { BufferGeometry, Float32BufferAttribute, Mesh, PlaneGeometry, Vector3 } from 'three';
import { RNG, fbm, smoothstep, clamp, lerp, distToSegment } from '../engine/math';
import { GeometryBuilder, Col, PartOpts } from './builder';
import { CollisionWorld } from './collision';
import { MAT, WATER_H, Globals, worldMaterial, terrainMaterial, waterMaterial } from '../engine/materials';

export const SIZE = 240;
export const PLAY_R = 92;

export interface Lake {
  x: number;
  z: number;
  r: number;
}
export interface LightSpot {
  pos: Vector3;
  color: [number, number, number];
  intensity: number;
  radius: number;
  kind: 'fire' | 'toxic' | 'lamp';
  seed: number;
}
export interface Landmark {
  x: number;
  z: number;
  ch: string;
  cls: string;
}

const C = {
  conc: [0x9d998f, 0x8c877c, 0xa7a294, 0x7f7a70],
  rust: [0x8f4b2a, 0x9c5a31, 0x713b22, 0x86553a],
  car: [0x5d6a72, 0x8a7652, 0x7a3426, 0x6b6b5e, 0x4f5a4a],
  steel: 0x80868c,
  wood: 0x6e4c33,
  bone: 0xe8e2cf,
  scrub: 0x82904a,
  rock: 0x8c7f70,
  fire: 0xffa443,
  toxic: 0x7fc24a,
  alu: 0xaaa69b,
  cloth: 0x8d6f4d,
} as const;

/** Procedurally generated wasteland: heightfield, props, colliders, lights and minimap. */
export class World {
  readonly N = SIZE + 1;
  readonly heights: Float32Array;
  readonly colliders = new CollisionWorld();
  readonly lights: LightSpot[] = [];
  readonly toxics: { x: number; z: number; r: number }[] = [];
  readonly landmarks: Landmark[] = [];
  readonly lakes: Lake[];
  readonly road: [number, number][];
  readonly spawn: Vector3;
  readonly campfire: Vector3;
  readonly tower: Vector3;
  readonly towerTop: Vector3;
  readonly relays: Vector3[];
  terrain!: Mesh;
  water!: Mesh;
  props!: Mesh;
  mapBase: string[] = [];
  mapW = 88;
  mapH = 44;

  private rng: RNG;
  private b: GeometryBuilder;
  private occ: { x: number; z: number; r: number }[] = [];
  private ox: number;
  private oz: number;
  private roadLen: number[] = [];
  private roadCum: number[] = [];
  private flats: { x: number; z: number; r: number; h: number }[] = [];

  constructor(seed: number, G: Globals, mapRight: Vector3, mapUp: Vector3) {
    this.rng = new RNG(seed);
    this.b = new GeometryBuilder(seed * 7 + 3);
    this.ox = this.rng.range(0, 500);
    this.oz = this.rng.range(0, 500);
    const j = () => this.rng.range(-3, 3);

    this.road = [
      [-130, 52],
      [-80, 46 + j()],
      [-40, 42],
      [-5, 40 + j()],
      [30, 28],
      [60, 6 + j()],
      [82, -24],
      [130, -36],
    ];
    let cum = 0;
    for (let i = 0; i < this.road.length - 1; i++) {
      const [ax, az] = this.road[i];
      const [bx, bz] = this.road[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      this.roadLen.push(len);
      this.roadCum.push(cum);
      cum += len;
    }

    this.lakes = [
      { x: 52 + j(), z: 46 + j(), r: 10 },
      { x: -16 + j(), z: 8 + j(), r: 9 },
      { x: 26 + j(), z: -50 + j(), r: 11 },
      { x: -72 + j(), z: 24 + j(), r: 7 },
      { x: 76, z: 64, r: 6 },
      { x: -40, z: -72, r: 5.5 },
      { x: 12, z: 6, r: 4 },
    ];

    this.spawn = new Vector3(6, 0, 70);
    this.campfire = new Vector3(7.6, 0, 68.6);
    this.tower = new Vector3(8, 0, -76);
    this.relays = [
      new Vector3(-42 + j() * 0.5, 0, 52),
      new Vector3(36, 0, 54 + j() * 0.5),
      new Vector3(-64, 0, -6 + j()),
      new Vector3(50, 0, -22 + j() * 0.5),
      new Vector3(-14, 0, -42),
    ];
    this.flats = [
      { x: this.spawn.x, z: this.spawn.z, r: 12, h: 0 },
      { x: -16, z: -44, r: 26, h: 0 },
      { x: this.tower.x, z: this.tower.z, r: 16, h: 0 },
      { x: -42, z: 49, r: 12, h: 0 },
      { x: 60, z: -30, r: 16, h: 0 },
      { x: -44, z: 14, r: 12, h: 0 },
      ...this.relays.map((r) => ({ x: r.x, z: r.z, r: 7, h: 0 })),
    ];
    for (const f of this.flats) f.h = this.smoothH(f.x, f.z);

    this.heights = new Float32Array(this.N * this.N);
    this.buildTerrain(G);
    this.towerTop = new Vector3(this.tower.x, this.heightAt(this.tower.x, this.tower.z) + 37.5, this.tower.z);
    for (const r of this.relays) r.y = this.heightAt(r.x, r.z) + 0.3;
    this.spawn.y = this.heightAt(this.spawn.x, this.spawn.z);
    this.campfire.y = this.heightAt(this.campfire.x, this.campfire.z);

    this.buildProps();
    this.props = new Mesh(this.b.build(), worldMaterial(G));
    this.props.frustumCulled = false;

    const wg = new PlaneGeometry(SIZE, SIZE, 1, 1);
    wg.rotateX(-Math.PI / 2);
    this.water = new Mesh(wg, waterMaterial(G));
    this.water.position.y = WATER_H;
    this.water.frustumCulled = false;

    this.buildMap(mapRight, mapUp);
  }

  // ------------------------------------------------------------------ terrain
  private smoothH(x: number, z: number) {
    return Math.max(0.45, (fbm(x * 0.004 + this.ox, z * 0.004 + this.oz, 2) - 0.5) * 3 + 0.9);
  }

  private roadInfo(x: number, z: number) {
    let bd = 1e9;
    let bu = 0;
    let bs = 1;
    for (let i = 0; i < this.road.length - 1; i++) {
      const [ax, az] = this.road[i];
      const [bx, bz] = this.road[i + 1];
      const r = distToSegment(x, z, ax, az, bx, bz);
      if (r.d < bd) {
        bd = r.d;
        bu = this.roadCum[i] + r.t * this.roadLen[i];
        bs = r.side;
      }
    }
    return { d: bd, u: bu, side: bs };
  }

  private buildTerrain(G: Globals) {
    const N = this.N;
    const half = SIZE / 2;
    const pos = new Float32Array(N * N * 3);
    const aRoadV = new Float32Array(N * N);
    const aRoadU = new Float32Array(N * N);
    const aCrack = new Float32Array(N * N);
    const aRock = new Float32Array(N * N);
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const x = -half + ix;
        const z = -half + iz;
        const i = iz * N + ix;
        const n = fbm(x * 0.011 + this.ox, z * 0.011 + this.oz, 4);
        let h = 1.1 + (n - 0.5) * 5;
        const rp = (x * 0.55 + z * 0.83) * 0.08 + fbm(x * 0.02 + 40, z * 0.02 + 40, 3) * 4;
        const ridgeMask = smoothstep(0.35, 0.7, fbm(x * 0.009 + 9, z * 0.009 + 3, 3));
        h += Math.pow(1 - Math.abs(Math.sin(rp)), 3) * 2.4 * ridgeMask;

        const road = this.roadInfo(x, z);
        // keep mesas away from the road, lakes and points of interest
        let keepOut = smoothstep(9, 20, road.d);
        for (const f of this.flats) keepOut = Math.min(keepOut, smoothstep(f.r, f.r + 14, Math.hypot(x - f.x, z - f.z)));
        for (const l of this.lakes) keepOut = Math.min(keepOut, smoothstep(l.r * 1.6, l.r * 1.6 + 10, Math.hypot(x - l.x, z - l.z)));
        const mn = fbm(x * 0.028 + 71, z * 0.028 + 13, 4);
        const mesa = smoothstep(0.63, 0.7, mn) * keepOut;
        h = lerp(h, h * 0.3 + 6.5 + (mn - 0.7) * 6, mesa);
        let rock = mesa;

        const roadMask = 1 - smoothstep(4, 10, road.d);
        h = lerp(h, this.smoothH(x, z), roadMask);

        for (const f of this.flats) {
          const d = Math.hypot(x - f.x, z - f.z);
          h = lerp(h, f.h, 1 - smoothstep(f.r * 0.55, f.r, d));
        }

        // only the lake bowls may dip below the waterline
        h = Math.max(h, 0.25 + 0.15 * fbm(x * 0.05, z * 0.05, 2));
        let crack = smoothstep(0.62, 0.7, fbm(x * 0.02 + 200, z * 0.02 + 50, 3)) * 0.8;
        for (const l of this.lakes) {
          const t = Math.hypot(x - l.x, z - l.z) / l.r;
          const lakeH = -1.4 + 1.85 * smoothstep(0.7, 1.25, t);
          h = lerp(h, lakeH, 1 - smoothstep(1.25, 2.3, t));
          crack = Math.max(crack, 1 - smoothstep(1.1, 2.4, t));
        }

        const D = Math.hypot(x, z);
        const e = Math.max(0, D - 90);
        if (e > 0) {
          h += e * e * 0.05 + e * 0.5 + fbm(x * 0.08, z * 0.08, 3) * e * 0.35;
          rock = Math.max(rock, smoothstep(0, 5, e));
        }

        this.heights[i] = h;
        pos[i * 3] = x;
        pos[i * 3 + 1] = h;
        pos[i * 3 + 2] = z;
        aRoadV[i] = road.d < 8 ? road.d * road.side : 99;
        aRoadU[i] = road.u;
        aCrack[i] = clamp(crack, 0, 1);
        aRock[i] = rock;
      }
    }
    const idx: number[] = [];
    for (let iz = 0; iz < N - 1; iz++) {
      for (let ix = 0; ix < N - 1; ix++) {
        const a = iz * N + ix;
        const b = a + 1;
        const c = a + N;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('aRoadV', new Float32BufferAttribute(aRoadV, 1));
    g.setAttribute('aRoadU', new Float32BufferAttribute(aRoadU, 1));
    g.setAttribute('aCrack', new Float32BufferAttribute(aCrack, 1));
    g.setAttribute('aRock', new Float32BufferAttribute(aRock, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    this.terrain = new Mesh(g, terrainMaterial(G));
    this.terrain.frustumCulled = false;
  }

  heightAt(x: number, z: number): number {
    const half = SIZE / 2;
    const fx = clamp(x + half, 0, SIZE - 1e-3);
    const fz = clamp(z + half, 0, SIZE - 1e-3);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const N = this.N;
    const h = this.heights;
    const a = h[iz * N + ix];
    const b = h[iz * N + ix + 1];
    const c = h[(iz + 1) * N + ix];
    const d = h[(iz + 1) * N + ix + 1];
    // match the triangle split used by the mesh
    if (tx + tz <= 1) return a + (b - a) * tx + (c - a) * tz;
    return d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  }

  isWater(x: number, z: number) {
    return this.heightAt(x, z) < WATER_H + 0.02;
  }

  /** Radiation dose rate at a point (rads per second). */
  radAt(x: number, z: number): number {
    let r = 0;
    for (const l of this.lakes) {
      const d = Math.hypot(x - l.x, z - l.z);
      if (d < l.r * 1.45) r += d < l.r * 0.95 && this.isWater(x, z) ? 7 : 1.6 * (1 - d / (l.r * 1.45));
    }
    for (const t of this.toxics) {
      const d = Math.hypot(x - t.x, z - t.z);
      if (d < t.r) r += 5 * (1 - d / t.r);
    }
    return r;
  }

  // ------------------------------------------------------------------ helpers
  private loc(cx: number, cz: number, rot: number, lx: number, lz: number): [number, number] {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return [cx + lx * c + lz * s, cz - lx * s + lz * c];
  }

  private isFree(x: number, z: number, r: number, roadClear = 0) {
    if (Math.hypot(x, z) > PLAY_R - r - 2) return false;
    for (const o of this.occ) if (Math.hypot(x - o.x, z - o.z) < o.r + r) return false;
    for (const l of this.lakes) if (Math.hypot(x - l.x, z - l.z) < l.r * 1.25 + r) return false;
    if (roadClear > 0 && this.roadInfo(x, z).d < roadClear + r) return false;
    return true;
  }

  private findFree(r: number, roadClear = 0, tries = 60): [number, number] | null {
    for (let i = 0; i < tries; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = Math.sqrt(this.rng.next()) * (PLAY_R - 6);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (this.isFree(x, z, r, roadClear)) return [x, z];
    }
    return null;
  }

  private o(color: Col, mat: number, emit = 0, jitter = 0.08): PartOpts {
    return { color, mat, emit, jitter };
  }

  private pick<T>(arr: readonly T[]) {
    return this.rng.pick(arr);
  }

  private roadPoint(u: number) {
    for (let i = 0; i < this.roadLen.length; i++) {
      if (u <= this.roadCum[i] + this.roadLen[i] || i === this.roadLen.length - 1) {
        const t = clamp((u - this.roadCum[i]) / this.roadLen[i], 0, 1);
        const [ax, az] = this.road[i];
        const [bx, bz] = this.road[i + 1];
        return { x: lerp(ax, bx, t), z: lerp(az, bz, t), dx: (bx - ax) / this.roadLen[i], dz: (bz - az) / this.roadLen[i] };
      }
    }
    return { x: 0, z: 0, dx: 1, dz: 0 };
  }

  // ------------------------------------------------------------------- props
  private buildProps() {
    const rng = this.rng;
    this.occ.push({ x: this.spawn.x, z: this.spawn.z, r: 7 });
    for (const r of this.relays) this.occ.push({ x: r.x, z: r.z, r: 4 });

    this.camp();
    this.gasStation(-42, 47);
    this.town(-16, -44);
    this.towerSite();
    this.crashSite(60, -32);
    this.ribs(-44, 14, 0.5);
    this.pylons();

    for (const r of this.relays) {
      const y = this.heightAt(r.x, r.z);
      this.b.box(r.x, y + 0.05, r.z, 2.6, 0.4, 2.6, this.o(C.conc[1], MAT.CONCRETE));
      this.colliders.addCircle(r.x, r.z, 0.55, 3);
    }

    // wrecks strewn along the highway
    const total = this.roadCum[this.roadCum.length - 1] + this.roadLen[this.roadLen.length - 1];
    for (let i = 0; i < 26; i++) {
      const u = rng.range(20, total - 20);
      const p = this.roadPoint(u);
      const lat = rng.range(-3.5, 3.5) + (rng.chance(0.25) ? rng.range(-8, 8) : 0);
      const x = p.x - p.dz * lat;
      const z = p.z + p.dx * lat;
      if (!this.isFree(x, z, 2.4)) continue;
      const rot = Math.atan2(-p.dz, p.dx) + (rng.chance(0.3) ? rng.range(-1.5, 1.5) : rng.range(-0.35, 0.35));
      if (rng.chance(0.12)) this.bus(x, z, rot);
      else this.car(x, z, rot);
    }
    for (let i = 0; i < 9; i++) {
      const f = this.findFree(2.5, 4);
      if (f) this.car(f[0], f[1], rng.range(0, Math.PI * 2));
    }
    for (let i = 0; i < 4; i++) {
      const u = rng.range(30, total - 30);
      const p = this.roadPoint(u);
      const side = rng.chance(0.5) ? 1 : -1;
      const x = p.x - p.dz * 6 * side;
      const z = p.z + p.dx * 6 * side;
      if (this.isFree(x, z, 3)) this.billboard(x, z, Math.atan2(-p.dz, p.dx));
    }
    for (let i = 0; i < 7; i++) {
      const u = rng.range(10, total - 10);
      const p = this.roadPoint(u);
      const x = p.x - p.dz * 4.2;
      const z = p.z + p.dx * 4.2;
      if (this.isFree(x, z, 0.8)) this.roadSign(x, z, Math.atan2(-p.dz, p.dx));
    }

    // scattered ruins
    for (let i = 0; i < 6; i++) {
      const f = this.findFree(7, 6);
      if (!f) continue;
      this.building(f[0], f[1], rng.range(4.5, 8), rng.range(4, 7), rng.range(2.4, 4.6), rng.range(0, Math.PI));
      this.occ.push({ x: f[0], z: f[1], r: 6 });
      this.landmarks.push({ x: f[0], z: f[1], ch: '#', cls: 'ruin' });
    }

    // tank traps / barricades
    for (let i = 0; i < 14; i++) {
      const u = rng.range(10, total - 10);
      const p = this.roadPoint(u);
      const lat = rng.range(-5, 5);
      const x = p.x - p.dz * lat + rng.range(-1, 1);
      const z = p.z + p.dx * lat + rng.range(-1, 1);
      if (this.isFree(x, z, 1)) this.tankTrap(x, z);
    }

    for (let i = 0; i < 30; i++) {
      const f = this.findFree(1.5, 3);
      if (f) this.deadTree(f[0], f[1]);
    }
    for (let i = 0; i < 46; i++) {
      const f = this.findFree(1.6, 4);
      if (f) this.rockCluster(f[0], f[1]);
    }
    for (let i = 0; i < 18; i++) {
      const f = this.findFree(1, 3);
      if (f) this.bones(f[0], f[1]);
    }
    for (let i = 0; i < 9; i++) {
      const f = this.findFree(1, 3);
      if (f) this.fireBarrel(f[0], f[1]);
    }
    // toxic barrels near lakes and ruins
    for (const l of this.lakes) {
      const n = l.r > 7 ? 3 : 1;
      for (let k = 0; k < n; k++) {
        const a = rng.range(0, Math.PI * 2);
        const d = l.r * rng.range(1.45, 1.9);
        const x = l.x + Math.cos(a) * d;
        const z = l.z + Math.sin(a) * d;
        this.toxicBarrel(x, z);
      }
      this.lights.push({ pos: new Vector3(l.x, WATER_H + 1.2, l.z), color: [0.35, 0.95, 0.45], intensity: 0.55, radius: l.r * 1.7, kind: 'toxic', seed: rng.next() });
      this.landmarks.push({ x: l.x, z: l.z, ch: '~', cls: 'lake' });
    }
    for (let i = 0; i < 5; i++) {
      const f = this.findFree(1, 3);
      if (f) this.toxicBarrel(f[0], f[1]);
    }
    for (let i = 0; i < 40; i++) {
      const f = this.findFree(0.8, 3.5);
      if (f) this.debris(f[0], f[1]);
    }
    // scrub last; it does not block anything
    for (let i = 0; i < 190; i++) {
      const f = this.findFree(0.6, 3.5);
      if (f) this.scrub(f[0], f[1]);
    }
  }

  private ground(x: number, z: number) {
    return this.heightAt(x, z);
  }

  private camp() {
    const b = this.b;
    const { x, z } = this.campfire;
    const y = this.ground(x, z);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      b.rock(x + Math.cos(a) * 0.75, y + 0.1, z + Math.sin(a) * 0.75, 0.2, this.o(C.rock, MAT.ROCK), 1, 0.7, 1);
    }
    b.beam(new Vector3(x - 0.5, y + 0.15, z - 0.2), new Vector3(x + 0.5, y + 0.15, z + 0.2), 0.14, this.o(C.wood, MAT.WOOD));
    b.beam(new Vector3(x - 0.2, y + 0.2, z + 0.5), new Vector3(x + 0.2, y + 0.2, z - 0.5), 0.14, this.o(C.wood, MAT.WOOD));
    b.cone(x, y + 0.55, z, 0.35, 0.9, 5, this.o(C.fire, MAT.FIRE, 3));
    b.cone(x + 0.15, y + 0.4, z - 0.1, 0.22, 0.6, 5, this.o(0xffd070, MAT.FIRE, 3.5));
    this.colliders.addCircle(x, z, 0.8, 0.6);
    this.lights.push({ pos: new Vector3(x, y + 1.2, z), color: [1, 0.55, 0.22], intensity: 2.4, radius: 12, kind: 'fire', seed: 0.3 });
    // tent
    const tx = this.spawn.x - 3.2;
    const tz = this.spawn.z + 1.2;
    const ty = this.ground(tx, tz);
    b.cone(tx, ty + 0.9, tz, 1.5, 1.8, 4, this.o(C.cloth, MAT.WOOD));
    this.colliders.addCircle(tx, tz, 1.2, 1.8);
    b.box(tx + 2, ty + 0.12, tz - 0.4, 0.8, 0.22, 1.8, this.o(0x6e5a44, MAT.WOOD));
    b.cyl(tx + 2.4, ty + 0.4, tz + 2, 0.32, 0.32, 0.8, 8, this.o(C.rust[0], MAT.RUST));
    this.landmarks.push({ x: this.spawn.x, z: this.spawn.z, ch: 'A', cls: 'camp' });
  }

  private car(x: number, z: number, rot: number) {
    const b = this.b;
    const rng = this.rng;
    const y = this.ground(x, z);
    const col = this.pick(C.car);
    const flipped = rng.chance(0.12);
    const missing = rng.chance(0.35);
    const by = y + (missing ? 0.45 : 0.75);
    const tilt = { y: rot, z: rng.range(-0.06, 0.06) + (flipped ? Math.PI : 0), x: rng.range(-0.05, 0.05) };
    b.box(x, by, z, 4.2, 0.85, 1.9, this.o(col, MAT.RUST, 0, 0.18), tilt);
    const [cx, cz] = this.loc(x, z, rot, -0.25, 0);
    b.box(cx, by + (flipped ? -0.75 : 0.75), cz, 2.1, 0.7, 1.7, this.o(col, MAT.RUST, 0, 0.2), tilt);
    if (!flipped) {
      for (const [lx, lz] of [[1.35, 0.95], [-1.35, 0.95], [1.35, -0.95], [-1.35, -0.95]]) {
        if (missing && rng.chance(0.6)) continue;
        const [wx, wz] = this.loc(x, z, rot, lx, lz);
        b.cyl(wx, y + 0.38, wz, 0.38, 0.38, 0.28, 8, this.o(0x2f2c2a, MAT.STEEL), { x: Math.PI / 2, y: rot });
      }
    }
    this.colliders.addBox(x, z, 2.1, 0.95, rot, 1.6);
    this.occ.push({ x, z, r: 2.3 });
  }

  private bus(x: number, z: number, rot: number) {
    const b = this.b;
    const y = this.ground(x, z);
    const onSide = this.rng.chance(0.5);
    const col = this.pick([0x9a7a3a, 0x7d6a4a, 0x6a7a7a]);
    if (onSide) {
      b.box(x, y + 1.2, z, 9, 2.4, 2.5, this.o(col, MAT.RUST, 0, 0.2), { y: rot, x: Math.PI / 2 });
      this.colliders.addBox(x, z, 4.5, 1.25, rot, 2.5);
    } else {
      b.box(x, y + 1.5, z, 9, 2.4, 2.5, this.o(col, MAT.RUST, 0, 0.2), { y: rot });
      for (let i = -3; i <= 3; i++) {
        for (const side of [-1.27, 1.27]) {
          const [wx, wz] = this.loc(x, z, rot, i * 1.15, side);
          b.box(wx, y + 2.0, wz, 0.8, 0.6, 0.05, this.o(0x1a1d20, MAT.STEEL), { y: rot });
        }
      }
      this.colliders.addBox(x, z, 4.5, 1.25, rot, 2.7);
    }
    this.occ.push({ x, z, r: 4.8 });
    this.landmarks.push({ x, z, ch: '=', cls: 'wreck' });
  }

  private billboard(x: number, z: number, rot: number) {
    const b = this.b;
    const y = this.ground(x, z);
    for (const lx of [-2, 2]) {
      const [px, pz] = this.loc(x, z, rot, lx, 0);
      b.box(px, y + 2.3, pz, 0.25, 4.6, 0.25, this.o(C.wood, MAT.WOOD));
      this.colliders.addCircle(px, pz, 0.25, 4);
    }
    const hang = this.rng.chance(0.4) ? this.rng.range(0.2, 0.5) : 0;
    b.box(x, y + 4.2, z, 5.6, 2.4, 0.18, this.o(this.pick(C.rust), MAT.RUST, 0, 0.25), { y: rot, z: hang });
    this.occ.push({ x, z, r: 3 });
  }

  private roadSign(x: number, z: number, rot: number) {
    const b = this.b;
    const y = this.ground(x, z);
    const lean = this.rng.range(-0.25, 0.25);
    b.box(x, y + 1.2, z, 0.1, 2.4, 0.1, this.o(C.steel, MAT.STEEL), { y: rot, z: lean });
    b.box(x, y + 2.3, z, 1.1, 0.7, 0.06, this.o(this.pick([0x5c7a4a, 0x8a3a2a, 0x9a8a50]), MAT.RUST), { y: rot, z: lean });
    this.colliders.addCircle(x, z, 0.15, 2.5);
  }

  private building(cx: number, cz: number, w: number, d: number, h: number, rot: number, door = -1) {
    const b = this.b;
    const rng = this.rng;
    const y0 = this.ground(cx, cz) - 0.3;
    const t = 0.42;
    const col = this.pick(C.conc);
    b.box(cx, y0 + 0.2, cz, w, 0.5, d, this.o(C.conc[3], MAT.CONCRETE), { y: rot });
    const doorSide = door >= 0 ? door : rng.int(0, 3);
    const sides: [number, number, number, number, number][] = [
      [-w / 2, -d / 2, w / 2, -d / 2, 0],
      [w / 2, -d / 2, w / 2, d / 2, Math.PI / 2],
      [w / 2, d / 2, -w / 2, d / 2, 0],
      [-w / 2, d / 2, -w / 2, -d / 2, Math.PI / 2],
    ];
    sides.forEach(([x0, z0, x1, z1, srot], si) => {
      const L = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(2, Math.round(L / 1.5));
      const segL = L / n;
      for (let s = 0; s < n; s++) {
        if (si === doorSide && s === Math.floor(n / 2)) continue;
        if (rng.chance(0.1)) continue;
        let hh = h * (0.35 + rng.next() * 0.65);
        if (rng.chance(0.2)) hh *= 0.4;
        const k = (s + 0.5) / n;
        const [wx, wz] = this.loc(cx, cz, rot, lerp(x0, x1, k), lerp(z0, z1, k));
        const r = rot + srot;
        if (hh > 2.3 && rng.chance(0.4)) {
          b.box(wx, y0 + 0.5 + 0.45, wz, segL + 0.02, 0.9, t, this.o(col, MAT.CONCRETE), { y: r });
          b.box(wx, y0 + 0.5 + (1.95 + hh) / 2, wz, segL + 0.02, hh - 1.95, t, this.o(col, MAT.CONCRETE), { y: r });
        } else {
          b.box(wx, y0 + 0.5 + hh / 2, wz, segL + 0.02, hh, t, this.o(col, MAT.CONCRETE), { y: r });
        }
        this.colliders.addBox(wx, wz, segL / 2, t / 2 + 0.05, r, hh);
      }
    });
    // pillars at corners
    for (const [lx, lz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]) {
      const [wx, wz] = this.loc(cx, cz, rot, lx, lz);
      const ph = h * rng.range(0.6, 1.05);
      b.box(wx, y0 + 0.5 + ph / 2, wz, 0.55, ph, 0.55, this.o(C.conc[3], MAT.CONCRETE), { y: rot });
    }
    // rubble
    const nr = rng.int(3, 7);
    for (let i = 0; i < nr; i++) {
      const [rx, rz] = this.loc(cx, cz, rot, rng.range(-w / 2 - 1.5, w / 2 + 1.5), rng.range(-d / 2 - 1.5, d / 2 + 1.5));
      const s = rng.range(0.25, 0.6);
      b.box(rx, this.ground(rx, rz) + s * 0.3, rz, s * 1.4, s * 0.6, s, this.o(col, MAT.CONCRETE, 0, 0.15), { y: rng.range(0, 3), z: rng.range(-0.3, 0.3) });
    }
    // a collapsed roof slab leaning in
    if (rng.chance(0.45)) {
      const [rx, rz] = this.loc(cx, cz, rot, rng.range(-w / 4, w / 4), rng.range(-d / 4, d / 4));
      b.box(rx, y0 + 1.4, rz, w * 0.6, 0.25, d * 0.5, this.o(C.conc[2], MAT.CONCRETE), { y: rot, z: rng.range(0.3, 0.6) });
    }
  }

  private gasStation(x: number, z: number) {
    const b = this.b;
    const rot = 0.1;
    const y = this.ground(x, z);
    for (const [lx, lz] of [[-3.2, -2.2], [3.2, -2.2], [-3.2, 2.2], [3.2, 2.2]]) {
      const [px, pz] = this.loc(x, z, rot, lx, lz);
      const ph = lx > 0 && lz > 0 ? 2.6 : 3.8;
      b.box(px, y + ph / 2, pz, 0.35, ph, 0.35, this.o(C.steel, MAT.STEEL));
      this.colliders.addCircle(px, pz, 0.3, ph);
    }
    b.box(x, y + 3.6, z, 8.6, 0.35, 6, this.o(0xb14a32, MAT.RUST, 0, 0.15), { y: rot, z: -0.1, x: -0.12 });
    for (const lx of [-1.4, 1.4]) {
      const [px, pz] = this.loc(x, z, rot, lx, 0);
      b.box(px, y + 0.65, pz, 0.7, 1.3, 0.45, this.o(0xc8b48a, MAT.STEEL), { y: rot });
      b.box(px, y + 1.15, pz, 0.72, 0.25, 0.47, this.o(0xa03828, MAT.RUST), { y: rot });
      this.colliders.addBox(px, pz, 0.35, 0.23, rot, 1.3);
    }
    const [sx, sz] = this.loc(x, z, rot, 0, -7.5);
    this.building(sx, sz, 7, 5, 3.6, rot, 2);
    const [px, pz] = this.loc(x, z, rot, 6.2, 3.5);
    const py = this.ground(px, pz);
    b.box(px, py + 3.5, pz, 0.3, 7, 0.3, this.o(C.steel, MAT.STEEL));
    b.box(px, py + 6.6, pz, 2.6, 1.5, 0.25, this.o(0xd8c070, MAT.RUST, 0, 0.1), { y: rot + 0.5, z: 0.15 });
    this.colliders.addCircle(px, pz, 0.3, 7);
    this.occ.push({ x, z, r: 10 });
    this.landmarks.push({ x, z, ch: '$', cls: 'poi' });
  }

  private town(cx: number, cz: number) {
    const rng = this.rng;
    const spots: [number, number][] = [];
    for (let i = 0; i < 40 && spots.length < 8; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(8, 21);
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      if (spots.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 9.5)) continue;
      if (!this.isFree(x, z, 4)) continue;
      spots.push([x, z]);
    }
    for (const [x, z] of spots) {
      const rot = Math.round(rng.range(0, 3)) * (Math.PI / 2) + rng.range(-0.15, 0.15);
      this.building(x, z, rng.range(5, 8), rng.range(4.5, 7), rng.range(2.8, 5.5), rot);
      this.occ.push({ x, z, r: 5 });
    }
    // water tower
    const wx = cx - 13;
    const wz = cz - 9;
    const wy = this.ground(wx, wz);
    const b = this.b;
    for (const [lx, lz] of [[-1.3, -1.3], [1.3, -1.3], [1.3, 1.3], [-1.3, 1.3]]) {
      b.beam(new Vector3(wx + lx * 1.4, wy, wz + lz * 1.4), new Vector3(wx + lx, wy + 7, wz + lz), 0.2, this.o(C.steel, MAT.STEEL));
      this.colliders.addCircle(wx + lx * 1.4, wz + lz * 1.4, 0.25, 7);
    }
    b.beam(new Vector3(wx - 1.6, wy + 3.5, wz - 1.6), new Vector3(wx + 1.6, wy + 3.5, wz + 1.6), 0.12, this.o(C.steel, MAT.STEEL));
    b.beam(new Vector3(wx + 1.6, wy + 3.5, wz - 1.6), new Vector3(wx - 1.6, wy + 3.5, wz + 1.6), 0.12, this.o(C.steel, MAT.STEEL));
    b.cyl(wx, wy + 8.6, wz, 2.2, 2.2, 3.2, 12, this.o(C.rust[2], MAT.RUST, 0, 0.12));
    b.cone(wx, wy + 10.8, wz, 2.4, 1.3, 12, this.o(C.rust[0], MAT.RUST));
    this.occ.push({ x: wx, z: wz, r: 3 });
    for (let i = 0; i < 3; i++) this.fireBarrel(cx + rng.range(-5, 5), cz + rng.range(-5, 5));
    this.landmarks.push({ x: cx, z: cz, ch: 'H', cls: 'poi' });
  }

  private towerSite() {
    const b = this.b;
    const { x, z } = this.tower;
    const y = this.ground(x, z);
    const H = 34;
    const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const wAt = (hh: number) => lerp(2.8, 0.55, hh / H);
    for (const [lx, lz] of legs) {
      b.beam(new Vector3(x + lx * wAt(0), y, z + lz * wAt(0)), new Vector3(x + lx * wAt(H), y + H, z + lz * wAt(H)), 0.26, this.o(0x8c9196, MAT.STEEL));
      this.colliders.addCircle(x + lx * wAt(0), z + lz * wAt(0), 0.35, H);
    }
    for (let hh = 0; hh < H - 1; hh += 3.4) {
      const w0 = wAt(hh);
      const w1 = wAt(hh + 3.4);
      for (let k = 0; k < 4; k++) {
        const [ax, az] = legs[k];
        const [bx, bz] = legs[(k + 1) % 4];
        b.beam(new Vector3(x + ax * w0, y + hh, z + az * w0), new Vector3(x + bx * w1, y + hh + 3.4, z + bz * w1), 0.1, this.o(0x8c9196, MAT.STEEL));
        b.beam(new Vector3(x + bx * w0, y + hh, z + bz * w0), new Vector3(x + ax * w1, y + hh + 3.4, z + az * w1), 0.1, this.o(0x8c9196, MAT.STEEL));
        b.beam(new Vector3(x + ax * w1, y + hh + 3.4, z + az * w1), new Vector3(x + bx * w1, y + hh + 3.4, z + bz * w1), 0.12, this.o(0x8c9196, MAT.STEEL));
      }
    }
    for (const ph of [12, 22]) {
      const w = wAt(ph) + 0.6;
      b.box(x, y + ph, z, w * 2, 0.18, w * 2, this.o(0x6e7378, MAT.STEEL));
    }
    b.cyl(x, y + H + 2.5, z, 0.08, 0.14, 5, 6, this.o(0x8c9196, MAT.STEEL));
    for (const [a, hh] of [[0.4, 18], [2.6, 26], [4.4, 15]]) {
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const w = wAt(hh) + 0.9;
      b.cyl(x + dx * w, y + hh, z + dz * w, 1.1, 1.1, 0.25, 12, this.o(0xc9c4b6, MAT.STEEL), { x: Math.PI / 2, y: Math.atan2(dx, dz) });
    }
    // control hut
    this.building(x, z + 7.5, 6, 4.5, 3.2, 0, 2);
    // perimeter fence with gaps
    const R = 14;
    const posts = 36;
    for (let i = 0; i < posts; i++) {
      const a0 = (i / posts) * Math.PI * 2;
      const a1 = ((i + 1) / posts) * Math.PI * 2;
      const gap = Math.abs(Math.sin(a0) - 1) < 0.12 || this.rng.chance(0.15);
      const px = x + Math.cos(a0) * R;
      const pz = z + Math.sin(a0) * R;
      const py = this.ground(px, pz);
      b.box(px, py + 1.0, pz, 0.12, 2.0, 0.12, this.o(C.steel, MAT.STEEL), { z: this.rng.range(-0.1, 0.1) });
      if (gap) continue;
      const qx = x + Math.cos(a1) * R;
      const qz = z + Math.sin(a1) * R;
      const qy = this.ground(qx, qz);
      for (const hh of [0.55, 1.2, 1.85]) b.beam(new Vector3(px, py + hh, pz), new Vector3(qx, qy + hh, qz), 0.05, this.o(0x9aa0a4, MAT.STEEL));
      const mx = (px + qx) / 2;
      const mz = (pz + qz) / 2;
      this.colliders.addBox(mx, mz, Math.hypot(qx - px, qz - pz) / 2, 0.1, -Math.atan2(qz - pz, qx - px), 2);
    }
    this.occ.push({ x, z, r: 16 });
    this.landmarks.push({ x, z, ch: 'T', cls: 'tower' });
  }

  private crashSite(cx: number, cz: number) {
    const b = this.b;
    const rot = 0.65;
    const alu = (j = 0.12): PartOpts => this.o(C.alu, MAT.STEEL, 0, j);
    const parts: [number, number, number][] = [
      [-4.6, 0, 0],
      [5.2, 0.6, 0.15],
    ];
    for (const [lx, lz, dr] of parts) {
      const [x, z] = this.loc(cx, cz, rot, lx, lz);
      const y = this.ground(x, z);
      b.cyl(x, y + 0.9, z, 1.75, 1.75, 8.2, 14, alu(), { z: Math.PI / 2, y: rot + dr });
      for (let k = -3; k <= 3; k++) {
        const [wx, wz] = this.loc(x, z, rot + dr, k * 1.1, 1.72);
        b.box(wx, y + 1.5, wz, 0.5, 0.4, 0.05, this.o(0x15181a, MAT.STEEL), { y: rot + dr });
      }
      this.colliders.addBox(x, z, 4.1, 1.75, rot + dr, 2.6);
    }
    // cockpit cone and tail fin
    const [nx, nz] = this.loc(cx, cz, rot, -9.8, -0.1);
    b.cone(nx, this.ground(nx, nz) + 0.9, nz, 1.7, 2.6, 14, alu(), { z: Math.PI / 2, y: rot });
    this.colliders.addCircle(nx, nz, 1.4, 2.4);
    const [tx, tz] = this.loc(cx, cz, rot, 8.9, 0.6);
    b.box(tx, this.ground(tx, tz) + 3.2, tz, 2.6, 3.6, 0.3, this.o(0xb8442e, MAT.RUST, 0, 0.1), { y: rot + 0.15, z: -0.35 });
    // detached wing
    const [wx, wz] = this.loc(cx, cz, rot, -1, 7.5);
    b.box(wx, this.ground(wx, wz) + 0.6, wz, 11, 0.3, 2.8, alu(0.18), { y: rot - 0.5, x: 0.12, z: 0.06 });
    this.colliders.addBox(wx, wz, 5.5, 1.4, rot - 0.5, 1.2);
    const [ex, ez] = this.loc(cx, cz, rot, 2.5, 9.6);
    b.cyl(ex, this.ground(ex, ez) + 0.7, ez, 0.75, 0.6, 2.6, 10, this.o(0x5c6066, MAT.STEEL), { z: Math.PI / 2, y: rot - 0.3 });
    this.colliders.addCircle(ex, ez, 1.1, 1.5);
    // debris trail
    for (let i = 0; i < 26; i++) {
      const [dx, dz] = this.loc(cx, cz, rot, this.rng.range(10, 30), this.rng.range(-5, 5));
      const s = this.rng.range(0.3, 1.0);
      b.box(dx, this.ground(dx, dz) + s * 0.2, dz, s * 1.6, s * 0.3, s, alu(0.2), { y: this.rng.range(0, 3), z: this.rng.range(-0.4, 0.4) });
    }
    this.fireBarrel(cx + 3, cz - 4);
    this.occ.push({ x: cx, z: cz, r: 13 });
    this.landmarks.push({ x: cx, z: cz, ch: '%', cls: 'poi' });
  }

  private ribs(cx: number, cz: number, rot: number) {
    const b = this.b;
    const bone = (j = 0.06) => this.o(C.bone, MAT.BONE, 0, j);
    const len = 18;
    const spine: Vector3[] = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const [x, z] = this.loc(cx, cz, rot, (t - 0.5) * len, Math.sin(t * 3) * 0.6);
      const y = this.ground(x, z) + 3.8 * Math.sin(Math.PI * (0.15 + t * 0.75)) + 0.5;
      spine.push(new Vector3(x, y, z));
    }
    for (let i = 0; i < spine.length - 1; i++) b.beam(spine[i], spine[i + 1], 0.42, bone());
    for (let i = 2; i < 12; i++) {
      const p = spine[i];
      const span = 3.6 + Math.sin((i / 12) * Math.PI) * 1.4;
      for (const side of [-1, 1]) {
        if (this.rng.chance(0.12)) continue;
        let prev = p.clone();
        const steps = 5;
        for (let k = 1; k <= steps; k++) {
          const t = k / steps;
          const [x, z] = this.loc(p.x, p.z, rot, Math.sin(t * 2) * 0.3, side * span * Math.sin(t * Math.PI * 0.5));
          const y = lerp(p.y, this.ground(x, z) - 0.2, Math.pow(t, 1.6)) + Math.sin(t * Math.PI) * 0.6;
          const q = new Vector3(x, y, z);
          b.beam(prev, q, 0.22, bone(0.1));
          prev = q;
        }
        this.colliders.addCircle(prev.x, prev.z, 0.3, 1);
      }
    }
    const head = spine[0];
    b.rock(head.x, this.ground(head.x, head.z) + 1.0, head.z, 1.5, bone(), 1.4, 0.8, 1, { y: rot });
    const [hx, hz] = this.loc(head.x, head.z, rot, -1.6, 0);
    b.beam(new Vector3(hx, head.y - 1.5, hz), new Vector3(hx - 1.2, head.y + 0.8, hz + 1.8), 0.28, bone());
    b.beam(new Vector3(hx, head.y - 1.5, hz), new Vector3(hx - 1.2, head.y + 0.8, hz - 1.8), 0.28, bone());
    this.colliders.addCircle(head.x, head.z, 1.6, 2);
    this.occ.push({ x: cx, z: cz, r: 10 });
    this.landmarks.push({ x: cx, z: cz, ch: '&', cls: 'poi' });
  }

  private pylons() {
    const b = this.b;
    const a = new Vector3(-92, 0, 80);
    const c = new Vector3(-48, 0, -86);
    const count = 9;
    let prevArms: [Vector3, Vector3] | null = null;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const x = lerp(a.x, c.x, t) + this.rng.range(-1.5, 1.5);
      const z = lerp(a.z, c.z, t);
      if (Math.hypot(x, z) > PLAY_R - 3 || this.lakes.some((l) => Math.hypot(x - l.x, z - l.z) < l.r * 1.4)) {
        prevArms = null;
        continue;
      }
      const y = this.ground(x, z);
      const rot = Math.atan2(-(c.z - a.z), c.x - a.x) + Math.PI / 2;
      const broken = this.rng.chance(0.2);
      const H = broken ? 5.5 : 10;
      const P = (lx: number, ly: number, lz: number) => {
        const [wx, wz] = this.loc(x, z, rot, lx, lz);
        return new Vector3(wx, y + ly, wz);
      };
      const w = (hh: number) => lerp(1.3, 0.35, hh / 10);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const st = this.o(C.steel, MAT.STEEL);
      for (const [lx, lz] of corners) b.beam(P(lx * w(0), 0, lz * w(0)), P(lx * w(H), H, lz * w(H)), 0.14, st);
      for (let hh = 0; hh < H - 0.5; hh += 2.5) {
        const h1 = Math.min(H, hh + 2.5);
        for (let k = 0; k < 4; k++) {
          const [ax, az] = corners[k];
          const [bx, bz] = corners[(k + 1) % 4];
          b.beam(P(ax * w(hh), hh, az * w(hh)), P(bx * w(h1), h1, bz * w(h1)), 0.07, st);
          b.beam(P(ax * w(h1), h1, az * w(h1)), P(bx * w(h1), h1, bz * w(h1)), 0.08, st);
        }
      }
      this.colliders.addCircle(x, z, 1.3, H);
      this.occ.push({ x, z, r: 2.5 });
      if (broken) {
        prevArms = null;
        continue;
      }
      const armL = P(-3.2, 8.6, 0);
      const armR = P(3.2, 8.6, 0);
      b.beam(armL, armR, 0.16, st);
      b.beam(P(-0.4, 10, 0), armL, 0.08, st);
      b.beam(P(0.4, 10, 0), armR, 0.08, st);
      for (const arm of [armL, armR]) b.box(arm.x, arm.y - 0.35, arm.z, 0.16, 0.6, 0.16, this.o(0xc8c0a8, MAT.BONE));
      if (prevArms) {
        for (let s = 0; s < 2; s++) {
          const p0 = prevArms[s].clone().add(new Vector3(0, -0.65, 0));
          const p1 = [armL, armR][s].clone().add(new Vector3(0, -0.65, 0));
          const segs = 10;
          let last = p0;
          for (let k = 1; k <= segs; k++) {
            const tt = k / segs;
            const q = p0.clone().lerp(p1, tt);
            q.y -= Math.sin(tt * Math.PI) * 2.2;
            b.beam(last, q, 0.07, this.o(0x55595c, MAT.STEEL));
            last = q;
          }
        }
      }
      prevArms = [armL, armR];
    }
  }

  private tankTrap(x: number, z: number) {
    const y = this.ground(x, z);
    const st = this.o(this.pick([C.rust[0], C.rust[2], C.steel]), MAT.RUST);
    const r = this.rng.range(0, Math.PI);
    for (let k = 0; k < 3; k++) {
      const a = r + (k * Math.PI) / 3;
      const dx = Math.cos(a) * 0.9;
      const dz = Math.sin(a) * 0.9;
      this.b.beam(new Vector3(x - dx, y, z - dz), new Vector3(x + dx * 0.6, y + 1.3, z + dz * 0.6), 0.16, st);
    }
    this.colliders.addCircle(x, z, 0.7, 1.3);
    this.occ.push({ x, z, r: 1.2 });
  }

  private deadTree(x: number, z: number) {
    const b = this.b;
    const rng = this.rng;
    const y = this.ground(x, z);
    const h = rng.range(2.4, 4.4);
    const lean = new Vector3(rng.range(-0.4, 0.4), 0, rng.range(-0.4, 0.4));
    const top = new Vector3(x + lean.x, y + h, z + lean.z);
    b.beam(new Vector3(x, y - 0.2, z), top, rng.range(0.16, 0.24), this.o(C.wood, MAT.WOOD));
    const nb = rng.int(3, 5);
    for (let i = 0; i < nb; i++) {
      const t = rng.range(0.45, 0.95);
      const p = new Vector3(x, y, z).lerp(top, t);
      const a = rng.range(0, Math.PI * 2);
      const L = rng.range(0.7, 1.6);
      const q = p.clone().add(new Vector3(Math.cos(a) * L, rng.range(0.3, 1.0), Math.sin(a) * L));
      b.beam(p, q, 0.08, this.o(C.wood, MAT.WOOD));
      if (rng.chance(0.5)) b.beam(q, q.clone().add(new Vector3(rng.range(-0.5, 0.5), 0.5, rng.range(-0.5, 0.5))), 0.05, this.o(C.wood, MAT.WOOD));
    }
    this.colliders.addCircle(x, z, 0.3, h);
    this.occ.push({ x, z, r: 1.2 });
  }

  private rockCluster(x: number, z: number) {
    const b = this.b;
    const rng = this.rng;
    const n = rng.int(1, 4);
    for (let i = 0; i < n; i++) {
      const rx = x + rng.range(-1.2, 1.2);
      const rz = z + rng.range(-1.2, 1.2);
      const r = rng.range(0.35, 1.25);
      b.rock(rx, this.ground(rx, rz) + r * 0.25, rz, r, this.o(C.rock, MAT.ROCK, 0, 0.12), rng.range(0.8, 1.4), rng.range(0.5, 0.9), rng.range(0.8, 1.3), { y: rng.range(0, 6) });
      if (r > 0.5) this.colliders.addCircle(rx, rz, r * 0.8, r);
    }
    this.occ.push({ x, z, r: 1.6 });
  }

  private scrub(x: number, z: number) {
    const rng = this.rng;
    const n = rng.int(2, 5);
    for (let i = 0; i < n; i++) {
      const rx = x + rng.range(-0.7, 0.7);
      const rz = z + rng.range(-0.7, 0.7);
      const r = rng.range(0.25, 0.55);
      this.b.rock(rx, this.ground(rx, rz) + r * 0.3, rz, r, this.o(C.scrub, MAT.SCRUB, 0, 0.18), 1, rng.range(0.6, 1.1), 1);
    }
  }

  private bones(x: number, z: number) {
    const b = this.b;
    const y = this.ground(x, z);
    const rot = this.rng.range(0, Math.PI * 2);
    const bone = this.o(C.bone, MAT.BONE, 0, 0.05);
    b.box(x, y + 0.2, z, 0.5, 0.35, 0.4, bone, { y: rot });
    const [hx, hz] = this.loc(x, z, rot, 0, 0.35);
    b.beam(new Vector3(hx, y + 0.3, hz), new Vector3(hx + Math.cos(rot) * 0.6, y + 0.65, hz - Math.sin(rot) * 0.6), 0.07, bone);
    b.beam(new Vector3(hx, y + 0.3, hz), new Vector3(hx - Math.cos(rot) * 0.6, y + 0.65, hz + Math.sin(rot) * 0.6), 0.07, bone);
    for (let i = 0; i < 4; i++) {
      const [rx, rz] = this.loc(x, z, rot, -0.6 - i * 0.3, -0.3);
      b.beam(new Vector3(rx, y, rz), new Vector3(rx, y + 0.45, rz + 0.5), 0.05, bone);
    }
    this.occ.push({ x, z, r: 0.8 });
  }

  private fireBarrel(x: number, z: number) {
    const b = this.b;
    const y = this.ground(x, z);
    b.cyl(x, y + 0.48, z, 0.36, 0.36, 0.96, 10, this.o(this.pick(C.rust), MAT.RUST, 0, 0.18));
    b.cone(x, y + 1.2, z, 0.3, 0.7, 5, this.o(C.fire, MAT.FIRE, 3));
    b.cone(x + 0.08, y + 1.1, z + 0.05, 0.2, 0.5, 5, this.o(0xffd27a, MAT.FIRE, 3.5));
    this.colliders.addCircle(x, z, 0.4, 1);
    this.lights.push({ pos: new Vector3(x, y + 1.6, z), color: [1, 0.5, 0.18], intensity: 2.0, radius: 9, kind: 'fire', seed: this.rng.next() });
    this.occ.push({ x, z, r: 1 });
  }

  private toxicBarrel(x: number, z: number) {
    const b = this.b;
    const y = this.ground(x, z);
    const tipped = this.rng.chance(0.45);
    const rot = this.rng.range(0, Math.PI * 2);
    if (tipped) b.cyl(x, y + 0.36, z, 0.36, 0.36, 0.96, 10, this.o(0xb6c23a, MAT.TOXIC, 0.6, 0.12), { z: Math.PI / 2, y: rot });
    else b.cyl(x, y + 0.48, z, 0.36, 0.36, 0.96, 10, this.o(0xb6c23a, MAT.TOXIC, 0.6, 0.12));
    if (tipped) {
      const [px, pz] = this.loc(x, z, rot, 1.0, 0);
      b.cyl(px, this.ground(px, pz) + 0.03, pz, 0.9, 0.9, 0.05, 10, this.o(C.toxic, MAT.TOXIC, 1.2, 0.1));
    }
    this.colliders.addCircle(x, z, 0.4, 1);
    this.toxics.push({ x, z, r: 4.5 });
    this.lights.push({ pos: new Vector3(x, y + 0.8, z), color: [0.45, 1, 0.3], intensity: 0.9, radius: 5, kind: 'toxic', seed: this.rng.next() });
    this.occ.push({ x, z, r: 1 });
  }

  private debris(x: number, z: number) {
    const b = this.b;
    const rng = this.rng;
    const y = this.ground(x, z);
    const kind = rng.int(0, 3);
    if (kind === 0) {
      b.cyl(x, y + 0.13, z, 0.42, 0.42, 0.26, 10, this.o(0x2e2b29, MAT.STEEL), { x: rng.range(-0.2, 0.2) });
    } else if (kind === 1) {
      b.box(x, y + 0.3, z, 0.8, 0.6, 0.6, this.o(this.pick([0x6a5a3a, 0x5a6a4a, C.wood]), MAT.WOOD), { y: rng.range(0, 3) });
      this.colliders.addBox(x, z, 0.4, 0.3, 0, 0.6);
    } else if (kind === 2) {
      b.box(x, y + 0.04, z, rng.range(1, 2.4), 0.08, rng.range(0.6, 1.4), this.o(this.pick(C.rust), MAT.RUST, 0, 0.2), { y: rng.range(0, 3), z: rng.range(-0.1, 0.1) });
    } else {
      for (let i = 0; i < 3; i++) b.beam(new Vector3(x + rng.range(-0.6, 0.6), y, z + rng.range(-0.6, 0.6)), new Vector3(x + rng.range(-0.8, 0.8), y + rng.range(0.1, 0.5), z + rng.range(-0.8, 0.8)), 0.06, this.o(C.steel, MAT.STEEL));
    }
  }

  // ---------------------------------------------------------------- minimap
  /** Pre-render a minimap oriented like the isometric screen. */
  private buildMap(right: Vector3, up: Vector3) {
    const W = this.mapW;
    const H = this.mapH;
    const R = PLAY_R + 2;
    const rows: string[] = [];
    for (let j = 0; j < H; j++) {
      let row = '';
      for (let i = 0; i < W; i++) {
        const u = ((i + 0.5) / W - 0.5) * 2 * R;
        const v = (0.5 - (j + 0.5) / H) * 2 * R;
        const x = right.x * u + up.x * v;
        const z = right.z * u + up.z * v;
        if (Math.hypot(x, z) > R) {
          row += ' ';
          continue;
        }
        const h = this.heightAt(x, z);
        if (h < WATER_H + 0.02) row += '~';
        else if (this.roadInfo(x, z).d < 2.4) row += '=';
        else if (h > 4.5) row += '^';
        else row += (Math.floor(x * 0.5) + Math.floor(z * 0.5)) % 3 === 0 ? '·' : ' ';
      }
      rows.push(row);
    }
    this.mapBase = rows;
  }

  /** World -> minimap cell. */
  mapCell(x: number, z: number, right: Vector3, up: Vector3) {
    const R = PLAY_R + 2;
    const u = x * right.x + z * right.z;
    const v = x * up.x + z * up.z;
    return {
      i: Math.floor((u / (2 * R) + 0.5) * this.mapW),
      j: Math.floor((0.5 - v / (2 * R)) * this.mapH),
    };
  }
}
