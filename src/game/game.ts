import { Group, Mesh, Scene, ShaderMaterial, Vector2, Vector3, Vector4 } from 'three';
import type { AsciiRenderer } from '../engine/AsciiRenderer';
import { IsoCamera } from '../engine/IsoCamera';
import type { Input } from '../engine/input';
import type { Sfx } from '../engine/audio';
import type { RGB } from '../engine/overlay';
import { createGlobals, worldMaterial, WATER_H, MAX_LIGHTS } from '../engine/materials';
import { clamp, lerp, smoothstep, angleDiff, RNG, vnoise, TAU } from '../engine/math';
import { RIPPLE_N, DECAL_N } from '../engine/shaders';
import { World, PLAY_R } from './world';
import { Hud } from './hud';
import {
  playerModel,
  huskModel,
  houndModel,
  relayModel,
  pickupMesh,
  bulletMesh,
  beaconMesh,
  HumanoidModel,
  HoundModel,
  RelayModel,
  PickupKind,
} from './models';
import { LOGO, LOGO_WIDTH } from './logo';

export type State = 'title' | 'playing' | 'paused' | 'dead' | 'won';
type EnemyKind = 'hound' | 'husk';

const STORM_TOTAL = 540;
const UP = new Vector3(0, 1, 0);
const CALLSIGNS = ['ASH', 'KESTREL', 'SABLE', 'VESPER', 'JUNO', 'RUST', 'MOTH', 'ODA', 'SENNA', 'TALLOW'];

const STATS: Record<EnemyKind, { hp: number; run: number; walk: number; dmg: number; range: number; cd: number; windup: number; aggro: number; radius: number }> = {
  hound: { hp: 40, run: 6.3, walk: 1.8, dmg: 7, range: 1.3, cd: 0.9, windup: 0.24, aggro: 14, radius: 0.45 },
  husk: { hp: 95, run: 3.3, walk: 1.0, dmg: 14, range: 1.6, cd: 1.4, windup: 0.4, aggro: 11, radius: 0.5 },
};

const COL = {
  white: [0.95, 0.93, 0.86] as RGB,
  gold: [0.95, 0.78, 0.45] as RGB,
  cyan: [0.4, 0.93, 1.0] as RGB,
  red: [1.0, 0.33, 0.25] as RGB,
  blood: [0.62, 0.1, 0.07] as RGB,
  spark: [1.0, 0.8, 0.4] as RGB,
  dust: [0.62, 0.5, 0.36] as RGB,
  ember: [1.0, 0.55, 0.2] as RGB,
  green: [0.55, 1.0, 0.45] as RGB,
  dim: [0.55, 0.53, 0.48] as RGB,
};

interface Enemy {
  kind: EnemyKind;
  pos: Vector3;
  vel: Vector3;
  home: Vector3;
  roam: Vector3;
  roamT: number;
  facing: number;
  hp: number;
  maxHp: number;
  aggro: boolean;
  alertT: number;
  hitT: number;
  atkCd: number;
  windup: number;
  flash: number;
  dead: boolean;
  deadT: number;
  anim: number;
  rippleT: number;
  root: Group;
  mat: ShaderMaterial;
  husk?: HumanoidModel;
  hound?: HoundModel;
}

interface Bullet {
  pos: Vector3;
  dir: Vector3;
  speed: number;
  life: number;
  dmg: number;
  mesh: Mesh;
}

interface Pickup {
  kind: PickupKind;
  pos: Vector3;
  mesh: Mesh;
  t: number;
}

interface Particle {
  pos: Vector3;
  vel: Vector3;
  life: number;
  max: number;
  ch: string;
  col: RGB;
  grav: number;
}

interface FloatText {
  pos: Vector3;
  text: string;
  col: RGB;
  life: number;
  max: number;
}

interface Relay {
  pos: Vector3;
  active: boolean;
  progress: number;
  model: RelayModel;
  pulseT: number;
  idx: number;
}

const RELAY_LINES = [
  'Relay one is breathing. I can hear the basin again. Four to go.',
  'Two up. Something answered on the low band. Probably nothing. Probably.',
  'Three. The hounds are following the static now. Keep moving.',
  'Four relays. One more and the tower can sing.',
  'That is all five. Come home to Tower Nine and hold the key until the whole basin hears it.',
];

export class Game {
  readonly scene = new Scene();
  readonly worldRoot = new Group();
  readonly G = createGlobals();
  readonly cam = new IsoCamera(37, 45);
  readonly world: World;
  readonly hud = new Hud();
  state: State = 'title';
  time = 0;
  playT = 0;
  callsign = 'ASH';
  storm = 0;
  hurt = 0;
  fade = 0;
  mapOpen = false;
  onDensity: ((delta: number) => void) | null = null;

  private rng: RNG;
  private p = {
    pos: new Vector3(),
    vel: new Vector3(),
    facing: Math.PI,
    aim: new Vector3(0, 0, -1),
    hp: 100,
    maxHp: 100,
    rads: 0,
    stamina: 100,
    ammo: 36,
    scrap: 0,
    kills: 0,
    alive: true,
    fireCd: 0,
    meleeCd: 0,
    invuln: 0,
    inWater: false,
    stepAcc: 0,
    stepSide: 1,
    rippleT: 0,
    swingT: 0,
    recoil: 0,
    walked: 0,
    anim: 0,
    deadT: 0,
  };
  private pModel: HumanoidModel;
  private enemies: Enemy[] = [];
  private bullets: Bullet[] = [];
  private bulletPool: Mesh[] = [];
  private bulletMat: ShaderMaterial;
  private pickupMat: ShaderMaterial;
  private pickups: Pickup[] = [];
  private particles: Particle[] = [];
  private floats: FloatText[] = [];
  private relays: Relay[] = [];
  private relaysOn = 0;
  private beacon: Mesh;
  private beaconMat: ShaderMaterial;
  private ripples: Vector4[] = Array.from({ length: RIPPLE_N }, () => new Vector4());
  private rippleIdx = 0;
  private decals: Vector4[] = Array.from({ length: DECAL_N }, () => new Vector4());
  private footIdx = 0;
  private bloodIdx = 0;
  private wind = new Vector2(0.707, -0.707);
  private god = false;
  private sinceHurt = 99;
  private muzzle = 0;
  private muzzlePos = new Vector3();
  private flags = new Set<string>();
  private spawnT = 0;
  private transmit = 0;
  private transmitSpawn = 0;
  private endT = 0;
  private cause = '';
  private winPulse = 0;
  private lightCand: { x: number; y: number; z: number; r: number; c: RGB; i: number; d: number }[] = [];
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private proj = { x: 0, y: 0, z: 0 };

  constructor(
    readonly r: AsciiRenderer,
    readonly input: Input,
    readonly sfx: Sfx,
    readonly seed: number,
  ) {
    this.rng = new RNG(seed * 13 + 1);
    this.scene.add(this.worldRoot);
    this.world = new World(seed, this.G, this.cam.groundRight, this.cam.groundFwd);
    this.worldRoot.add(this.world.terrain, this.world.props);
    this.scene.add(this.world.water);

    this.pModel = playerModel(this.G);
    this.worldRoot.add(this.pModel.root);
    this.bulletMat = worldMaterial(this.G);
    this.pickupMat = worldMaterial(this.G);
    this.beaconMat = worldMaterial(this.G);
    this.beacon = beaconMesh(this.beaconMat);
    this.beacon.position.copy(this.world.towerTop);
    this.worldRoot.add(this.beacon);

    this.world.relays.forEach((pos, idx) => {
      const model = relayModel(this.G);
      model.root.position.copy(pos);
      model.root.rotation.y = this.rng.range(0, TAU);
      this.worldRoot.add(model.root);
      this.relays.push({ pos, active: false, progress: 0, model, pulseT: 99, idx });
    });

    try {
      const saved = localStorage.getItem('dust-signal-callsign');
      this.callsign = saved || this.rng.pick(CALLSIGNS);
    } catch {
      this.callsign = this.rng.pick(CALLSIGNS);
    }
    this.hud.onRadio = () => this.sfx.radio();
    this.resetRun();
    this.cam.focus.copy(this.world.campfire);
  }

