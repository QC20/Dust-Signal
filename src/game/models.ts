import { Group, Mesh, Object3D, ShaderMaterial, Vector3 } from 'three';
import { GeometryBuilder, PartOpts } from './builder';
import { MAT, Globals, worldMaterial } from '../engine/materials';

const o = (color: number, mat: number, emit = 0, jitter = 0.06): PartOpts => ({ color, mat, emit, jitter });

function mesh(mat: ShaderMaterial, fn: (b: GeometryBuilder) => void, seed = 1): Mesh {
  const b = new GeometryBuilder(seed);
  fn(b);
  const m = new Mesh(b.build(), mat);
  m.frustumCulled = false;
  return m;
}

function pivot(parent: Object3D, x: number, y: number, z: number, child: Object3D) {
  const g = new Group();
  g.position.set(x, y, z);
  g.add(child);
  parent.add(g);
  return g;
}

export interface HumanoidModel {
  root: Group;
  body: Group;
  legL: Group;
  legR: Group;
  armL: Group;
  armR: Group;
  mat: ShaderMaterial;
  tip?: Mesh;
}

export function playerModel(G: Globals): HumanoidModel {
  const mat = worldMaterial(G, { selfLit: 0.75 });
  const root = new Group();
  const body = new Group();
  root.add(body);
  body.add(
    mesh(mat, (b) => {
      // duster coat + torso
      b.cyl(0, 0.78, 0, 0.27, 0.42, 0.78, 8, o(0x8a6f50, MAT.CLOTH, 0, 0.1));
      b.box(0, 1.2, 0, 0.52, 0.56, 0.32, o(0x7b664c, MAT.CLOTH));
      // scarf
      b.box(0, 1.46, 0.02, 0.42, 0.14, 0.36, o(0xa8402c, MAT.CLOTH));
      // head, hood and goggles
      b.box(0, 1.64, 0, 0.3, 0.3, 0.3, o(0x6a5a46, MAT.PLAYER));
      b.box(0, 1.73, -0.02, 0.38, 0.24, 0.38, o(0x5e4c3a, MAT.CLOTH));
      b.box(-0.08, 1.64, 0.16, 0.09, 0.07, 0.04, o(0xffb14a, MAT.GLOW, 3));
      b.box(0.08, 1.64, 0.16, 0.09, 0.07, 0.04, o(0xffb14a, MAT.GLOW, 3));
      b.box(0, 1.55, 0.17, 0.16, 0.08, 0.06, o(0x3a3633, MAT.STEEL));
      // backpack with the signal antenna
      b.box(0, 1.16, -0.27, 0.42, 0.52, 0.22, o(0x5d5a3c, MAT.CLOTH));
      b.box(0.13, 1.7, -0.3, 0.03, 0.7, 0.03, o(0x9aa0a4, MAT.STEEL));
      // rifle held across the body
      b.box(0.12, 1.08, 0.3, 0.08, 0.1, 0.92, o(0x3d3a37, MAT.STEEL));
      b.box(0.12, 1.0, 0.1, 0.06, 0.16, 0.12, o(0x6b4a32, MAT.WOOD));
    }),
  );
  const tip = mesh(worldMaterial(G), (b) => b.box(0.13, 2.08, -0.3, 0.07, 0.07, 0.07, o(0x63ecff, MAT.GLOW, 3)));
  body.add(tip);
  const leg = () =>
    mesh(mat, (b) => {
      b.box(0, -0.38, 0, 0.17, 0.74, 0.19, o(0x4f4436, MAT.CLOTH));
      b.box(0, -0.74, 0.04, 0.2, 0.12, 0.28, o(0x2f2a25, MAT.PLAYER));
    });
  const arm = () => mesh(mat, (b) => b.box(0, -0.28, 0.06, 0.13, 0.58, 0.14, o(0x7b664c, MAT.CLOTH)));
  const legL = pivot(root, -0.12, 0.8, 0, leg());
  const legR = pivot(root, 0.12, 0.8, 0, leg());
  const armL = pivot(body, -0.33, 1.42, 0, arm());
  const armR = pivot(body, 0.33, 1.42, 0, arm());
  armL.rotation.x = -0.9;
  armR.rotation.x = -1.1;
  return { root, body, legL, legR, armL, armR, mat, tip };
}

