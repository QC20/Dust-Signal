import { GLSL3, ShaderMaterial, Vector3, Vector4, FrontSide, DoubleSide } from 'three';

// Material IDs are written into the alpha channel of the scene render target.
// The ASCII pass uses them to pick a character vocabulary per surface.
export const MAT = {
  VOID: 0,
  SAND: 1,
  CRACKED: 2,
  ASPHALT: 3,
  PAINT: 4,
  ROCK: 5,
  CONCRETE: 6,
  RUST: 7,
  STEEL: 8,
  SCRUB: 9,
  WOOD: 10,
  BONE: 11,
  WATER: 12,
  FIRE: 13,
  GLOW: 14,
  PLAYER: 15,
  ENEMY: 16,
  TOXIC: 17,
  CLOTH: 18,
} as const;

export const MAT_GLSL = Object.entries(MAT)
  .map(([k, v]) => `#define M_${k} ${v}`)
  .join('\n');

export const WATER_H = -0.45;
export const MAX_LIGHTS = 14;

export function createGlobals() {
  return {
    uMirror: { value: 0 },
    uWaterH: { value: WATER_H },
    uDepthBias: { value: 150 },
    uTime: { value: 0 },
    uAmbSky: { value: new Vector3(0.1, 0.12, 0.19) },
    uAmbGround: { value: new Vector3(0.07, 0.05, 0.04) },
    uMoonDir: { value: new Vector3(-0.45, 0.62, 0.64).normalize() },
    uMoonCol: { value: new Vector3(0.36, 0.42, 0.6) },
    uLPos: { value: Array.from({ length: MAX_LIGHTS }, () => new Vector4()) },
    uLCol: { value: Array.from({ length: MAX_LIGHTS }, () => new Vector4()) },
    uLCount: { value: 0 },
    uPlayer: { value: new Vector3() },
    uVision: { value: 30 },
    uStorm: { value: 0 },
  };
}
export type Globals = ReturnType<typeof createGlobals>;

const LIGHTING = /* glsl */ `
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform vec3 uMoonDir;
uniform vec3 uMoonCol;
uniform vec4 uLPos[${MAX_LIGHTS}];
uniform vec4 uLCol[${MAX_LIGHTS}];
uniform int uLCount;
uniform vec3 uPlayer;
uniform float uVision;
uniform float uStorm;
uniform float uMirror;
uniform float uWaterH;
uniform float uDepthBias;

vec3 shade(vec3 albedo, vec3 n, vec3 p) {
  vec3 L = mix(uAmbGround, uAmbSky, n.y * 0.5 + 0.5);
  L += uMoonCol * max(dot(n, uMoonDir), 0.0) * (1.0 - 0.6 * uStorm);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLCount) break;
    vec3 d = uLPos[i].xyz - p;
    float dist = length(d);
    float att = clamp(1.0 - dist / uLPos[i].w, 0.0, 1.0);
    att *= att;
    float ndl = max(dot(n, d / max(dist, 1e-3)), 0.0);
    L += uLCol[i].rgb * uLCol[i].a * att * (0.3 + 0.7 * ndl);
  }
  return albedo * L;
}

float visibility(vec3 p) {
  float d = length(p.xz - uPlayer.xz);
  return mix(0.22, 1.0, 1.0 - smoothstep(uVision * 0.5, uVision, d));
}
`;

const NOISE = /* glsl */ `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;

const COMMON_VERT_OUT = /* glsl */ `
uniform float uMirror;
uniform float uWaterH;
out vec3 vLPos;
out vec3 vNW;
out vec3 vNV;
out float vDepth;
void commonVert() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 nW = normalize(mat3(modelMatrix) * normal);
  vec3 lp = wp.xyz;
  if (uMirror > 0.5) { lp.y = 2.0 * uWaterH - lp.y; nW.y = -nW.y; }
  vLPos = lp;
  vNW = nW;
  vec4 mv = viewMatrix * wp;
  vNV = normalize(normalMatrix * normal);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG_HEAD = /* glsl */ `
precision highp float;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outInfo;
in vec3 vLPos;
in vec3 vNW;
in vec3 vNV;
in float vDepth;
${LIGHTING}
${NOISE}
void writeInfo() { outInfo = vec4(normalize(vNV), vDepth - uDepthBias); }
`;

const WORLD_VERT = /* glsl */ `
in vec3 aColor;
in float aMat;
in float aEmit;
out vec3 vColor;
out float vMat;
out float vEmit;
${COMMON_VERT_OUT}
void main() {
  vColor = aColor;
  vMat = aMat;
  vEmit = aEmit;
  commonVert();
}
`;

