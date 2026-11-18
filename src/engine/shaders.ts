import { gi, SHAPE_SET } from './glyphs';
import { MAT_GLSL } from './materials';

export const SX = 2; // scene sub-samples per cell (x)
export const SY = 3; // scene sub-samples per cell (y)
export const RIPPLE_N = 16;
export const DECAL_N = 48;
export const SHAPE_N = [...SHAPE_SET].length;

function arr(name: string, chars: string): string {
  const idx = [...chars].map(gi);
  return `const int ${name}[${idx.length}] = int[${idx.length}](${idx.join(',')});`;
}

const GLYPHS = [
  `#define G_SPACE ${gi(' ')}`,
  `#define G_BAR ${gi('|')}`,
  `#define G_SLASH ${gi('/')}`,
  `#define G_BSLASH ${gi('\\')}`,
  `#define G_DASH ${gi('-')}`,
  `#define G_UNDER ${gi('_')}`,
  `#define G_LPAR ${gi('(')}`,
  `#define G_RPAR ${gi(')')}`,
  `#define G_TILDE ${gi('~')}`,
  `#define G_DOT ${gi('.')}`,
  `#define G_COMMA ${gi(',')}`,
  `#define G_QUOTE ${gi("'")}`,
  `#define G_DQUOTE ${gi('"')}`,
  `#define G_EQ ${gi('=')}`,
  `#define G_O ${gi('o')}`,
  `#define G_MIDDOT ${gi('·')}`,
  `#define G_DEG ${gi('°')}`,
  `#define G_PLUS ${gi('+')}`,
  `#define G_STAR ${gi('*')}`,
  arr('R_SAND', '..··.,:'),
  arr('R_CRACK', '..·:;'),
  arr('R_ASPH', '..:;=%'),
  arr('R_ROCKLO', ' .:;'),
  arr('S_ROCK', '#%&$@8BWMQ0DKNHR'),
  arr('R_CONCLO', ' .:=+'),
  arr('S_CONC', 'HNM#WE8B%&'),
  arr('R_CONCTOP', ' .:;=%#'),
  arr('R_RUSTLO', ' .:=+'),
  arr('S_RUST', '#%&=H[]E$'),
  arr('R_STEEL', ' .:+|H#'),
  arr('R_WOOD', ' .:!|lI'),
  arr('R_BONE', ' .oO0@'),
  arr('S_FIRE', "'`^*\"#&"),
  arr('R_GLOW', ' .+x*oO@'),
  arr('R_PLAYER', ' .:-=+*#%@'),
  arr('R_ENEMY', ' .:;x%X#&M'),
  arr('R_TOXIC', ' .:oO0@'),
  arr('R_CLOTH', ' .:=+*#%'),
  arr('R_GEN', ' .,:;i1tfLCG08@'),
  arr('R_MOON', '.:oO0@'),
  arr('R_CLOUD', ' .·-~=≈'),
].join('\n');