export function huskModel(G: Globals, seed: number): HumanoidModel {
  const mat = worldMaterial(G, { selfLit: 0.45 });
  const root = new Group();
  const body = new Group();
  root.add(body);
  body.add(
    mesh(
      mat,
      (b) => {
        b.box(0, 1.15, 0.08, 0.6, 0.72, 0.42, o(0x8c8264, MAT.ENEMY, 0, 0.14), { x: 0.38 });
        b.box(0, 1.5, 0.36, 0.34, 0.34, 0.34, o(0x9a8e6a, MAT.ENEMY), { x: 0.2 });
        b.box(-0.08, 1.52, 0.54, 0.07, 0.05, 0.03, o(0x9dff6a, MAT.GLOW, 3.5));
        b.box(0.08, 1.52, 0.54, 0.07, 0.05, 0.03, o(0x9dff6a, MAT.GLOW, 3.5));
        b.rock(0.18, 1.4, -0.12, 0.2, o(0x9fcf4a, MAT.TOXIC, 0.9));
        b.rock(-0.15, 1.2, -0.18, 0.15, o(0x9fcf4a, MAT.TOXIC, 0.9));
        b.box(0, 0.85, 0.02, 0.62, 0.3, 0.44, o(0x4e3e2e, MAT.CLOTH, 0, 0.15));
      },
      seed,
    ),
  );
  const leg = () => mesh(mat, (b) => b.box(0, -0.4, 0, 0.18, 0.8, 0.2, o(0x6e6450, MAT.ENEMY)));
  const arm = () =>
    mesh(mat, (b) => {
      b.box(0, -0.45, 0, 0.15, 0.9, 0.15, o(0x8c8264, MAT.ENEMY));
      b.box(0, -0.95, 0.05, 0.2, 0.14, 0.2, o(0x6e6450, MAT.ENEMY));
    });
  const legL = pivot(root, -0.15, 0.82, 0, leg());
  const legR = pivot(root, 0.15, 0.82, 0, leg());
  const armL = pivot(body, -0.38, 1.4, 0.25, arm());
  const armR = pivot(body, 0.38, 1.4, 0.25, arm());
  return { root, body, legL, legR, armL, armR, mat };
}

export interface HoundModel {
  root: Group;
  body: Group;
  legs: Group[];
  mat: ShaderMaterial;
}

export function houndModel(G: Globals, seed: number): HoundModel {
  const mat = worldMaterial(G, { selfLit: 0.45 });
  const root = new Group();
  const body = new Group();
  root.add(body);
  body.add(
    mesh(
      mat,
      (b) => {
        b.box(0, 0.64, 0, 0.44, 0.42, 1.1, o(0x8e5a44, MAT.ENEMY, 0, 0.15));
        b.box(0, 0.8, 0.66, 0.32, 0.3, 0.44, o(0x9a6650, MAT.ENEMY));
        b.box(0, 0.68, 0.8, 0.24, 0.1, 0.34, o(0x6a3a2c, MAT.ENEMY));
        b.box(-0.08, 0.86, 0.89, 0.06, 0.05, 0.03, o(0xff5a3a, MAT.GLOW, 3.5));
        b.box(0.08, 0.86, 0.89, 0.06, 0.05, 0.03, o(0xff5a3a, MAT.GLOW, 3.5));
        b.beam(new Vector3(-0.1, 0.95, 0.6), new Vector3(-0.18, 1.18, 0.5), 0.05, o(0x6a3a2c, MAT.ENEMY));
        b.beam(new Vector3(0.1, 0.95, 0.6), new Vector3(0.18, 1.18, 0.5), 0.05, o(0x6a3a2c, MAT.ENEMY));
        for (let i = 0; i < 4; i++) b.box(0, 0.9, 0.35 - i * 0.24, 0.06, 0.14, 0.06, o(0xd8d0bc, MAT.BONE));
        b.beam(new Vector3(0, 0.7, -0.55), new Vector3(0, 0.95, -0.95), 0.06, o(0x6a3a2c, MAT.ENEMY));
      },
      seed,
    ),
  );
  const legs: Group[] = [];
  for (const [x, z] of [[-0.17, 0.4], [0.17, 0.4], [-0.17, -0.4], [0.17, -0.4]]) {
    legs.push(pivot(root, x, 0.5, z, mesh(mat, (b) => b.box(0, -0.25, 0, 0.11, 0.5, 0.12, o(0x6e4434, MAT.ENEMY)))));
  }
  return { root, body, legs, mat };
}