const WORLD_FRAG = /* glsl */ `
${FRAG_HEAD}
in vec3 vColor;
in float vMat;
in float vEmit;
uniform float uFlash;
uniform float uEmitBoost;
uniform vec3 uTint;
uniform float uDissolve;
uniform float uSelfLit;
void main() {
  if (uMirror > 0.5 && vLPos.y < uWaterH - 0.05) discard;
  if (uDissolve > 0.0 && hash12(floor(gl_FragCoord.xy)) < uDissolve) discard;
  vec3 n = normalize(vNW);
  vec3 alb = vColor * uTint;
  vec3 c = shade(alb, n, vLPos) * visibility(vLPos) + vColor * uTint * vEmit * uEmitBoost;
  // characters carry a little of their own light so they read against the night
  c += alb * uSelfLit * (0.55 + 0.45 * max(n.y, 0.0)) * visibility(vLPos);
  c = mix(c, vec3(2.4, 2.2, 2.0), uFlash);
  outColor = vec4(c, vMat);
  writeInfo();
}
`;

export function worldMaterial(G: Globals, opts: { emitBoost?: number; doubleSided?: boolean; selfLit?: number } = {}) {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: WORLD_VERT,
    fragmentShader: WORLD_FRAG,
    side: opts.doubleSided ? DoubleSide : FrontSide,
    uniforms: {
      ...G,
      uFlash: { value: 0 },
      uEmitBoost: { value: opts.emitBoost ?? 1 },
      uTint: { value: new Vector3(1, 1, 1) },
      uDissolve: { value: 0 },
      uSelfLit: { value: opts.selfLit ?? 0 },
    },
  });
}

const TERRAIN_VERT = /* glsl */ `
in float aRoadV;
in float aRoadU;
in float aCrack;
in float aRock;
out float vRoadV;
out float vRoadU;
out float vCrack;
out float vRock;
${COMMON_VERT_OUT}
void main() {
  vRoadV = aRoadV; vRoadU = aRoadU; vCrack = aCrack; vRock = aRock;
  commonVert();
}
`;

const TERRAIN_FRAG = /* glsl */ `
${FRAG_HEAD}
in float vRoadV;
in float vRoadU;
in float vCrack;
in float vRock;
void main() {
  if (uMirror > 0.5 && vLPos.y < uWaterH - 0.05) discard;
  vec3 n = normalize(vNW);
  vec2 xz = vLPos.xz;
  float n1 = vnoise(xz * 0.31);
  float n2 = vnoise(xz * 1.7 + 7.0);
  float m = 1.0;
  vec3 alb = vec3(0.88, 0.66, 0.42) * (0.8 + 0.32 * n1);
  if (vCrack > 0.5 + (n1 - 0.5) * 0.4) { m = 2.0; alb = vec3(0.76, 0.72, 0.64) * (0.84 + 0.25 * n2); }
  if (vRock > 0.5 + (n2 - 0.5) * 0.3 || n.y < 0.68) { m = 5.0; alb = vec3(0.58, 0.52, 0.47) * (0.75 + 0.4 * n2); }
  float av = abs(vRoadV);
  if (av < 3.3) {
    float ero = vnoise(xz * 0.45 + 3.0);
    if (ero < 0.8 - 0.5 * smoothstep(1.6, 3.3, av)) {
      m = 3.0;
      alb = vec3(0.32, 0.32, 0.35) * (0.85 + 0.3 * n2);
      bool center = av < 0.15 && fract(vRoadU / 3.6) < 0.55;
      bool side = abs(av - 2.7) < 0.12;
      if ((center || side) && n2 > 0.22) { m = 4.0; alb = vec3(0.95, 0.86, 0.55); }
    }
  }
  vec3 c = shade(alb, n, vLPos) * visibility(vLPos);
  outColor = vec4(c, m);
  writeInfo();
}
`;

export function terrainMaterial(G: Globals) {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: TERRAIN_VERT,
    fragmentShader: TERRAIN_FRAG,
    uniforms: { ...G },
  });
}

const WATER_VERT = /* glsl */ `
${COMMON_VERT_OUT}
void main() { commonVert(); }
`;

const WATER_FRAG = /* glsl */ `
${FRAG_HEAD}
void main() {
  vec3 c = shade(vec3(0.16, 0.26, 0.24), vec3(0.0, 1.0, 0.0), vLPos) * visibility(vLPos);
  c += vec3(0.015, 0.05, 0.03);
  outColor = vec4(c, 12.0);
  writeInfo();
}
`;

export function waterMaterial(G: Globals) {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    uniforms: { ...G },
  });
}