export const FULLSCREEN_VERT = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const CELL_FRAG = /* glsl */ `
precision highp float;
precision highp int;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outGlow;

uniform sampler2D tColor;
uniform sampler2D tInfo;
uniform sampler2D tRColor;
uniform sampler2D tOverlay;
uniform vec2 uGrid;
uniform vec2 uScene;
uniform float uTime;
uniform vec3 uCamPos;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform vec2 uHalf;
uniform float uDepthBias;
uniform vec2 uTexelPx;
uniform vec4 uRipples[${RIPPLE_N}];
uniform vec4 uDecals[${DECAL_N}];
uniform vec3 uPlayer;
uniform float uStorm;
uniform vec2 uWind;
uniform vec2 uMoonUV;
uniform float uAspect;
uniform float uExposure;
uniform float uGain;
uniform float uShapeAmt;
uniform float uDepthEdge;
uniform float uNormEdge;
uniform vec3 uShapeL[${SHAPE_N}];
uniform vec3 uShapeR[${SHAPE_N}];
uniform int uShapeIdx[${SHAPE_N}];

${MAT_GLSL}
${GLYPHS}

#define PICK(R, t) R[clamp(int((t) * float(R.length())), 0, R.length() - 1)]
#define SETPICK(S, h) S[clamp(int((h) * float(S.length())), 0, S.length() - 1)]

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s / 0.9375; }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 tonemap(vec3 c) { return vec3(1.0) - exp(-max(c, 0.0) * uExposure); }

vec3 worldFromDepth(vec2 ndc, float d) {
  return uCamPos + uCamRight * (ndc.x * uHalf.x) + uCamUp * (ndc.y * uHalf.y) + uCamFwd * (d + uDepthBias);
}
vec2 screenDir(vec3 w) { return vec2(dot(w, uCamRight), dot(w, uCamUp)); }

// Pick a line glyph for a tangent direction given in screen pixels.
int dirGlyph(vec2 t) {
  float a = degrees(atan(t.y, t.x));
  if (a < 0.0) a += 180.0;
  if (a < 22.0 || a > 158.0) return G_DASH;
  if (a < 68.0) return G_SLASH;
  if (a < 112.0) return G_BAR;
  return G_BSLASH;
}

// Sparse, dithered ground: brightness sets both the chance of a glyph and its weight.
bool sparseHole(float l, float h2, float density) {
  float keep = smoothstep(0.02, 0.6, l) * density;
  return h2 > keep + 0.04;
}

int styleGlyph(int m, float l, vec3 wp, vec3 nW, vec2 cellF, inout vec3 col) {
  float h = hash13(floor(wp * 3.7) + 0.5);
  float h2 = hash13(floor(wp * 7.9) + 3.1);
  if (l < 0.03) return G_SPACE;
  if (m == M_SAND) {
    vec2 wperp = vec2(-uWind.y, uWind.x);
    float rip = sin(dot(wp.xz, wperp) * 2.3 + fbm(wp.xz * 0.22) * 7.0);
    if (rip > 0.96 && h2 < smoothstep(0.03, 0.4, l) + 0.15) return G_TILDE;
    // glass shards and mica catching the light
    float gl = hash13(floor(wp * 5.3) + 11.7);
    if (gl > 0.9965) {
      float tw = 0.5 + 0.5 * sin(uTime * (2.0 + gl * 3.0) + h * 40.0);
      col = mix(col, vec3(0.95, 0.97, 1.0), 0.75) * (0.6 + 0.8 * tw) / max(luma(col), 0.25) * 0.5;
      return tw > 0.6 ? G_STAR : G_DOT;
    }
    if (sparseHole(l, h2, 0.7)) return G_SPACE;
    return PICK(R_SAND, l * 1.2 + (h - 0.5) * 0.15);
  }
  if (m == M_CRACKED) {
    vec2 p = wp.xz * 0.75;
    vec2 ip = floor(p); vec2 fp = fract(p);
    float d1 = 9.0, d2 = 9.0; vec2 r1 = vec2(0.0), r2 = vec2(0.0);
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(hash12(ip + g), hash12(ip + g + 19.7));
      vec2 r = g + o - fp;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; r2 = r1; d1 = d; r1 = r; } else if (d < d2) { d2 = d; r2 = r; }
    }
    float ed = dot(0.5 * (r1 + r2), normalize(r2 - r1));
    if (ed < 0.075 && l > 0.05) {
      vec2 e = normalize(r2 - r1);
      col *= 0.6;
      return dirGlyph(screenDir(vec3(-e.y, 0.0, e.x)));
    }
    if (sparseHole(l, h2, 0.6)) return G_SPACE;
    return PICK(R_CRACK, l * 1.1 + (h - 0.5) * 0.12);
  }
  if (m == M_ASPHALT) {
    if (sparseHole(l, h2, 0.7)) return G_SPACE;
    return PICK(R_ASPH, l * 1.1 + (h - 0.5) * 0.12);
  }
  if (m == M_PAINT) return l > 0.05 ? G_EQ : G_SPACE;
  if (m == M_ROCK) {
    if (l < 0.13) return PICK(R_ROCKLO, l / 0.13);
    return SETPICK(S_ROCK, h);
  }
  if (m == M_CONCRETE) {
    if (abs(nW.y) < 0.55) {
      if (fract(wp.y * 2.4) < 0.17 && l > 0.06) return G_UNDER;
      if (l < 0.12) return PICK(R_CONCLO, l / 0.12);
      return SETPICK(S_CONC, h);
    }
    return PICK(R_CONCTOP, l + (h - 0.5) * 0.2);
  }
  if (m == M_RUST) {
    if (l < 0.12) return PICK(R_RUSTLO, l / 0.12);
    return SETPICK(S_RUST, h);
  }
  if (m == M_STEEL) return PICK(R_STEEL, l * 1.1);
  if (m == M_SCRUB) {
    float ph = dot(wp.xz, uWind) * 0.9 - uTime * (2.0 + uStorm * 5.0) + vnoise(wp.xz * 0.8) * 4.0;
    float sway = sin(ph) * (0.6 + 0.8 * uStorm) + (h - 0.5) * 0.7;
    if (l < 0.07) return G_COMMA;
    if (h > 0.88) return G_QUOTE;
    return sway > 0.3 ? G_SLASH : (sway < -0.3 ? G_BSLASH : G_BAR);
  }
  if (m == M_WOOD) return PICK(R_WOOD, l * 1.1);
  if (m == M_BONE) return PICK(R_BONE, l);
  if (m == M_FIRE) {
    float f = hash13(floor(wp * 5.0) + floor(uTime * 14.0) * 7.31);
    col *= 0.75 + 0.6 * f;
    return SETPICK(S_FIRE, f);
  }
  if (m == M_GLOW) return PICK(R_GLOW, l);
  if (m == M_PLAYER) return PICK(R_PLAYER, l * 1.5);
  if (m == M_ENEMY) return PICK(R_ENEMY, l * 1.45);
  if (m == M_TOXIC) {
    col *= 0.85 + 0.3 * sin(uTime * 3.0 + h * 6.28);
    return PICK(R_TOXIC, l);
  }
  if (m == M_CLOTH) return PICK(R_CLOTH, l * 1.45);
  return PICK(R_GEN, l);
}

bool isChar(int m) { return m == M_PLAYER || m == M_CLOTH || m == M_ENEMY; }

vec3 skyRefl(vec2 uv, out int g) {
  vec2 p = (uv - uMoonUV) * vec2(uAspect, 1.0);
  float r = length(p);
  float moonR = 0.052;
  if (r < moonR) {
    // a shaded, cratered gibbous moon
    vec2 q = p / moonR;
    vec3 n = vec3(q, sqrt(max(0.0, 1.0 - dot(q, q))));
    float lit = max(dot(n, normalize(vec3(-0.6, 0.3, 0.72))), 0.0);
    float cr = fbm(p * 34.0 + 3.0);
    float lum = lit * (0.7 + 0.4 * smoothstep(0.3, 0.7, cr)) - 0.22 * smoothstep(0.58, 0.72, cr);
    if (lum < 0.07) { g = lit > 0.0 ? G_DOT : G_SPACE; return vec3(0.3, 0.33, 0.42) * 0.5; }
    g = PICK(R_MOON, lum);
    return vec3(0.96, 0.93, 0.84) * (0.4 + 0.8 * lum);
  }
  float halo = exp(-(r - moonR) * 12.0);
  vec2 q = vec2(uv.x * uAspect * 1.4, uv.y * 8.0) + vec2(uTime * 0.012, 0.0);
  float cl = smoothstep(0.56, 0.86, fbm(q));
  float lum = cl * (0.4 + 0.6 * halo) + halo * 0.12;
  g = cl > 0.12 ? PICK(R_CLOUD, cl * 0.9 + 0.1) : (halo > 0.35 ? G_MIDDOT : G_SPACE);
  return mix(vec3(0.28, 0.33, 0.46), vec3(0.85, 0.8, 0.7), halo) * (0.25 + lum * 1.6);
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  vec4 ov = texelFetch(tOverlay, cell, 0);
  float og = floor(ov.a * 255.0 + 0.5);
  if (og > 0.5) {
    outColor = vec4(ov.rgb, (og - 1.0) / 255.0);
    outGlow = vec4(ov.rgb * 0.22, 1.0);
    return;
  }

  ivec2 base = cell * ivec2(${SX}, ${SY});
  ivec2 smax = ivec2(uScene) - 1;
  vec4 C[20];
  vec4 N[20];
  for (int j = 0; j < 5; j++) {
    for (int i = 0; i < 4; i++) {
      ivec2 p = clamp(base + ivec2(i - 1, j - 1), ivec2(0), smax);
      C[j * 4 + i] = texelFetch(tColor, p, 0);
      N[j * 4 + i] = texelFetch(tInfo, p, 0);
    }
  }
  int ids[6] = int[6](5, 6, 9, 10, 13, 14);
  int mats[6];
  for (int k = 0; k < 6; k++) mats[k] = int(C[ids[k]].a + 0.5);

  // dominant material and foreground (nearest) sub-sample
  int domK = 0; int best = -1;
  int fgK = 0; float fgD = 1e9;
  for (int a = 0; a < 6; a++) {
    int cnt = 0;
    for (int b = 0; b < 6; b++) cnt += (mats[a] == mats[b]) ? 1 : 0;
    if (cnt > best) { best = cnt; domK = a; }
    if (mats[a] != M_VOID && N[ids[a]].a < fgD) { fgD = N[ids[a]].a; fgK = a; }
  }
  // tiny emissive parts (eyes, lamps, tracers) win the cell so they never vanish
  for (int k = 0; k < 6; k++) {
    int mk = mats[k];
    if ((mk == M_GLOW || mk == M_FIRE) && luma(tonemap(C[ids[k]].rgb)) > 0.35) { domK = k; best = 0; break; }
  }
  int dom = mats[domK];

  vec2 ndc = (vec2(cell) + 0.5) / uGrid * 2.0 - 1.0;
  vec2 uv = (vec2(cell) + 0.5) / uGrid;

  vec3 outC = vec3(0.0);
  vec3 glow = vec3(0.0);
  int g = G_SPACE;
  vec3 wp = worldFromDepth(ndc, N[ids[domK]].a);

  if (dom == M_VOID) {
    outColor = vec4(0.0);
    outGlow = vec4(0.0);
    return;
  }

  // ---------------------------------------------------------------- edges
  float edgeN = 0.0;
  vec3 J = vec3(0.0);
  int fgMat = mats[fgK];
  // ground and characters read better as texture/fill than as outlines
  bool soft = (fgMat == M_WATER || fgMat == M_FIRE || fgMat == M_GLOW || fgMat == M_SAND || fgMat == M_CRACKED || fgMat == M_ASPHALT || fgMat == M_PAINT
    || fgMat == M_PLAYER || fgMat == M_CLOTH || fgMat == M_ENEMY || fgMat == M_TOXIC);
  if (!soft) {
    for (int k = 0; k < 6; k++) {
      int c = ids[k];
      int l = c - 1; int r = c + 1; int u = c + 4; int d = c - 4;
      float dc = N[c].a;
      float lap = abs(N[l].a + N[r].a + N[u].a + N[d].a - 4.0 * dc);
      vec3 nc = N[c].xyz;
      float nd = max(max(1.0 - dot(nc, N[l].xyz), 1.0 - dot(nc, N[r].xyz)), max(1.0 - dot(nc, N[u].xyz), 1.0 - dot(nc, N[d].xyz)));
      if (lap > uDepthEdge || nd > uNormEdge) {
        edgeN += 1.0;
        float tl = N[u - 1].a, tt = N[u].a, tr = N[u + 1].a, ml = N[l].a, mr = N[r].a, bl = N[d - 1].a, bb = N[d].a, br = N[d + 1].a;
        vec2 gd = vec2((tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl), (tl + 2.0 * tt + tr) - (bl + 2.0 * bb + br)) / uTexelPx;
        float wd = min(lap / uDepthEdge, 3.0);
        J += vec3(gd.x * gd.x, gd.y * gd.y, gd.x * gd.y) * wd;
        for (int q = 0; q < 3; q++) {
          float a0 = N[u - 1][q], a1 = N[u][q], a2 = N[u + 1][q], b0 = N[l][q], b2 = N[r][q], c0 = N[d - 1][q], c1 = N[d][q], c2 = N[d + 1][q];
          vec2 gn = vec2((a2 + 2.0 * b2 + c2) - (a0 + 2.0 * b0 + c0), (a0 + 2.0 * a1 + a2) - (c0 + 2.0 * c1 + c2)) / uTexelPx;
          J += vec3(gn.x * gn.x, gn.y * gn.y, gn.x * gn.y) * 40.0;
        }
      }
    }
  }

  // character silhouettes: match sub-cell coverage against glyph shapes (Harri-style)
  int charN = 0;
  for (int k = 0; k < 6; k++) charN += isChar(mats[k]) ? 1 : 0;
  bool silhouette = charN > 0 && charN < 6 && isChar(fgMat) && dom != M_GLOW && dom != M_FIRE && uShapeAmt > 0.0;

  if (silhouette) {
    vec3 cc = vec3(0.0); float mx = 0.0;
    float cov[6];
    for (int k = 0; k < 6; k++) {
      bool ch = isChar(mats[k]);
      cov[k] = ch ? 1.0 : 0.0;
      if (ch) { vec3 t = tonemap(C[ids[k]].rgb); cc += t; mx = max(mx, luma(t)); }
    }
    cc /= float(charN);
    float dens = clamp(0.45 + mx, 0.5, 1.0);
    // ids order: (1,1) (2,1) (1,2) (2,2) (1,3) (2,3); shapes are [top, mid, bottom] per column
    vec3 tL = vec3(cov[4], cov[2], cov[0]) * dens;
    vec3 tR = vec3(cov[5], cov[3], cov[1]) * dens;
    float bd = 1e9; int bi = 0;
    for (int s = 0; s < ${SHAPE_N}; s++) {
      vec3 dl = tL - uShapeL[s];
      vec3 dr = tR - uShapeR[s];
      float dd = dot(dl, dl) + dot(dr, dr);
      if (dd < bd) { bd = dd; bi = uShapeIdx[s]; }
    }
    g = bi;
    outC = cc * 1.15;
  } else if (edgeN >= 2.0 && J.x + J.y > 1e-8 && dom != M_WATER && dom != M_GLOW && dom != M_FIRE) {
    float theta = 0.5 * atan(2.0 * J.z, J.x - J.y);
    vec2 tang = vec2(-sin(theta), cos(theta));
    g = dirGlyph(tang);
    vec3 fc = vec3(0.0); float fn = 0.0;
    for (int k = 0; k < 6; k++) {
      if (mats[k] == fgMat && abs(N[ids[k]].a - fgD) < 1.5) { fc += C[ids[k]].rgb; fn += 1.0; }
    }
    outC = tonemap(fc / max(fn, 1.0)) * 1.25;
    if (luma(outC) < 0.025) g = G_SPACE;
    if (fgMat == M_TOXIC) glow = outC * 0.4;
  } else if (dom == M_WATER) {
    // ------------------------------------------------------------ water
    vec3 wcol = vec3(0.0); float wn = 0.0;
    for (int k = 0; k < 6; k++) if (mats[k] == M_WATER) { wcol += C[ids[k]].rgb; wn += 1.0; }
    wcol = tonemap(wcol / max(wn, 1.0));
    float wl = luma(wcol);

    float ringA = 0.0; int ringG = G_SPACE; vec2 disp = vec2(0.0);
    for (int i = 0; i < ${RIPPLE_N}; i++) {
      vec4 R = uRipples[i];
      float age = uTime - R.z;
      if (R.w <= 0.0 || age < 0.0 || age > 3.2) continue;
      vec2 dv = wp.xz - R.xy;
      float dist = length(dv);
      float fade = (1.0 - age / 3.2) * R.w;
      for (int k = 0; k < 3; k++) {
        float rad = age * 1.5 - float(k) * 0.5;
        if (rad <= 0.05) continue;
        float w = 0.08 + 0.05 * age;
        float ring = 1.0 - smoothstep(w * 0.35, w, abs(dist - rad));
        float a = ring * fade * (1.0 - float(k) * 0.3);
        disp += (dv / max(dist, 1e-3)) * ring * fade;
        if (a > ringA) {
          ringA = a;
          vec3 tw = vec3(-dv.y, 0.0, dv.x) / max(dist, 1e-3);
          vec2 ts = screenDir(tw);
          vec2 side = screenDir(vec3(dv.x, 0.0, dv.y));
          float ad = degrees(abs(atan(ts.y, ts.x)));
          if (ad > 90.0) ad = 180.0 - ad;
          if (ad > 64.0) ringG = side.x < 0.0 ? G_LPAR : G_RPAR;
          else if (ad < 20.0) ringG = side.y > 0.0 ? G_TILDE : G_DASH;
          else ringG = dirGlyph(ts);
        }
      }
    }

    float wob = sin(float(cell.y) * 1.7 + uTime * 2.1) * 0.7 + sin(float(cell.y) * 0.37 - uTime * 0.9) * 0.6;
    ivec2 rp = clamp(base + ivec2(1, 1) + ivec2(round(vec2(wob, 0.0) + disp * vec2(2.5, 3.0))), ivec2(0), smax);
    vec4 rc = texelFetch(tRColor, rp, 0);
    int rm = int(rc.a + 0.5);
    vec3 rcol; int rg;
    if (rm == M_VOID) {
      rcol = skyRefl(uv + vec2(wob * 0.0015, 0.0), rg);
    } else {
      rcol = tonemap(rc.rgb) * vec3(0.62, 0.8, 0.78);
      rg = styleGlyph(rm, luma(rcol) * 1.1, wp + vec3(0.0, float(cell.y) * 0.21, 0.0), vec3(0.0, 0.0, 1.0), vec2(cell), rcol);
    }
    float rl = luma(rcol);

    // the surface itself: dashed horizontal scan rows
    float hx = hash12(vec2(floor(wp.x * 2.0 + wp.z * 2.0 + uTime * 0.6), float(cell.y)));
    int bgG = (cell.y % 2 == 0) ? (hx > 0.35 ? G_DASH : G_SPACE) : (hx > 0.8 ? G_TILDE : G_SPACE);
    vec3 bgC = vec3(0.32, 0.46, 0.5) * (0.18 + wl * 2.2);

    if (ringA > 0.28) { g = ringG; outC = vec3(0.78, 0.92, 0.95) * (0.35 + ringA * 0.9) + wcol * 0.5; glow = outC * 0.2; }
    else if (rg != G_SPACE && rl > 0.05) {
      g = rg; outC = rcol * 1.25;
      if (rm == M_VOID) glow = rcol * smoothstep(0.45, 0.9, rl) * 0.55;
      else if (rm == M_FIRE || rm == M_GLOW) glow = rcol * 0.5;
    }
    else { g = bgG; outC = bgC; }
    float bub = hash13(vec3(vec2(cell), floor(uTime * 2.0)));
    if (bub > 0.9975) { g = G_O; outC = vec3(0.45, 0.95, 0.4); }
  } else {
    // ----------------------------------------------------------- surfaces
    vec3 col = vec3(0.0); float cn = 0.0;
    for (int k = 0; k < 6; k++) if (mats[k] == dom) { col += C[ids[k]].rgb; cn += 1.0; }
    col = tonemap(col / max(cn, 1.0));
    float l = luma(col);
    vec3 nV = N[ids[domK]].xyz;
    vec3 nW = normalize(uCamRight * nV.x + uCamUp * nV.y - uCamFwd * nV.z);
    outC = col;

    // shape-vector matching for strong light/dark contrast inside one surface
    bool shaped = false;
    if (uShapeAmt > 0.0 && best == 6 && dom != M_FIRE && dom != M_GLOW && dom != M_SCRUB) {
      vec3 sL = vec3(luma(tonemap(C[13].rgb)), luma(tonemap(C[9].rgb)), luma(tonemap(C[5].rgb)));
      vec3 sR = vec3(luma(tonemap(C[14].rgb)), luma(tonemap(C[10].rgb)), luma(tonemap(C[6].rgb)));
      float mx = max(max(max(sL.x, sL.y), sL.z), max(max(sR.x, sR.y), sR.z));
      float mn = min(min(min(sL.x, sL.y), sL.z), min(min(sR.x, sR.y), sR.z));
      if (mx > 0.1 && (mx - mn) > 0.5 * mx) {
        float dens = clamp(mx * 1.3, 0.35, 1.0) * uShapeAmt;
        vec3 tL = (sL - mn) / (mx - mn) * dens;
        vec3 tR = (sR - mn) / (mx - mn) * dens;
        float bd = 1e9; int bi = 0;
        for (int s = 0; s < ${SHAPE_N}; s++) {
          vec3 dl = tL - uShapeL[s];
          vec3 dr = tR - uShapeR[s];
          float dd = dot(dl, dl) + dot(dr, dr);
          if (dd < bd) { bd = dd; bi = uShapeIdx[s]; }
        }
        g = bi;
        outC = col * (1.0 / max(l, 0.08)) * mx;
        shaped = true;
      }
    }
    if (!shaped) g = styleGlyph(dom, l, wp, nW, vec2(cell), outC);
    if (dom == M_FIRE || dom == M_GLOW) glow = outC * 0.9;
    else if (dom == M_TOXIC) glow = outC * 0.45;

    // decals: footprints, blood, scorch
    if (nW.y > 0.6 && (dom == M_SAND || dom == M_CRACKED || dom == M_ASPHALT || dom == M_PAINT || dom == M_ROCK)) {
      for (int i = 0; i < ${DECAL_N}; i++) {
        vec4 dc = uDecals[i];
        if (dc.w <= 0.0) continue;
        vec2 dv = wp.xz - dc.xy;
        float r2 = dot(dv, dv);
        if (dc.z < 0.5) {
          if (r2 < 0.035) { g = l > 0.04 ? G_DOT : G_SPACE; outC *= 0.55; }
        } else if (dc.z < 1.5) {
          if (r2 < 0.3 * dc.w) { g = hash12(floor(wp.xz * 6.0)) > 0.5 ? G_COMMA : G_DOT; outC = vec3(0.55, 0.08, 0.06) * (0.4 + l); }
        } else {
          if (r2 < 0.9 * dc.w) { outC *= 0.35; g = l > 0.08 ? G_DOT : G_SPACE; }
        }
      }
    }
  }

  // ------------------------------------------------------------ dust storm
  if (uStorm > 0.01) {
    vec2 wperp = vec2(-uWind.y, uWind.x);
    float along = dot(wp.xz, uWind);
    float across = dot(wp.xz, wperp);
    float d = fbm(vec2(along * 0.12 - uTime * (0.8 + uStorm * 2.5), across * 0.25));
    float streak = vnoise(vec2(along * 0.6 - uTime * (6.0 + uStorm * 10.0), across * 3.5));
    float dust = smoothstep(0.62 - uStorm * 0.32, 0.95, d * 0.6 + streak * 0.55) * uStorm;
    vec3 dcol = vec3(0.78, 0.56, 0.36) * (0.4 + 0.65 * d);
    outC = mix(outC, dcol, clamp(dust * 0.9, 0.0, 1.0));
    if (dust > 0.35 && hash12(vec2(cell) + floor(uTime * 8.0)) > 0.45) {
      vec2 ws = screenDir(vec3(uWind.x, 0.0, uWind.y));
      g = streak > 0.75 ? dirGlyph(ws) : (streak > 0.6 ? G_TILDE : G_DOT);
    }
  }

  outC = clamp(outC * uGain, 0.0, 1.0);
  if (g != G_SPACE && luma(outC) < 0.012) g = G_SPACE;
  outColor = vec4(outC, float(g) / 255.0);
  outGlow = vec4(glow * (g == G_SPACE ? 0.35 : 1.0), 1.0);
}
`;