  // ----------------------------------------------------------------- lifecycle
  private resetRun() {
    const p = this.p;
    p.pos.copy(this.world.spawn);
    p.vel.set(0, 0, 0);
    p.facing = Math.atan2(this.world.campfire.x - p.pos.x, this.world.campfire.z - p.pos.z);
    p.hp = 100;
    p.maxHp = 100;
    p.rads = 0;
    p.stamina = 100;
    p.ammo = 36;
    p.scrap = 0;
    p.kills = 0;
    p.alive = true;
    p.walked = 0;
    p.deadT = 0;
    this.pModel.root.rotation.set(0, p.facing, 0);
    this.pModel.mat.uniforms.uDissolve.value = 0;

    for (const e of this.enemies) this.worldRoot.remove(e.root);
    this.enemies = [];
    for (const b of this.bullets) this.recycleBullet(b);
    this.bullets = [];
    for (const k of this.pickups) this.worldRoot.remove(k.mesh);
    this.pickups = [];
    this.particles = [];
    this.floats = [];
    for (const r of this.relays) {
      r.active = false;
      r.progress = 0;
      r.pulseT = 99;
    }
    this.relaysOn = 0;
    this.playT = 0;
    this.storm = 0;
    this.transmit = 0;
    this.flags.clear();
    for (const d of this.decals) d.set(0, 0, 0, 0);
    for (const rp of this.ripples) rp.set(0, 0, 0, 0);
    this.endT = 0;
    this.winPulse = 0;

    // population
    for (let i = 0; i < 26; i++) {
      const pt = this.randomSpot(36, PLAY_R - 4, this.world.spawn);
      if (pt) this.spawnEnemy(this.rng.chance(0.6) ? 'hound' : 'husk', pt.x, pt.z);
    }
    const kinds: [PickupKind, number][] = [
      ['ammo', 16],
      ['med', 9],
      ['iodine', 7],
      ['scrap', 34],
    ];
    for (const [kind, n] of kinds) {
      for (let i = 0; i < n; i++) {
        let pt: Vector3 | null = null;
        if (kind === 'iodine') {
          const l = this.rng.pick(this.world.lakes);
          const a = this.rng.range(0, TAU);
          pt = this.validSpot(l.x + Math.cos(a) * l.r * 1.5, l.z + Math.sin(a) * l.r * 1.5);
        } else if (kind === 'ammo' && i < this.world.relays.length) {
          const rl = this.world.relays[i];
          pt = this.validSpot(rl.x + this.rng.range(-4, 4), rl.z + this.rng.range(-4, 4));
        }
        pt = pt ?? this.randomSpot(6, PLAY_R - 4, this.world.spawn);
        if (pt) this.spawnPickup(kind, pt.x, pt.z);
      }
    }
    this.spawnPickup('ammo', this.world.spawn.x + 1.6, this.world.spawn.z - 1.4);
  }

  start() {
    const el = document.getElementById('callsign') as HTMLInputElement | null;
    const v = (el?.value || '').trim().toUpperCase().replace(/[^A-Z0-9 _-]/g, '');
    if (v) this.callsign = v.slice(0, 12);
    try {
      localStorage.setItem('dust-signal-callsign', this.callsign);
    } catch {
      /* private mode */
    }
    el?.blur();
    this.sfx.init();
    if (this.state !== 'title') this.resetRun();
    this.state = 'playing';
    this.screen(null);
    this.hud.show(true);
    this.hud.fadeKeys(false);
    this.hud.clearRadio();
    this.hud.radio('TOWER NINE', `…kzzt… anyone on the dust band? ${this.callsign}, is that you? Five relays went dark when the ash came. Wake them and I can throw one signal past the storm wall.`);
    this.hud.radio('TOWER NINE', 'Nearest relay is on your compass. Hold E on the housing. The things out there love noise, so keep the rifle warm.');
  }