export interface RelayModel {
  root: Group;
  dish: Group;
  light: Mesh;
  lightMat: ShaderMaterial;
}

export function relayModel(G: Globals): RelayModel {
  const mat = worldMaterial(G);
  const root = new Group();
  root.add(
    mesh(mat, (b) => {
      b.box(0, 0.45, 0, 0.7, 0.9, 0.5, o(0x8a5232, MAT.RUST, 0, 0.12));
      b.box(0, 0.62, 0.26, 0.4, 0.2, 0.03, o(0x2a2e30, MAT.STEEL));
      b.cyl(0, 1.7, 0, 0.07, 0.1, 2.6, 6, o(0x8c9196, MAT.STEEL));
      b.beam(new Vector3(0, 2.6, 0), new Vector3(0.8, 0.9, 0.5), 0.03, o(0x55595c, MAT.STEEL));
      b.beam(new Vector3(0, 2.6, 0), new Vector3(-0.7, 0.9, -0.6), 0.03, o(0x55595c, MAT.STEEL));
    }),
  );
  const dish = new Group();
  dish.position.set(0, 2.25, 0);
  dish.add(
    mesh(mat, (b) => {
      b.cyl(0, 0, 0.32, 0.62, 0.45, 0.14, 12, o(0xd0cabb, MAT.STEEL), { x: Math.PI / 2 });
      b.box(0, 0, 0.15, 0.06, 0.06, 0.3, o(0x8c9196, MAT.STEEL));
    }),
  );
  root.add(dish);
  const lightMat = worldMaterial(G);
  const light = mesh(lightMat, (b) => b.box(0, 3.08, 0, 0.2, 0.2, 0.2, o(0x63ecff, MAT.GLOW, 2)));
  root.add(light);
  return { root, dish, light, lightMat };
}

export type PickupKind = 'ammo' | 'med' | 'iodine' | 'scrap';

export function pickupMesh(mat: ShaderMaterial, kind: PickupKind): Mesh {
  return mesh(mat, (b) => {
    if (kind === 'ammo') {
      b.box(0, 0.18, 0, 0.55, 0.32, 0.34, o(0x5f6b3a, MAT.RUST));
      b.box(0, 0.3, 0.175, 0.4, 0.06, 0.01, o(0xffd060, MAT.GLOW, 1.5));
    } else if (kind === 'med') {
      b.box(0, 0.17, 0, 0.44, 0.3, 0.32, o(0xd8d4c8, MAT.BONE));
      b.box(0, 0.33, 0, 0.26, 0.03, 0.08, o(0xff4a3a, MAT.GLOW, 2.2));
      b.box(0, 0.33, 0, 0.08, 0.03, 0.26, o(0xff4a3a, MAT.GLOW, 2.2));
    } else if (kind === 'iodine') {
      b.cyl(0, 0.2, 0, 0.11, 0.11, 0.36, 8, o(0xffd84a, MAT.GLOW, 1.6));
      b.box(0, 0.42, 0, 0.12, 0.08, 0.12, o(0xd8d4c8, MAT.BONE));
    } else {
      b.box(0, 0.08, 0, 0.36, 0.12, 0.2, o(0x9aa0a4, MAT.STEEL), { y: 0.4 });
      b.box(0.12, 0.18, 0.05, 0.16, 0.1, 0.24, o(0xb07040, MAT.RUST), { y: -0.5, z: 0.3 });
      b.cyl(-0.1, 0.12, -0.1, 0.1, 0.1, 0.06, 8, o(0xc8c0a8, MAT.STEEL));
    }
  });
}

export function bulletMesh(mat: ShaderMaterial): Mesh {
  return mesh(mat, (b) => b.box(0, 0, 0, 0.07, 0.07, 0.7, o(0xffe9a8, MAT.GLOW, 4)));
}

export function beaconMesh(mat: ShaderMaterial): Mesh {
  return mesh(mat, (b) => {
    b.box(0, 0, 0, 0.45, 0.45, 0.45, o(0xff4a3a, MAT.GLOW, 2.5));
  });
}