// Extract bright cells into a half-resolution glow buffer.
export const BRIGHT_FRAG = /* glsl */ `
precision highp float;
out vec4 outColor;
uniform sampler2D tCells;
uniform vec2 uGrid;
void main() {
  ivec2 o = ivec2(gl_FragCoord.xy) * 2;
  vec3 s = vec3(0.0);
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    ivec2 p = min(o + ivec2(i, j), ivec2(uGrid) - 1);
    s += texelFetch(tCells, p, 0).rgb;
  }
  outColor = vec4(s * 0.25, 1.0);
}
`;

export const BLUR_FRAG = /* glsl */ `
precision highp float;
out vec4 outColor;
uniform sampler2D tSrc;
uniform vec2 uDir;
uniform vec2 uSize;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec2 st = uDir / uSize;
  vec3 s = texture(tSrc, uv).rgb * 0.227;
  s += (texture(tSrc, uv + st * 1.38).rgb + texture(tSrc, uv - st * 1.38).rgb) * 0.316;
  s += (texture(tSrc, uv + st * 3.23).rgb + texture(tSrc, uv - st * 3.23).rgb) * 0.07;
  outColor = vec4(s, 1.0);
}
`;

export const GLYPH_FRAG = /* glsl */ `
precision highp float;
out vec4 outColor;
uniform sampler2D tCells;
uniform sampler2D tGlow;
uniform sampler2D tAtlas;
uniform vec2 uCellPx;
uniform vec2 uGrid;
uniform vec2 uOffsetPx;
uniform vec2 uAtlasGrid;
uniform vec2 uViewPx;
uniform float uGlow;
uniform float uHurt;
uniform float uFade;
uniform float uScan;
uniform vec3 uHaze;
void main() {
  vec2 px = gl_FragCoord.xy + uOffsetPx;
  vec2 cf = px / uCellPx;
  ivec2 cell = ivec2(floor(cf));
  vec2 local = fract(cf);
  vec4 cd = texelFetch(tCells, clamp(cell, ivec2(0), ivec2(uGrid) - 1), 0);
  float g = floor(cd.a * 255.0 + 0.5);
  float col = mod(g, uAtlasGrid.x);
  float row = floor(g / uAtlasGrid.x);
  vec2 auv = vec2((col + local.x) / uAtlasGrid.x, (uAtlasGrid.y - 1.0 - row + local.y) / uAtlasGrid.y);
  float a = texture(tAtlas, auv).r;
  vec3 c = cd.rgb * a;
  // airborne dust fills the gaps between glyphs during the storm
  float hz = 0.75 + 0.25 * sin(cf.x * 0.11 + cf.y * 0.07 + uHaze.r * 40.0);
  c += uHaze * hz * (1.0 - a * 0.6);
  vec3 glow = texture(tGlow, px / (uGrid * uCellPx)).rgb;
  c += glow * uGlow;
  vec2 uv = gl_FragCoord.xy / uViewPx;
  vec2 q = (uv - 0.5) * vec2(uViewPx.x / uViewPx.y, 1.0);
  float vig = 1.0 - smoothstep(0.45, 1.25, length(q));
  c *= mix(0.55, 1.0, vig);
  c *= 1.0 - uScan * (0.5 - 0.5 * cos(local.y * 6.2831));
  float edge = smoothstep(0.35, 1.0, length(q));
  c = mix(c, c + vec3(0.5, 0.0, 0.0) * edge, uHurt);
  c *= uFade;
  outColor = vec4(c, 1.0);
}
`;
