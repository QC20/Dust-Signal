import {
  WebGLRenderer,
  WebGLRenderTarget,
  HalfFloatType,
  UnsignedByteType,
  NearestFilter,
  LinearFilter,
  RGBAFormat,
  ShaderMaterial,
  GLSL3,
  Mesh,
  PlaneGeometry,
  OrthographicCamera,
  Scene,
  Vector2,
  Vector3,
  Vector4,
  Object3D,
} from 'three';
import { buildAtlas, Atlas, ATLAS_COLS, ATLAS_ROWS, SHAPE_SET, gi } from './glyphs';
import { CELL_FRAG, BRIGHT_FRAG, BLUR_FRAG, GLYPH_FRAG, FULLSCREEN_VERT, SX, SY, RIPPLE_N, DECAL_N, SHAPE_N } from './shaders';
import type { Globals } from './materials';
import { Overlay } from './overlay';
import type { IsoCamera } from './IsoCamera';

class FSQuad {
  private scene = new Scene();
  private cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mesh: Mesh;
  constructor() {
    this.mesh = new Mesh(new PlaneGeometry(2, 2));
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }
  render(r: WebGLRenderer, mat: ShaderMaterial, target: WebGLRenderTarget | null) {
    this.mesh.material = mat;
    r.setRenderTarget(target);
    r.render(this.scene, this.cam);
  }
}

function pass(frag: string, uniforms: Record<string, { value: unknown }>) {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: frag,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
}

export const DENSITIES = [
  { w: 6, h: 10, name: 'FINE' },
  { w: 7, h: 12, name: 'NORMAL' },
  { w: 8, h: 14, name: 'COARSE' },
  { w: 10, h: 17, name: 'CHUNKY' },
];

export interface FrameParams {
  scene: Scene;
  worldRoot: Object3D;
  water: Object3D;
  camera: IsoCamera;
  globals: Globals;
  time: number;
  ripples: Vector4[];
  decals: Vector4[];
  storm: number;
  wind: Vector2;
  hurt: number;
  fade: number;
}

export class AsciiRenderer {
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  dpr = 1;
  density = 1;
  cellPxW = 7;
  cellPxH = 12;
  cols = 1;
  rows = 1;
  viewW = 1;
  viewH = 1;
  overlay!: Overlay;
  atlas!: Atlas;
  shapeAmt = 1;
  glowAmt = 1.1;

  private sceneRT!: WebGLRenderTarget;
  private reflRT!: WebGLRenderTarget;
  private cellRT!: WebGLRenderTarget;
  private glowA!: WebGLRenderTarget;
  private glowB!: WebGLRenderTarget;
  private quad = new FSQuad();
  private cellMat: ShaderMaterial;
  private brightMat: ShaderMaterial;
  private blurMat: ShaderMaterial;
  private glyphMat: ShaderMaterial;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.autoClear = false;
    this.renderer.setPixelRatio(1);

    const shapeL = Array.from({ length: SHAPE_N }, () => new Vector3());
    const shapeR = Array.from({ length: SHAPE_N }, () => new Vector3());
    const shapeIdx = [...SHAPE_SET].map(gi);