  restart() {
    this.resetRun();
    this.start();
  }

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.screen('pause');
      this.sfx.hum(0);
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.screen(null);
    }
  }

  private screen(name: 'title' | 'pause' | 'end' | null) {
    for (const id of ['title', 'pause', 'end']) document.getElementById(id)?.classList.toggle('hidden', id !== name);
  }

  // ------------------------------------------------------------------- spawns
  private validSpot(x: number, z: number): Vector3 | null {
    if (Math.hypot(x, z) > PLAY_R - 3) return null;
    if (this.world.isWater(x, z)) return null;
    if (this.world.colliders.query(x, z, 1.2).length > 0) {
      const t = new Vector3(x, 0, z);
      if (this.world.colliders.resolve(t, 0.6)) {
        if (this.world.colliders.resolve(t.clone(), 0.6)) return null;
        x = t.x;
        z = t.z;
      }
    }
    return new Vector3(x, this.world.heightAt(x, z), z);
  }

  private randomSpot(minD: number, maxD: number, from: Vector3): Vector3 | null {
    for (let i = 0; i < 30; i++) {
      const a = this.rng.range(0, TAU);
      const d = this.rng.range(minD, maxD);
      const x = from.x + Math.cos(a) * d;
      const z = from.z + Math.sin(a) * d;
      const v = this.validSpot(x, z);
      if (v) return v;
    }
    return null;
  }

  private spawnEnemy(kind: EnemyKind, x: number, z: number, aggro = false): Enemy {
    const s = STATS[kind];
    const seed = this.rng.int(1, 9999);
    const e: Enemy = {
      kind,
      pos: new Vector3(x, this.world.heightAt(x, z), z),
      vel: new Vector3(),
      home: new Vector3(x, 0, z),
      roam: new Vector3(x, 0, z),
      roamT: 0,
      facing: this.rng.range(0, TAU),
      hp: s.hp,
      maxHp: s.hp,
      aggro,
      alertT: aggro ? 0.8 : 0,
      hitT: 0,
      atkCd: 1,
      windup: 0,
      flash: 0,
      dead: false,
      deadT: 0,
      anim: this.rng.range(0, 10),
      rippleT: 0,
      root: new Group(),
      mat: null as unknown as ShaderMaterial,
    };
    if (kind === 'hound') {
      e.hound = houndModel(this.G, seed);
      e.root = e.hound.root;
      e.mat = e.hound.mat;
    } else {
      e.husk = huskModel(this.G, seed);
      e.root = e.husk.root;
      e.mat = e.husk.mat;
      e.root.scale.setScalar(this.rng.range(0.95, 1.15));
    }
    e.root.position.copy(e.pos);
    this.worldRoot.add(e.root);
    this.enemies.push(e);
    return e;
  }

  private spawnPickup(kind: PickupKind, x: number, z: number) {
    const mesh = pickupMesh(this.pickupMat, kind);
    const pos = new Vector3(x, this.world.heightAt(x, z), z);
    mesh.position.copy(pos);
    this.worldRoot.add(mesh);
    this.pickups.push({ kind, pos, mesh, t: this.rng.range(0, 10) });
  }

  private spawnBullet(origin: Vector3, dir: Vector3, speed: number, dmg: number) {
    // Tracers are drawn as glyph streaks in the overlay; the mesh only shows up in water reflections.
    const mesh = this.bulletPool.pop() ?? bulletMesh(this.bulletMat);
    mesh.position.copy(origin);
    mesh.rotation.set(0, Math.atan2(dir.x, dir.z), 0);
    mesh.visible = false;
    if (!mesh.parent) this.worldRoot.add(mesh);
    this.bullets.push({ pos: origin.clone(), dir: dir.clone(), speed, life: 0.7, dmg, mesh });
  }

  private recycleBullet(b: Bullet) {
    b.mesh.visible = false;
    this.bulletPool.push(b.mesh);
  }

  private burst(pos: Vector3, n: number, chars: string, col: RGB, speed: number, up: number, life: number, grav = 9) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({
        pos: pos.clone(),
        vel: new Vector3(Math.cos(a) * s, up * (0.4 + Math.random() * 0.8), Math.sin(a) * s),
        life: life * (0.6 + Math.random() * 0.6),
        max: life,
        ch: chars[Math.floor(Math.random() * chars.length)],
        col,
        grav,
      });
    }
  }

  private floatText(pos: Vector3, text: string, col: RGB) {
    this.floats.push({ pos: pos.clone(), text, col, life: 0.9, max: 0.9 });
  }

  private ripple(x: number, z: number, strength = 1) {
    this.ripples[this.rippleIdx].set(x, z, this.time, strength);
    this.rippleIdx = (this.rippleIdx + 1) % RIPPLE_N;
  }

  private footprint(x: number, z: number) {
    this.decals[this.footIdx].set(x, z, 0, 1);
    this.footIdx = (this.footIdx + 1) % 30;
  }

  private bloodDecal(x: number, z: number, size: number) {
    this.decals[30 + this.bloodIdx].set(x, z, 1, size);
    this.bloodIdx = (this.bloodIdx + 1) % (DECAL_N - 30);
  }

  private once(flag: string) {
    if (this.flags.has(flag)) return false;
    this.flags.add(flag);
    return true;
  }

  // -------------------------------------------------------------------- update
  update(dt: number) {
    this.time += dt;
    this.input.tick(this.time);
    const inp = this.input;

    if (inp.wasPressed('BracketLeft')) this.onDensity?.(-1);
    if (inp.wasPressed('BracketRight')) this.onDensity?.(1);
    if (inp.wasPressed('KeyN')) {
      this.sfx.setMuted(!this.sfx.muted);
      this.setText('p-sound', this.sfx.muted ? 'OFF' : 'ON');
    }
    if (inp.wasPressed('KeyG')) {
      this.r.shapeAmt = this.r.shapeAmt > 0 ? 0 : 1;
      this.setText('p-shape', this.r.shapeAmt > 0 ? 'ON' : 'OFF');
    }
    if (inp.wheel) this.cam.zoom(inp.wheel * 0.08);

    switch (this.state) {
      case 'title':
        if (inp.wasPressed('Enter', 'NumpadEnter')) this.start();
        this.fade = Math.min(1, this.fade + dt * 0.6);
        this.animatePlayer(dt);
        this.updatePickups(dt);
        this.updateParticles(dt);
        this.updateAmbient(dt);
        break;
      case 'playing':
        if (inp.wasPressed('Escape', 'KeyP')) this.togglePause();
        else this.simulate(dt);
        if (inp.wasPressed('KeyM', 'Tab')) this.mapOpen = !this.mapOpen;
        break;
      case 'paused':
        if (inp.wasPressed('Escape', 'KeyP')) this.togglePause();
        if (inp.wasPressed('KeyR')) this.restart();
        break;
      case 'dead':
      case 'won':
        this.endT += dt;
        this.simulateWorld(dt);
        if (this.endT > 1.2 && inp.wasPressed('Enter', 'NumpadEnter', 'Space')) this.restart();
        break;
    }
    if (this.state !== 'playing') this.mapOpen = false;
    if (document.body.dataset.state !== this.state) document.body.dataset.state = this.state;

    this.hurt = Math.max(0, this.hurt - dt * 2.2);
    this.updateCamera(dt);
    this.updateGlobals();
    this.drawOverlay();
    this.updateHud(dt);
    this.updateMap();
    const geiger = this.state === 'playing' ? this.world.radAt(this.p.pos.x, this.p.pos.z) * 1.6 : 0;
    this.sfx.update(this.time, this.storm, geiger, dt);
    inp.endFrame();
  }

  private setText(id: string, v: string) {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  }

  private simulate(dt: number) {
    this.playT += dt;
    this.updateStorm(dt);
    this.updatePlayer(dt);
    this.simulateWorld(dt);
    this.updateRelays(dt);
    this.updateSpawner(dt);
    this.updateRadioScript();
  }

  /** Things that keep moving even after death / victory. */
  private simulateWorld(dt: number) {
    this.updateEnemies(dt);
    this.updateBullets(dt);
    this.updatePickups(dt);
    this.updateParticles(dt);
    this.updateAmbient(dt);
    this.animatePlayer(dt);
    if (this.state === 'dead' || this.state === 'won') {
      this.winPulse += dt;
      if (this.endT > (this.state === 'won' ? 2.4 : 1.6) && document.getElementById('end')?.classList.contains('hidden')) this.showEnd();
    }
  }

  private updateStorm(dt: number) {
    const t = this.playT;
    const left = STORM_TOTAL - t;
    let level = Math.pow(smoothstep(30, STORM_TOTAL - 15, t), 1.25) * 0.85;
    if (left <= 0) level = 1;
    const gust = level * 0.18 * Math.max(0, Math.sin(t * 0.31) * Math.sin(t * 0.11 + 2));
    this.storm = clamp(level + gust, 0, 1);
    // mostly blowing across the screen (west to east along the iso view)
    const a = -0.785 + Math.sin(t * 0.04) * 0.3;
    this.wind.set(Math.cos(a), Math.sin(a));
    if (left <= 0 && this.p.alive) {
      this.p.hp -= dt * 3;
      this.hurt = Math.max(this.hurt, 0.25);
      if (this.p.hp <= 0) this.die('THE STORM WALL');
    }
  }

  // -------------------------------------------------------------------- player
  private aimDirection(out: Vector3): Vector3 {
    const p = this.p;
    const inp = this.input;
    if (inp.usingMouseAim()) {
      const r = this.r;
      const gx = inp.mouseX * r.dpr + (r.cols * r.cellPxW - r.viewW) / 2;
      const gy = (r.viewH / r.dpr - inp.mouseY) * r.dpr + (r.rows * r.cellPxH - r.viewH) / 2;
      const nx = (gx / (r.cols * r.cellPxW)) * 2 - 1;
      const ny = (gy / (r.rows * r.cellPxH)) * 2 - 1;
      this.cam.ndcToGround(nx, ny, p.pos.y + 1.1, this.tmp2);
      out.set(this.tmp2.x - p.pos.x, 0, this.tmp2.z - p.pos.z);
      if (out.lengthSq() > 0.01) return out.normalize();
    }
    out.set(Math.sin(p.facing), 0, Math.cos(p.facing));
    // aim assist toward the closest enemy in a forward cone
    let best: Enemy | null = null;
    let bestScore = 1e9;
    const touch = inp.touch.active;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.pos.x - p.pos.x;
      const dz = e.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 22) continue;
      const ang = Math.abs(angleDiff(p.facing, Math.atan2(dx, dz)));
      if (ang > (touch ? Math.PI : 0.5)) continue;
      const score = d + ang * 12;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (best) out.set(best.pos.x - p.pos.x, 0, best.pos.z - p.pos.z).normalize();
    return out;
  }

  private updatePlayer(dt: number) {
    const p = this.p;
    const inp = this.input;
    if (!p.alive) return;
    p.fireCd -= dt;
    p.meleeCd -= dt;
    p.invuln -= dt;
    p.swingT = Math.max(0, p.swingT - dt);
    p.recoil = Math.max(0, p.recoil - dt * 8);

    const [mx, my] = inp.move();
    const wish = this.tmp.set(0, 0, 0).addScaledVector(this.cam.groundRight, mx).addScaledVector(this.cam.groundFwd, my);
    const moving = wish.lengthSq() > 0.01;
    const wantRun = inp.isDown('ShiftLeft', 'ShiftRight') || inp.touch.run;
    const running = wantRun && moving && p.stamina > 1;
    p.stamina = clamp(p.stamina + (running ? -24 : 16) * dt, 0, 100);
    let speed = running ? 8.2 : 4.9;
    if (p.inWater) speed *= 0.6;
    const k = 1 - Math.exp(-12 * dt);
    p.vel.x += (wish.x * speed - p.vel.x) * k;
    p.vel.z += (wish.z * speed - p.vel.z) * k;
    const ox = p.pos.x;
    const oz = p.pos.z;
    p.pos.x += p.vel.x * dt;
    p.pos.z += p.vel.z * dt;
    this.world.colliders.resolve(p.pos, 0.38);
    const R = Math.hypot(p.pos.x, p.pos.z);
    if (R > PLAY_R) {
      p.pos.x *= PLAY_R / R;
      p.pos.z *= PLAY_R / R;
    }
    const g = this.world.heightAt(p.pos.x, p.pos.z);
    p.pos.y = g;
    const wasWater = p.inWater;
    p.inWater = g < WATER_H - 0.05;
    if (p.inWater && !wasWater) {
      this.ripple(p.pos.x, p.pos.z, 1.2);
      this.sfx.step(true);
    }
    const moved = Math.hypot(p.pos.x - ox, p.pos.z - oz);
    p.walked += moved;
    p.anim += moved * 3.2;

    // footsteps, footprints and ripples
    p.stepAcc += moved;
    if (p.stepAcc > 0.75) {
      p.stepAcc = 0;
      p.stepSide *= -1;
      const sx = Math.cos(p.facing) * 0.13 * p.stepSide;
      const sz = -Math.sin(p.facing) * 0.13 * p.stepSide;
      if (!p.inWater) {
        this.footprint(p.pos.x + sx, p.pos.z + sz);
        if (running || Math.random() < 0.3) this.burst(new Vector3(p.pos.x, g + 0.1, p.pos.z), 2, '.,·', COL.dust, 1.2, 1.2, 0.5);
      }
      this.sfx.step(p.inWater);
    }
    if (p.inWater && moved > 0.001) {
      p.rippleT -= dt;
      if (p.rippleT <= 0) {
        p.rippleT = 0.32;
        this.ripple(p.pos.x, p.pos.z, 0.9);
      }
    }

    // aim and facing
    const aim = this.aimDirection(p.aim);
    const firing = inp.isDown('Space') || inp.mouseDown || inp.touch.fire;
    if (inp.usingMouseAim() || firing) p.facing = Math.atan2(aim.x, aim.z);
    else if (moving) p.facing += angleDiff(p.facing, Math.atan2(wish.x, wish.z)) * Math.min(1, dt * 14);

    if (firing && p.fireCd <= 0) {
      if (p.ammo > 0) this.fire(aim);
      else this.melee(aim);
    }

    // slow recovery when out of combat
    this.sinceHurt += dt;
    if (this.sinceHurt > 6 && p.hp < p.maxHp * 0.7) p.hp = Math.min(p.maxHp * 0.7, p.hp + dt * 1.5);

    // radiation
    const dose = this.world.radAt(p.pos.x, p.pos.z);
    p.rads = clamp(p.rads + dose * dt - 0.15 * dt, 0, 100);
    p.maxHp = clamp(100 - p.rads * 0.55, 40, 100);
    if (p.hp > p.maxHp) p.hp = Math.max(p.maxHp, p.hp - dt * 6);
    if (p.rads >= 99) {
      p.hp -= dt * 2;
      if (p.hp <= 0) this.die('RADIATION');
    }
    if (dose > 3 && this.once('water')) this.hud.radio('TOWER NINE', 'Get out of the green water. That geiger clicking is not decoration.');
    if (p.hp < 35 && this.once('lowhp')) this.hud.radio('TOWER NINE', `You sound bad, ${this.callsign}. Medkits are the white boxes with the red cross. Do not be proud.`);
  }

  private fire(dir: Vector3) {
    const p = this.p;
    p.ammo--;
    p.fireCd = 0.16;
    p.recoil = 1;
    const d = dir.clone().applyAxisAngle(UP, (Math.random() - 0.5) * 0.05).normalize();
    p.facing = Math.atan2(d.x, d.z);
    const origin = p.pos.clone().addScaledVector(d, 0.85);
    origin.y += 1.1;
    this.spawnBullet(origin, d, 48, 30 + Math.random() * 10);
    this.muzzle = 0.07;
    this.muzzlePos.copy(origin);
    this.burst(origin, 3, '*+\'', COL.spark, 3, 1, 0.18, 0);
    this.cam.addShake(0.35);
    this.sfx.shot();
    for (const e of this.enemies) if (!e.dead && !e.aggro && e.pos.distanceTo(p.pos) < 26) this.alert(e);
    if (p.ammo === 0 && this.once('empty')) this.hud.radio('TOWER NINE', 'Out of rounds? The pipe on your back still works. Get close and swing.');
  }

  private melee(dir: Vector3) {
    const p = this.p;
    if (p.meleeCd > 0) return;
    p.meleeCd = 0.5;
    p.fireCd = 0.5;
    p.swingT = 0.25;
    this.sfx.swing();
    const fx = p.pos.x + dir.x * 1.2;
    const fz = p.pos.z + dir.z * 1.2;
    this.burst(new Vector3(fx, p.pos.y + 1, fz), 3, '-~', COL.white, 2, 0.5, 0.2, 0);
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.pos.x - p.pos.x;
      const dz = e.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.2) continue;
      if (Math.abs(angleDiff(Math.atan2(dir.x, dir.z), Math.atan2(dx, dz))) > 1.2) continue;
      this.damageEnemy(e, 26, this.tmp2.set(dx, 0, dz).normalize());
    }
  }

  private die(cause: string) {
    const p = this.p;
    if (!p.alive) return;
    p.alive = false;
    p.hp = 0;
    this.cause = cause;
    this.state = 'dead';
    this.endT = 0;
    this.sfx.death();
    this.sfx.hum(0);
    this.cam.addShake(1.5);
    this.burst(p.pos.clone().setY(p.pos.y + 1), 14, ';,.', COL.blood, 3, 3, 1);
    this.bloodDecal(p.pos.x, p.pos.z, 2);
  }

  private hurtPlayer(dmg: number, from: Vector3, cause: string) {
    const p = this.p;
    if (!p.alive || p.invuln > 0) return;
    this.sinceHurt = 0;
    if (!this.god) p.hp -= dmg;
    p.invuln = 0.25;
    this.hurt = 1;
    this.cam.addShake(0.9);
    this.sfx.hurt();
    const away = this.tmp2.set(p.pos.x - from.x, 0, p.pos.z - from.z).normalize();
    p.vel.addScaledVector(away, 6);
    this.burst(p.pos.clone().setY(p.pos.y + 1.2), 6, ';,.\'', COL.blood, 2.5, 2.5, 0.6);
    this.floatText(p.pos.clone().setY(p.pos.y + 2.2), `-${Math.round(dmg)}`, COL.red);
    if (p.hp <= 0) this.die(cause);
  }

  private animatePlayer(dt: number) {
    const p = this.p;
    const m = this.pModel;
    m.root.position.copy(p.pos);
    if (p.inWater) m.root.position.y = Math.max(p.pos.y, WATER_H - 0.55);
    if (!p.alive) {
      p.deadT += dt;
      m.root.rotation.z = Math.min(Math.PI / 2, p.deadT * 4) * 0.95;
      m.root.position.y -= Math.min(0.3, p.deadT * 0.3);
      return;
    }
    m.root.rotation.set(0, p.facing, 0);
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const sw = Math.sin(p.anim) * Math.min(1, speed / 4) * 0.7;
    m.legL.rotation.x = sw;
    m.legR.rotation.x = -sw;
    m.body.position.y = Math.abs(Math.sin(p.anim)) * 0.04 * Math.min(1, speed / 3);
    m.body.position.z = -p.recoil * 0.06;
    m.armR.rotation.x = p.swingT > 0 ? -2.4 + (0.25 - p.swingT) * 12 : -1.1 - p.recoil * 0.3;
    m.armL.rotation.x = -0.9 - p.recoil * 0.2;
    m.mat.uniforms.uFlash.value = p.invuln > 0.12 ? 0.6 : 0;
    if (m.tip) (m.tip.material as ShaderMaterial).uniforms.uEmitBoost.value = 0.6 + 0.8 * (Math.sin(this.time * 6) > 0.6 ? 1 : 0);
  }

  // ------------------------------------------------------------------- enemies
  private alert(e: Enemy) {
    if (e.aggro || e.dead) return;
    e.aggro = true;
    e.alertT = 0.9;
    if (Math.random() < 0.6) this.sfx.growl(e.kind === 'hound' ? 1.4 : 0.8);
  }

  private damageEnemy(e: Enemy, dmg: number, dir: Vector3) {
    if (e.dead) return;
    e.hp -= dmg;
    e.flash = 0.12;
    e.hitT = 2;
    e.vel.addScaledVector(dir, e.kind === 'hound' ? 6 : 2.5);
    this.alert(e);
    const at = e.pos.clone().setY(e.pos.y + (e.kind === 'hound' ? 0.8 : 1.3));
    this.burst(at, 5, ';,.', COL.blood, 2.5, 2, 0.55);
    this.floatText(at.setY(at.y + 0.9), `${Math.round(dmg)}`, COL.gold);
    this.sfx.hit();
    if (e.hp <= 0) this.killEnemy(e);
  }

  private killEnemy(e: Enemy) {
    e.dead = true;
    e.deadT = 0;
    this.p.kills++;
    this.sfx.kill();
    this.bloodDecal(e.pos.x, e.pos.z, e.kind === 'hound' ? 1 : 1.6);
    this.burst(e.pos.clone().setY(e.pos.y + 0.8), 10, ';,.:', COL.blood, 3, 3, 0.8);
    const roll = Math.random();
    if (roll < 0.3) this.spawnPickup('ammo', e.pos.x, e.pos.z);
    else if (roll < 0.4) this.spawnPickup('med', e.pos.x, e.pos.z);
    else if (roll < 0.75) this.spawnPickup('scrap', e.pos.x, e.pos.z);
    if (this.once('firstkill')) this.hud.radio('TOWER NINE', 'Heard that. Good. They come in packs when the static rises, so watch your back.');
  }

  private updateEnemies(dt: number) {
    const p = this.p;
    const diff = 1 + this.relaysOn * 0.05 + this.storm * 0.12;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const s = STATS[e.kind];
      e.flash = Math.max(0, e.flash - dt);
      e.hitT = Math.max(0, e.hitT - dt);
      e.alertT = Math.max(0, e.alertT - dt);
      e.mat.uniforms.uFlash.value = e.flash > 0 ? 0.85 : 0;
      if (e.dead) {
        e.deadT += dt;
        e.root.rotation.z = Math.min(Math.PI / 2, e.deadT * 5);
        e.root.position.y = e.pos.y - Math.max(0, e.deadT - 1.5) * 0.4;
        e.mat.uniforms.uDissolve.value = smoothstep(1.2, 3.2, e.deadT);
        if (e.deadT > 3.4) {
          this.worldRoot.remove(e.root);
          this.enemies.splice(i, 1);
        }
        continue;
      }
      const dx = p.pos.x - e.pos.x;
      const dz = p.pos.z - e.pos.z;
      const d = Math.hypot(dx, dz);
      const canSee = p.alive && this.state === 'playing';
      if (!e.aggro && canSee && d < s.aggro * (1 - this.storm * 0.25)) this.alert(e);
      if (e.aggro && (d > 42 || !p.alive)) e.aggro = false;

      let tx = 0;
      let tz = 0;
      let spd = s.walk;
      if (e.aggro) {
        tx = dx / (d || 1);
        tz = dz / (d || 1);
        spd = s.run * diff;
        if (e.kind === 'hound' && e.atkCd > 0.2 && d < 4) {
          // circle while the bite recharges
          const side = e.anim % 2 > 1 ? 1 : -1;
          tx = tx * 0.2 - tz * side;
          tz = tz * 0.2 + (dx / (d || 1)) * side;
        }
        if (d < s.range * 0.8) spd = 0.5;
      } else {
        e.roamT -= dt;
        if (e.roamT <= 0 || Math.hypot(e.roam.x - e.pos.x, e.roam.z - e.pos.z) < 1) {
          e.roamT = this.rng.range(3, 8);
          const a = this.rng.range(0, TAU);
          e.roam.set(e.home.x + Math.cos(a) * 10, 0, e.home.z + Math.sin(a) * 10);
        }
        const rx = e.roam.x - e.pos.x;
        const rz = e.roam.z - e.pos.z;
        const rl = Math.hypot(rx, rz) || 1;
        tx = rx / rl;
        tz = rz / rl;
        if (e.roamT > 5) spd = 0;
      }
      // separation
      for (const o of this.enemies) {
        if (o === e || o.dead) continue;
        const sx = e.pos.x - o.pos.x;
        const sz = e.pos.z - o.pos.z;
        const sd = sx * sx + sz * sz;
        if (sd < 1.6 && sd > 1e-4) {
          const f = (1.6 - sd) / 1.6;
          tx += (sx / Math.sqrt(sd)) * f * 1.5;
          tz += (sz / Math.sqrt(sd)) * f * 1.5;
        }
      }
      const inWater = this.world.isWater(e.pos.x, e.pos.z);
      if (inWater) spd *= 0.6;
      const k = 1 - Math.exp(-8 * dt);
      e.vel.x += (tx * spd - e.vel.x) * k;
      e.vel.z += (tz * spd - e.vel.z) * k;
      e.pos.x += e.vel.x * dt;
      e.pos.z += e.vel.z * dt;
      this.world.colliders.resolve(e.pos, s.radius);
      const R = Math.hypot(e.pos.x, e.pos.z);
      if (R > PLAY_R) {
        e.pos.x *= PLAY_R / R;
        e.pos.z *= PLAY_R / R;
      }
      e.pos.y = this.world.heightAt(e.pos.x, e.pos.z);
      const v = Math.hypot(e.vel.x, e.vel.z);
      if (e.aggro) e.facing += angleDiff(e.facing, Math.atan2(dx, dz)) * Math.min(1, dt * 10);
      else if (v > 0.2) e.facing += angleDiff(e.facing, Math.atan2(e.vel.x, e.vel.z)) * Math.min(1, dt * 6);
      e.anim += v * dt * (e.kind === 'hound' ? 2.6 : 3.2);
      if (inWater && v > 0.5) {
        e.rippleT -= dt;
        if (e.rippleT <= 0) {
          e.rippleT = 0.45;
          this.ripple(e.pos.x, e.pos.z, 0.6);
        }
      }

      // attack
      e.atkCd -= dt;
      if (e.windup > 0) {
        e.windup -= dt;
        if (e.windup <= 0) {
          e.atkCd = s.cd;
          if (d < s.range + 0.5 && p.alive) this.hurtPlayer(s.dmg * (0.9 + Math.random() * 0.2), e.pos, e.kind === 'hound' ? 'A ROT HOUND' : 'A HUSK');
        }
      } else if (e.aggro && d < s.range && e.atkCd <= 0 && p.alive) {
        e.windup = s.windup;
      }

      // pose
      e.root.position.copy(e.pos);
      e.root.rotation.set(0, e.facing, 0);
      const lunge = e.windup > 0 ? 1 - e.windup / s.windup : 0;
      if (e.hound) {
        const sw = Math.sin(e.anim * 2.2) * Math.min(1, v / 3) * 0.8;
        e.hound.legs[0].rotation.x = sw;
        e.hound.legs[3].rotation.x = sw;
        e.hound.legs[1].rotation.x = -sw;
        e.hound.legs[2].rotation.x = -sw;
        e.hound.body.position.z = lunge * 0.45;
        e.hound.body.rotation.x = -lunge * 0.25 + Math.sin(e.anim * 4.4) * 0.03;
      } else if (e.husk) {
        const sw = Math.sin(e.anim * 2) * Math.min(1, v / 2) * 0.6;
        e.husk.legL.rotation.x = sw;
        e.husk.legR.rotation.x = -sw;
        e.husk.armL.rotation.x = e.aggro ? -1.2 - lunge * 1.2 : -sw * 0.5;
        e.husk.armR.rotation.x = e.aggro ? -1.0 - lunge * 1.4 : sw * 0.5;
        e.husk.body.rotation.x = lunge * 0.3;
      }

      // despawn calm, far away enemies so the spawner can recycle them near the action
      if (!e.aggro && d > 75) {
        this.worldRoot.remove(e.root);
        this.enemies.splice(i, 1);
      }
    }
  }

  private updateSpawner(dt: number) {
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    this.spawnT = 3.5;
    const alive = this.enemies.filter((e) => !e.dead).length;
    const target = Math.min(42, 18 + this.relaysOn * 3 + Math.floor(this.storm * 12));
    if (alive >= target) return;
    const pt = this.randomSpot(30, 44, this.p.pos);
    if (pt) this.spawnEnemy(this.rng.chance(0.6) ? 'hound' : 'husk', pt.x, pt.z, this.storm > 0.6 && this.rng.chance(0.4));
  }

  private spawnWave(n: number, minD = 18, maxD = 26) {
    for (let i = 0; i < n; i++) {
      const pt = this.randomSpot(minD, maxD, this.p.pos);
      if (pt) this.spawnEnemy(this.rng.chance(0.7) ? 'hound' : 'husk', pt.x, pt.z, true);
    }
  }

  // ------------------------------------------------------------------- bullets
  private updateBullets(dt: number) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      let dead = b.life <= 0;
      const total = b.speed * dt;
      const steps = Math.max(1, Math.ceil(total / 0.3));
      for (let s = 0; s < steps && !dead; s++) {
        b.pos.addScaledVector(b.dir, total / steps);
        for (const e of this.enemies) {
          if (e.dead) continue;
          const rad = e.kind === 'hound' ? 0.6 : 0.65;
          const dx = b.pos.x - e.pos.x;
          const dz = b.pos.z - e.pos.z;
          if (dx * dx + dz * dz < rad * rad && b.pos.y < e.pos.y + 2.1) {
            this.damageEnemy(e, b.dmg, b.dir);
            dead = true;
            break;
          }
        }
        if (dead) break;
        const g = this.world.heightAt(b.pos.x, b.pos.z);
        if (b.pos.y < g) {
          if (g < WATER_H + 0.05) this.ripple(b.pos.x, b.pos.z, 0.7);
          else this.burst(b.pos, 3, '.,·', COL.dust, 1.5, 1.5, 0.4);
          dead = true;
        } else if (this.world.colliders.blocked(b.pos.x, b.pos.y, b.pos.z, g)) {
          this.burst(b.pos.clone().addScaledVector(b.dir, -0.2), 4, '*+.\'', COL.spark, 3, 2, 0.35);
          dead = true;
        }
      }
      b.mesh.position.copy(b.pos);
      if (dead) {
        this.recycleBullet(b);
        this.bullets.splice(i, 1);
      }
    }
    this.muzzle = Math.max(0, this.muzzle - dt);
  }

  // ------------------------------------------------------------------- pickups
  private updatePickups(dt: number) {
    const p = this.p;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      k.t += dt;
      k.mesh.position.set(k.pos.x, k.pos.y + 0.12 + Math.sin(k.t * 2.4) * 0.08, k.pos.z);
      k.mesh.rotation.y = k.t * 1.3;
      if (!p.alive || this.state !== 'playing') continue;
      if (Math.hypot(k.pos.x - p.pos.x, k.pos.z - p.pos.z) > 1.15) continue;
      let label = '';
      if (k.kind === 'ammo') {
        if (p.ammo >= 90) continue;
        const n = 12 + Math.floor(Math.random() * 7);
        p.ammo = Math.min(90, p.ammo + n);
        label = `+${n} ROUNDS`;
      } else if (k.kind === 'med') {
        if (p.hp >= p.maxHp - 1) continue;
        p.hp = Math.min(p.maxHp, p.hp + 40);
        label = '+40 HP';
      } else if (k.kind === 'iodine') {
        p.rads = Math.max(0, p.rads - 35);
        label = '-35 RAD';
      } else {
        const n = 1 + Math.floor(Math.random() * 3);
        p.scrap += n;
        label = `+${n} SCRAP`;
      }
      this.floatText(k.pos.clone().setY(k.pos.y + 1.2), label, k.kind === 'iodine' ? COL.green : COL.gold);
      this.burst(k.pos.clone().setY(k.pos.y + 0.4), 5, '+*·', COL.gold, 1.5, 2, 0.5, 2);
      this.sfx.pickup();
      this.worldRoot.remove(k.mesh);
      this.pickups.splice(i, 1);
    }
  }

  // -------------------------------------------------------------------- relays
  private interactHeld() {
    return this.input.isDown('KeyE', 'Enter') || this.input.touch.use;
  }

  private updateRelays(dt: number) {
    const p = this.p;
    let near: Relay | null = null;
    for (const r of this.relays) {
      r.pulseT += dt;
      const m = r.model;
      if (r.active) {
        m.dish.rotation.y += dt * 0.9;
        m.lightMat.uniforms.uEmitBoost.value = 1.5 + Math.sin(this.time * 5 + r.idx) * 0.6;
        m.lightMat.uniforms.uTint.value.set(1, 1, 1);
        if (r.pulseT > 4.5) r.pulseT = 0;
      } else {
        const blink = Math.sin(this.time * 2.2 + r.idx * 1.7) > 0.7 ? 1 : 0.15;
        m.lightMat.uniforms.uEmitBoost.value = 0.35 + blink * 0.9 + r.progress * 2;
        const k = r.progress;
        m.lightMat.uniforms.uTint.value.set(lerp(2.4, 1, k), lerp(0.38, 1, k), lerp(0.26, 1, k));
        const d = Math.hypot(r.pos.x - p.pos.x, r.pos.z - p.pos.z);
        if (d < 3.4 && p.alive) near = r;
      }
    }

    let working = 0;
    for (const r of this.relays) {
      if (r.active) continue;
      if (r === near && this.interactHeld()) {
        r.progress = Math.min(1, r.progress + dt / 2.4);
        working = r.progress;
        if (Math.random() < dt * 14) this.burst(r.pos.clone().setY(r.pos.y + 2.8), 1, '+*\'·', COL.cyan, 2, 2, 0.4, 1);
        if (r.progress >= 1) this.activateRelay(r);
      } else {
        r.progress = Math.max(0, r.progress - dt * 0.6);
      }
    }

    // the tower
    const hut = this.towerHut();
    const atTower = this.relaysOn >= 5 && Math.hypot(hut.x - p.pos.x, hut.z - p.pos.z) < 5.5 && p.alive;
    if (atTower && this.interactHeld()) {
      if (this.transmit === 0) this.hud.radio('TOWER NINE', 'Keying the tower… hold it, hold it, do not let go…', true);
      this.transmit = Math.min(1, this.transmit + dt / 7);
      working = this.transmit;
      this.transmitSpawn -= dt;
      if (this.transmitSpawn <= 0) {
        this.transmitSpawn = 1.6;
        this.spawnWave(1, 20, 26);
      }
      if (Math.random() < dt * 20) this.burst(this.world.towerTop.clone().setY(this.world.towerTop.y - Math.random() * 30), 1, '+*·\'', COL.cyan, 2, 1, 0.6, 0);
      if (this.transmit >= 1) this.win();
    } else if (this.transmit > 0 && this.transmit < 1) {
      this.transmit = Math.max(0, this.transmit - dt * 0.15);
    }
    this.sfx.hum(this.state === 'playing' ? working : 0);
    const bm = this.beaconMat.uniforms;
    bm.uEmitBoost.value = this.relaysOn >= 5 ? 2 + Math.sin(this.time * 8) * 1.2 : Math.sin(this.time * 1.5) > 0.85 ? 1.6 : 0.2;
  }

  private towerHut() {
    return { x: this.world.tower.x, z: this.world.tower.z + 7.5, y: this.world.heightAt(this.world.tower.x, this.world.tower.z + 7.5) };
  }

  private activateRelay(r: Relay) {
    r.active = true;
    r.progress = 1;
    r.pulseT = 0;
    this.relaysOn++;
    this.sfx.relayOn();
    this.cam.addShake(0.6);
    this.burst(r.pos.clone().setY(r.pos.y + 3), 18, '+*·x', COL.cyan, 4, 3, 1, 3);
    this.hud.radio('TOWER NINE', RELAY_LINES[this.relaysOn - 1] ?? '', true);
    this.spawnWave(1 + this.relaysOn, 18, 26);
    const a = Math.random() * TAU;
    this.spawnPickup('ammo', r.pos.x + Math.cos(a) * 1.6, r.pos.z + Math.sin(a) * 1.6);
    if (this.p.hp < 60) this.spawnPickup('med', r.pos.x - Math.cos(a) * 1.6, r.pos.z - Math.sin(a) * 1.6);
  }

  private win() {
    this.state = 'won';
    this.endT = 0;
    this.sfx.hum(0);
    this.sfx.win();
    this.cam.addShake(1);
    this.hud.radio('TOWER NINE', 'SIGNAL SENT. Somewhere past the ash, a receiver just woke up.', true);
    for (const e of this.enemies) e.aggro = false;
  }

  private showEnd() {
    const p = this.p;
    const won = this.state === 'won';
    const t = Math.floor(this.playT);
    const head = document.getElementById('e-head')!;
    head.textContent = won ? 'SIGNAL SENT' : 'SIGNAL LOST';
    head.style.color = won ? 'var(--cyan)' : 'var(--red)';
    document.getElementById('e-sub')!.textContent = won
      ? 'Somewhere past the ash a receiver crackles, and for the first time in years someone hears a voice.'
      : `${this.callsign} was taken by ${this.cause.toLowerCase()}. The basin keeps what it takes.`;
    document.getElementById('e-stats')!.textContent = [
      `TIME     ${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`,
      `RELAYS   ${this.relaysOn} / 5`,
      `KILLS    ${p.kills}`,
      `SCRAP    ${p.scrap}`,
      `WALKED   ${Math.round(p.walked)} m`,
    ].join('\n');
    this.screen('end');
    this.hud.show(false);
  }

  // ------------------------------------------------------------- ambient & fx
  private updateParticles(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i];
      q.life -= dt;
      if (q.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      q.vel.y -= q.grav * dt;
      q.pos.addScaledVector(q.vel, dt);
      const g = this.world.heightAt(q.pos.x, q.pos.z);
      if (q.pos.y < g) {
        q.pos.y = g;
        q.vel.multiplyScalar(0.3);
      }
    }
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.life -= dt;
      f.pos.y += dt * 1.4;
      if (f.life <= 0) this.floats.splice(i, 1);
    }
    if (this.particles.length > 600) this.particles.splice(0, this.particles.length - 600);
  }

  private updateAmbient(dt: number) {
    const c = this.cam.focus;
    // embers drifting up from nearby fires
    for (const l of this.world.lights) {
      if (l.kind !== 'fire') continue;
      if (Math.abs(l.pos.x - c.x) > 26 || Math.abs(l.pos.z - c.z) > 26) continue;
      if (Math.random() < dt * 3) {
        this.particles.push({
          pos: l.pos.clone().add(new Vector3((Math.random() - 0.5) * 0.4, -0.3, (Math.random() - 0.5) * 0.4)),
          vel: new Vector3(this.wind.x * 0.6 + (Math.random() - 0.5) * 0.3, 1.2 + Math.random(), this.wind.y * 0.6),
          life: 1.6,
          max: 1.6,
          ch: Math.random() < 0.5 ? '.' : '\'',
          col: COL.ember,
          grav: -0.2,
        });
      }
    }
    // wind-blown dust motes around the camera
    const rate = 4 + this.storm * 40;
    if (Math.random() < dt * rate) {
      const a = Math.random() * TAU;
      const d = Math.random() * 18;
      const x = c.x + Math.cos(a) * d;
      const z = c.z + Math.sin(a) * d;
      this.particles.push({
        pos: new Vector3(x, this.world.heightAt(x, z) + 0.3 + Math.random() * 2, z),
        vel: new Vector3(this.wind.x * (3 + this.storm * 9), 0.1, this.wind.y * (3 + this.storm * 9)),
        life: 1.2 + Math.random(),
        max: 2,
        ch: this.storm > 0.5 && Math.random() < 0.5 ? '-' : '.',
        col: COL.dust,
        grav: 0,
      });
    }
    // bubbles on toxic water near the camera
    if (Math.random() < dt * 1.5) {
      for (const l of this.world.lakes) {
        if (Math.hypot(l.x - c.x, l.z - c.z) > l.r + 20) continue;
        const a = Math.random() * TAU;
        const d = Math.random() * l.r * 0.7;
        this.ripple(l.x + Math.cos(a) * d, l.z + Math.sin(a) * d, 0.35);
        break;
      }
    }
  }

  private updateRadioScript() {
    const left = STORM_TOTAL - this.playT;
    if (left < 240 && this.once('s240')) this.hud.radio('STORM WATCH', 'Storm wall is four minutes out. Visibility goes first, then your nerve.');
    if (left < 120 && this.once('s120')) this.hud.radio('STORM WATCH', 'Two minutes. If you are near cover, it will not help.');
    if (left < 30 && this.once('s30')) this.hud.radio('STORM WATCH', 'Thirty seconds. Run.');
    if (left <= 0 && this.once('s0')) this.hud.radio('STORM WATCH', 'It is here. Every breath is dust now. Finish it.', true);
  }

  // ------------------------------------------------------------------- camera
  private updateCamera(dt: number) {
    const target = this.tmp;
    if (this.state === 'title') {
      const t = this.time * 0.06;
      target.copy(this.world.campfire).add(this.tmp2.set(Math.cos(t) * 4 - 1.5, 0, Math.sin(t) * 3 - 2));
      this.cam.update(dt, target, this.r.gridAspect, this.r.cols, this.r.rows, 1.2);
      return;
    }
    const p = this.p;
    target.copy(p.pos);
    if (p.alive) target.addScaledVector(p.aim, 1.4);
    if (this.state === 'won') target.lerp(this.world.towerTop.clone().setY(this.world.towerTop.y - 26), smoothstep(0.5, 3, this.endT));
    this.cam.update(dt, target, this.r.gridAspect, this.r.cols, this.r.rows, 5);
  }

  private updateGlobals() {
    const G = this.G;
    const p = this.p;
    G.uTime.value = this.time;
    G.uPlayer.value.copy(this.state === 'title' ? this.world.campfire : p.pos);
    G.uStorm.value = this.storm;
    G.uVision.value = lerp(31, 10, this.storm) * (this.state === 'won' ? 1 + smoothstep(0, 4, this.endT) * 2 : 1);

    // light selection
    const cand = this.lightCand;
    cand.length = 0;
    const fx = this.cam.focus.x;
    const fz = this.cam.focus.z;
    const push = (x: number, y: number, z: number, r: number, c: RGB, i: number) => cand.push({ x, y, z, r, c, i, d: (x - fx) ** 2 + (z - fz) ** 2 });
    const lp = this.state === 'title' ? this.world.spawn : p.pos;
    const lantern = p.alive ? 1.15 : 0.5;
    push(lp.x + Math.sin(p.facing) * 0.6, lp.y + 2.2, lp.z + Math.cos(p.facing) * 0.6, 12, [1, 0.72, 0.42], lantern);
    if (this.muzzle > 0) push(this.muzzlePos.x, this.muzzlePos.y, this.muzzlePos.z, 10, [1, 0.85, 0.5], 3.5);
    for (const r of this.relays) {
      if (r.active) push(r.pos.x, r.pos.y + 3, r.pos.z, 11, [0.35, 0.9, 1], 1.6);
      else push(r.pos.x, r.pos.y + 3, r.pos.z, 3.5 + r.progress * 5, [1, 0.35, 0.25], 0.5 + r.progress * 1.5);
    }
    const tt = this.world.towerTop;
    if (this.relaysOn >= 5) {
      const hut = this.towerHut();
      push(hut.x, hut.y + 3, hut.z, 14, [1, 0.4, 0.3], 1.5 + this.transmit * 2);
    }
    push(tt.x, tt.y, tt.z, 6, [1, 0.3, 0.2], 1);
    for (const l of this.world.lights) {
      let i = l.intensity;
      if (l.kind === 'fire') i *= 0.72 + 0.4 * vnoise(this.time * 7 + l.seed * 100, l.seed * 50);
      else i *= 0.85 + 0.15 * Math.sin(this.time * 1.3 + l.seed * 10);
      push(l.pos.x, l.pos.y, l.pos.z, l.radius, l.color, i);
    }
    const first = cand[0];
    const rest = cand.slice(1).sort((a, b) => a.d - b.d);
    const chosen = [first, ...rest].slice(0, MAX_LIGHTS);
    chosen.forEach((c, i) => {
      G.uLPos.value[i].set(c.x, c.y, c.z, c.r);
      G.uLCol.value[i].set(c.c[0], c.c[1], c.c[2], c.i);
    });
    G.uLCount.value = chosen.length;
  }

  // ------------------------------------------------------------------ overlay
  private drawOverlay() {
    const ov = this.r.overlay;
    ov.clear();
    const cols = this.r.cols;
    const rows = this.r.rows;
    const pr = this.proj;
    const at = (v: Vector3) => this.cam.project(v, cols, rows, pr);

    // particles
    for (const q of this.particles) {
      at(q.pos);
      if (pr.z > 1 || pr.z < -1) continue;
      const k = Math.min(1, (q.life / q.max) * 1.6);
      ov.put(pr.x, pr.y, q.ch, q.col, k);
    }

    // relay pulse rings
    for (const r of this.relays) {
      if (r.pulseT > 2.6) continue;
      const rad = r.pulseT * 7;
      const k = 1 - r.pulseT / 2.6;
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * TAU;
        const x = r.pos.x + Math.cos(a) * rad;
        const z = r.pos.z + Math.sin(a) * rad;
        this.tmp2.set(x, this.world.heightAt(x, z) + 0.2, z);
        at(this.tmp2);
        ov.put(pr.x, pr.y, i % 2 ? '·' : '°', COL.cyan, k);
      }
    }

    if (this.state === 'title') {
      this.drawTitle();
      return;
    }

    const p = this.p;
    // pickups labels
    for (const k of this.pickups) {
      const d = Math.hypot(k.pos.x - p.pos.x, k.pos.z - p.pos.z);
      if (d > 5) continue;
      at(this.tmp2.copy(k.pos).setY(k.pos.y + 0.9));
      const name = k.kind === 'ammo' ? 'ROUNDS' : k.kind === 'med' ? 'MEDKIT' : k.kind === 'iodine' ? 'IODINE' : 'SCRAP';
      ov.textCenter(pr.x, pr.y, name, COL.dim, 1 - d / 6);
    }

    // enemies: alert marks and health ticks
    for (const e of this.enemies) {
      if (e.dead) continue;
      const h = e.kind === 'hound' ? 1.4 : 2.2;
      if (e.alertT > 0) {
        at(this.tmp2.copy(e.pos).setY(e.pos.y + h + 0.5));
        ov.put(pr.x, pr.y, '!', COL.red);
      } else if (e.hitT > 0) {
        at(this.tmp2.copy(e.pos).setY(e.pos.y + h + 0.3));
        const n = Math.max(1, Math.round((e.hp / e.maxHp) * 5));
        ov.textCenter(pr.x, pr.y, '='.repeat(n) + '-'.repeat(5 - n), COL.red, 0.9);
      }
    }

    // threats outside the view: arrows pinned to the screen edge
    if (this.state === 'playing') {
      const blink = Math.floor(this.time * 4) % 2 === 0;
      for (const e of this.enemies) {
        if (e.dead || !e.aggro) continue;
        at(this.tmp2.copy(e.pos).setY(e.pos.y + 1));
        if (pr.x >= 0 && pr.x < cols && pr.y >= 3 && pr.y < rows - 3) continue;
        const cx = clamp(pr.x, 1, cols - 2);
        const cy = clamp(pr.y, 3, rows - 4);
        const ch = pr.x < 0 ? '<' : pr.x >= cols ? '>' : pr.y < 3 ? '^' : 'v';
        ov.put(cx, cy, ch, COL.red, blink ? 1 : 0.55);
      }
    }

    // floating numbers
    for (const f of this.floats) {
      at(f.pos);
      ov.textCenter(pr.x, pr.y, f.text, f.col, Math.min(1, (f.life / f.max) * 2));
    }

    // interaction prompts
    for (const r of this.relays) {
      if (r.active) continue;
      const d = Math.hypot(r.pos.x - p.pos.x, r.pos.z - p.pos.z);
      if (d > 7) continue;
      at(this.tmp2.copy(r.pos).setY(r.pos.y + 3.9));
      const k = d < 3.4 ? 1 : 0.55;
      ov.textCenter(pr.x, pr.y, d < 3.4 ? '[E] REBOOT RELAY' : 'RELAY', COL.gold, k, true);
      if (r.progress > 0) ov.textCenter(pr.x, pr.y + 1, `[${'#'.repeat(Math.round(r.progress * 14))}${'·'.repeat(14 - Math.round(r.progress * 14))}]`, COL.cyan, 1, true);
    }
    if (this.relaysOn >= 5 && this.state === 'playing') {
      const hut = this.towerHut();
      const d = Math.hypot(hut.x - p.pos.x, hut.z - p.pos.z);
      if (d < 12) {
        at(this.tmp2.set(hut.x, hut.y + 4.2, hut.z));
        ov.textCenter(pr.x, pr.y, d < 5.5 ? '[E] HOLD TO TRANSMIT' : 'TOWER NINE', COL.gold, 1, true);
        if (this.transmit > 0) ov.textCenter(pr.x, pr.y + 1, `[${'#'.repeat(Math.round(this.transmit * 20))}${'·'.repeat(20 - Math.round(this.transmit * 20))}]`, COL.cyan, 1, true);
      }
    }

    // tracers
    for (const b of this.bullets) {
      at(b.pos);
      const hx = pr.x;
      const hy = pr.y;
      at(this.tmp2.copy(b.pos).addScaledVector(b.dir, -1.6));
      const dx = hx - pr.x;
      const dy = hy - pr.y;
      const n = Math.max(Math.abs(dx), Math.abs(dy), 1);
      const ang = Math.abs(Math.atan2(-dy * this.r.cellPxH, dx * this.r.cellPxW));
      const a = ang > Math.PI / 2 ? Math.PI - ang : ang;
      const slope = -dy * dx >= 0;
      const ch = a < 0.4 ? '-' : a > 1.17 ? '|' : slope ? '/' : '\\';
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        ov.put(pr.x + dx * t, pr.y + dy * t, ch, i === n ? [1, 0.97, 0.8] : COL.spark, 0.45 + 0.55 * t);
      }
    }

    // name tag
    if (p.alive || this.state === 'dead') {
      at(this.tmp2.copy(p.pos).setY(p.pos.y + 2.75));
      ov.textCenter(pr.x, pr.y, this.callsign, COL.white, p.alive ? 1 : 0.5);
    }
  }

  private drawTitle() {
    const ov = this.r.overlay;
    const cols = this.r.cols;
    const rows = this.r.rows;
    const top = Math.max(2, Math.floor(rows * 0.12));
    const t = this.time;
    if (cols >= LOGO_WIDTH + 4) {
      const x0 = Math.floor((cols - LOGO_WIDTH) / 2);
      LOGO.forEach((line, j) => {
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === ' ') continue;
          const h = ((i * 73856093) ^ (j * 19349663)) >>> 0;
          const reveal = ((h % 1000) / 1000) * 1.6 + 0.2;
          if (t < reveal) continue;
          const flick = Math.sin(t * 3 + i * 0.3 + j) * 0.08 + (Math.random() < 0.004 ? -0.5 : 0);
          const warm: RGB = [0.98, 0.78 - j * 0.07, 0.42 - j * 0.05];
          ov.put(x0 + i, top + j, ch, warm, 1 + flick);
        }
      });
      this.setLogoSpace(top + LOGO.length + 2);
    } else {
      ov.textCenter(cols / 2, top, 'D U S T   S I G N A L', COL.gold);
      this.setLogoSpace(top + 2);
    }
  }

  private logoSpace = -1;
  private setLogoSpace(rowsFromTop: number) {
    if (rowsFromTop === this.logoSpace) return;
    this.logoSpace = rowsFromTop;
    const px = (rowsFromTop * this.r.cellPxH) / this.r.dpr - ((this.r.rows * this.r.cellPxH - this.r.viewH) / 2) / this.r.dpr;
    document.documentElement.style.setProperty('--logo-space', `${Math.round(px)}px`);
  }

  // ---------------------------------------------------------------------- HUD
  private objective(): { pos: Vector3; label: string; count: string; hint: string } {
    const p = this.p;
    if (this.relaysOn >= 5) {
      const h = this.towerHut();
      return { pos: new Vector3(h.x, h.y, h.z), label: 'TOWER NINE', count: 'TRANSMIT', hint: this.transmit > 0 ? 'Hold E. Do not let go.' : 'Reach the tower hut and hold E.' };
    }
    let best: Relay | null = null;
    let bd = 1e9;
    for (const r of this.relays) {
      if (r.active) continue;
      const d = Math.hypot(r.pos.x - p.pos.x, r.pos.z - p.pos.z);
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    const hints = ['Follow the static.', 'Search the next glow.', 'Wake the next relay.', 'The tower is listening.', 'One more.'];
    return { pos: best!.pos, label: 'RELAYS', count: `${this.relaysOn} / 5`, hint: hints[this.relaysOn] ?? '' };
  }

  private updateHud(dt: number) {
    this.hud.update(dt);
    if (this.state !== 'playing' && this.state !== 'paused') return;
    const p = this.p;
    this.hud.setVitals(Math.max(0, p.hp), p.maxHp, p.rads, p.stamina);
    this.hud.setWeapon(p.ammo, 90, p.scrap, p.kills);
    const o = this.objective();
    const d = this.tmp2.set(o.pos.x - p.pos.x, 0, o.pos.z - p.pos.z);
    const sx = d.dot(this.cam.right);
    const sy = d.dot(this.cam.up);
    this.hud.setObjective(o.label, o.count, o.hint, (Math.atan2(sx, sy) * 180) / Math.PI, Math.hypot(d.x, d.z));
    this.hud.setStorm(STORM_TOTAL - this.playT, this.storm);
    this.hud.fadeKeys(this.playT > 14);
  }

  private mapAcc = 0;
  private updateMap() {
    const el = document.getElementById('map');
    if (!el) return;
    if (!this.mapOpen) {
      if (!el.classList.contains('hidden')) el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    this.mapAcc -= 1 / 60;
    if (this.mapAcc > 0) return;
    this.mapAcc = 0.15;
    const W = this.world;
    const grid = W.mapBase.map((r) => [...r]);
    const cls: string[][] = grid.map((r) => r.map((c) => (c === '~' ? 'w' : c === '=' ? 'r' : c === '^' ? 'm' : '')));
    const mark = (x: number, z: number, ch: string, c: string) => {
      const { i, j } = W.mapCell(x, z, this.cam.groundRight, this.cam.groundFwd);
      if (j < 0 || j >= grid.length || i < 0 || i >= grid[0].length) return;
      grid[j][i] = ch;
      cls[j][i] = c;
    };
    for (const l of W.landmarks) if (l.cls !== 'lake') mark(l.x, l.z, l.ch, l.cls === 'tower' ? 't' : 'l');
    this.relays.forEach((r) => mark(r.pos.x, r.pos.z, String(r.idx + 1), r.active ? 'on' : 'off'));
    if (Math.floor(this.time * 3) % 2 === 0 || !this.p.alive) mark(this.p.pos.x, this.p.pos.z, '@', 'p');
    let html = '<span class="head">ASHFALL BASIN · M TO CLOSE</span>\n';
    for (let j = 0; j < grid.length; j++) {
      let cur = '';
      let run = '';
      for (let i = 0; i < grid[j].length; i++) {
        const c = cls[j][i];
        if (c !== cur) {
          if (run) html += cur ? `<span class="${cur}">${run}</span>` : run;
          cur = c;
          run = '';
        }
        run += grid[j][i];
      }
      if (run) html += cur ? `<span class="${cur}">${run}</span>` : run;
      html += '\n';
    }
    html += '<span class="head">@ YOU   1-5 RELAYS   T TOWER   A CAMP   # RUINS   $ FUEL   % WRECK   & BONES</span>';
    el.innerHTML = html;
  }

  // ------------------------------------------------------------------- render
  render() {
    this.r.render({
      scene: this.scene,
      worldRoot: this.worldRoot,
      water: this.world.water,
      camera: this.cam,
      globals: this.G,
      time: this.time,
      ripples: this.ripples,
      decals: this.decals,
      storm: this.storm,
      wind: this.wind,
      hurt: this.hurt * 0.8 + (this.p.hp < 25 && this.p.alive && this.state === 'playing' ? 0.25 + 0.15 * Math.sin(this.time * 6) : 0),
      fade: this.fade,
    });
  }

  // ---------------------------------------------------------------- debugging
  debug() {
    return {
      teleport: (x: number, z: number) => {
        this.p.pos.set(x, this.world.heightAt(x, z), z);
        this.cam.focus.copy(this.p.pos);
      },
      setStormTime: (t: number) => (this.playT = t),
      activateAll: () => this.relays.forEach((r) => !r.active && this.activateRelay(r)),
      relays: () => this.relays.map((r) => r.pos.toArray()),
      state: () => ({ state: this.state, hp: this.p.hp, pos: this.p.pos.toArray(), enemies: this.enemies.length, relays: this.relaysOn }),
      world: this.world,
      player: this.p,
      face: (deg: number) => (this.p.facing = (deg * Math.PI) / 180),
      god: (on = true) => (this.god = on),
      spawn: (kind: EnemyKind, dx: number, dz: number) => this.spawnEnemy(kind, this.p.pos.x + dx, this.p.pos.z + dz, true).kind,
    };
  }
}