    this.cellMat = pass(CELL_FRAG, {
      tColor: { value: null },
      tInfo: { value: null },
      tRColor: { value: null },
      tOverlay: { value: null },
      uGrid: { value: new Vector2() },
      uScene: { value: new Vector2() },
      uTime: { value: 0 },
      uCamPos: { value: new Vector3() },
      uCamRight: { value: new Vector3() },
      uCamUp: { value: new Vector3() },
      uCamFwd: { value: new Vector3() },
      uHalf: { value: new Vector2() },
      uDepthBias: { value: 150 },
      uTexelPx: { value: new Vector2() },
      uRipples: { value: Array.from({ length: RIPPLE_N }, () => new Vector4()) },
      uDecals: { value: Array.from({ length: DECAL_N }, () => new Vector4()) },
      uPlayer: { value: new Vector3() },
      uStorm: { value: 0 },
      uWind: { value: new Vector2(1, 0) },
      uMoonUV: { value: new Vector2(0.78, 0.3) },
      uAspect: { value: 1 },
      uExposure: { value: 1.2 },
      uGain: { value: 1.5 },
      uShapeAmt: { value: 1 },
      uDepthEdge: { value: 0.35 },
      uNormEdge: { value: 0.3 },
      uShapeL: { value: shapeL },
      uShapeR: { value: shapeR },
      uShapeIdx: { value: shapeIdx },
    });
    this.brightMat = pass(BRIGHT_FRAG, { tCells: { value: null }, uGrid: { value: new Vector2() } });
    this.blurMat = pass(BLUR_FRAG, { tSrc: { value: null }, uDir: { value: new Vector2(1, 0) }, uSize: { value: new Vector2() } });
    this.glyphMat = pass(GLYPH_FRAG, {
      tCells: { value: null },
      tGlow: { value: null },
      tAtlas: { value: null },
      uCellPx: { value: new Vector2() },
      uGrid: { value: new Vector2() },
      uOffsetPx: { value: new Vector2() },
      uAtlasGrid: { value: new Vector2(ATLAS_COLS, ATLAS_ROWS) },
      uViewPx: { value: new Vector2() },
      uGlow: { value: 0.9 },
      uHurt: { value: 0 },
      uFade: { value: 1 },
      uScan: { value: 0.12 },
      uHaze: { value: new Vector3() },
    });
  }

  /** Recompute grid size, render targets and glyph atlas. */
  resize(cssW: number, cssH: number, density = this.density) {
    this.density = density;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const d = DENSITIES[density] ?? DENSITIES[1];
    // On small screens make glyphs a little bigger so they stay legible.
    const small = Math.min(cssW, cssH) < 520 ? 1 : 0;
    const cw = d.w + small;
    const ch = d.h + small * 2;
    this.cellPxW = Math.round(cw * this.dpr);
    this.cellPxH = Math.round(ch * this.dpr);
    this.viewW = Math.max(1, Math.floor(cssW * this.dpr));
    this.viewH = Math.max(1, Math.floor(cssH * this.dpr));
    this.renderer.setSize(this.viewW, this.viewH, false);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.cols = Math.ceil(this.viewW / this.cellPxW);
    this.rows = Math.ceil(this.viewH / this.cellPxH);

    const sw = this.cols * SX;
    const sh = this.rows * SY;
    this.sceneRT?.dispose();
    this.reflRT?.dispose();
    this.cellRT?.dispose();
    this.glowA?.dispose();
    this.glowB?.dispose();
    const mrt = {
      count: 2,
      type: HalfFloatType,
      format: RGBAFormat,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
      depthBuffer: true,
    } as const;
    this.sceneRT = new WebGLRenderTarget(sw, sh, mrt);
    this.reflRT = new WebGLRenderTarget(sw, sh, mrt);
    this.cellRT = new WebGLRenderTarget(this.cols, this.rows, {
      count: 2,
      type: UnsignedByteType,
      format: RGBAFormat,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
      depthBuffer: false,
    });
    const gw = Math.ceil(this.cols / 2);
    const gh = Math.ceil(this.rows / 2);
    const glowOpts = { type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false, depthBuffer: false } as const;
    this.glowA = new WebGLRenderTarget(gw, gh, glowOpts);
    this.glowB = new WebGLRenderTarget(gw, gh, glowOpts);

    this.atlas?.texture.dispose();
    this.atlas = buildAtlas(this.cellPxW, this.cellPxH);
    const sL = this.cellMat.uniforms.uShapeL.value as Vector3[];
    const sR = this.cellMat.uniforms.uShapeR.value as Vector3[];
    [...SHAPE_SET].forEach((ch, i) => {
      const k = gi(ch) * 6;
      const s = this.atlas.shapes;
      sL[i].set(s[k], s[k + 1], s[k + 2]);
      sR[i].set(s[k + 3], s[k + 4], s[k + 5]);
    });

    this.overlay?.dispose();
    this.overlay = new Overlay(this.cols, this.rows);

    const u = this.cellMat.uniforms;
    (u.uGrid.value as Vector2).set(this.cols, this.rows);
    (u.uScene.value as Vector2).set(sw, sh);
    (u.uTexelPx.value as Vector2).set(this.cellPxW / SX, this.cellPxH / SY);
    u.uAspect.value = (this.cols * this.cellPxW) / (this.rows * this.cellPxH);
    (this.brightMat.uniforms.uGrid.value as Vector2).set(this.cols, this.rows);
    const g = this.glyphMat.uniforms;
    (g.uCellPx.value as Vector2).set(this.cellPxW, this.cellPxH);
    (g.uGrid.value as Vector2).set(this.cols, this.rows);
    (g.uOffsetPx.value as Vector2).set(Math.floor((this.cols * this.cellPxW - this.viewW) / 2), Math.floor((this.rows * this.cellPxH - this.viewH) / 2));
    (g.uViewPx.value as Vector2).set(this.viewW, this.viewH);
    g.tAtlas.value = this.atlas.texture;
  }

  /** World-space aspect ratio of the full cell grid. */
  get gridAspect() {
    return (this.cols * this.cellPxW) / (this.rows * this.cellPxH);
  }

  render(p: FrameParams) {
    const r = this.renderer;
    const cam = p.camera.cam;
    const G = p.globals;
    G.uDepthBias.value = p.camera.dist;

    // 1. mirrored world for water reflections
    const root = p.worldRoot;
    root.scale.y = -1;
    root.position.y = 2 * G.uWaterH.value;
    p.water.visible = false;
    G.uMirror.value = 1;
    r.setRenderTarget(this.reflRT);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(p.scene, cam);
    root.scale.y = 1;
    root.position.y = 0;
    p.water.visible = true;
    G.uMirror.value = 0;

    // 2. main scene: lit color + material id, normals + depth
    r.setRenderTarget(this.sceneRT);
    r.clear(true, true, false);
    r.render(p.scene, cam);

    // 3. ASCII cell pass
    this.overlay.upload();
    const u = this.cellMat.uniforms;
    u.tColor.value = this.sceneRT.textures[0];
    u.tInfo.value = this.sceneRT.textures[1];
    u.tRColor.value = this.reflRT.textures[0];
    u.tOverlay.value = this.overlay.texture;
    u.uTime.value = p.time;
    (u.uCamPos.value as Vector3).copy(cam.position);
    (u.uCamRight.value as Vector3).copy(p.camera.right);
    (u.uCamUp.value as Vector3).copy(p.camera.up);
    (u.uCamFwd.value as Vector3).copy(p.camera.fwd);
    (u.uHalf.value as Vector2).set(cam.right, cam.top);
    u.uDepthBias.value = p.camera.dist;
    (u.uPlayer.value as Vector3).copy(G.uPlayer.value);
    u.uStorm.value = p.storm;
    (u.uWind.value as Vector2).copy(p.wind);
    u.uShapeAmt.value = this.shapeAmt;
    const rip = u.uRipples.value as Vector4[];
    for (let i = 0; i < RIPPLE_N; i++) rip[i].copy(p.ripples[i] ?? rip[i].set(0, 0, 0, 0));
    const dec = u.uDecals.value as Vector4[];
    for (let i = 0; i < DECAL_N; i++) dec[i].copy(p.decals[i] ?? dec[i].set(0, 0, 0, 0));
    this.quad.render(r, this.cellMat, this.cellRT);

    // 4. glow
    this.brightMat.uniforms.tCells.value = this.cellRT.textures[1];
    this.quad.render(r, this.brightMat, this.glowA);
    const b = this.blurMat.uniforms;
    (b.uSize.value as Vector2).set(this.glowA.width, this.glowA.height);
    b.tSrc.value = this.glowA.texture;
    (b.uDir.value as Vector2).set(1, 0);
    this.quad.render(r, this.blurMat, this.glowB);
    b.tSrc.value = this.glowB.texture;
    (b.uDir.value as Vector2).set(0, 1);
    this.quad.render(r, this.blurMat, this.glowA);

    // 5. draw glyphs to the screen
    const g = this.glyphMat.uniforms;
    g.tCells.value = this.cellRT.textures[0];
    g.tGlow.value = this.glowA.texture;
    g.uGlow.value = this.glowAmt;
    g.uHurt.value = p.hurt;
    g.uFade.value = p.fade;
    (g.uHaze.value as Vector3).set(0.5, 0.33, 0.19).multiplyScalar(p.storm * p.storm * 0.17);
    this.quad.render(r, this.glyphMat, null);
  }

  /** Expose the cell data texture to read the shape uniforms in tests. */
  get cellUniforms() {
    return this.cellMat.uniforms;
  }
}

