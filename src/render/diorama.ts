import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { HorizontalTiltShiftShader } from 'three/examples/jsm/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/examples/jsm/shaders/VerticalTiltShiftShader.js';
import { maxCrestHeight } from '../sim/dam';
import { seasonOfMonth, type Season } from '../sim/calendar';
import { crestOf } from '../sim/dam';
import type { World } from '../sim/world';
import { COLORS, SEASON_COLORS } from './palette';

const WET = 0.03;
/** 높이 과장 배율 (미니어처처럼 보이게) */
export const VS = 1.3;

function hash01(a: number, b: number): number {
  let h = Math.imul(a * 374761393 + b * 668265263, 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface DamVisual {
  group: THREE.Group;
  key: string;
}

interface Splash {
  points: THREE.Points;
  vel: Float32Array;
  life: number;
}

/**
 * 탁자 위 미니어처 디오라마. 시뮬레이션 상태를 읽어서 그리기만 한다.
 */
export class Diorama {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private composer: EffectComposer;
  private tiltH: ShaderPass;
  private tiltV: ShaderPass;
  tiltShift = false;

  private world!: World;
  private W = 0;
  private H = 0;
  private baseY = 0;
  private terrainGeo!: THREE.BufferGeometry;
  private terrainMesh!: THREE.Mesh;
  private skirt!: THREE.Mesh;
  private waterGeo!: THREE.BufferGeometry;
  private waterMesh!: THREE.Mesh;
  private stageGroup = new THREE.Group();
  private dams: (DamVisual | null)[] = [];
  private markers: THREE.Group[] = [];
  private houses!: THREE.InstancedMesh;
  private roofs!: THREE.InstancedMesh;
  private houseCells: { cell: number; town: number; fac: number; rot: number; x: number; z: number; ground: number }[] = [];
  private treeFoliage!: THREE.InstancedMesh;
  private treeTrunks!: THREE.InstancedMesh;
  private treeCells: number[] = [];
  private rain!: THREE.LineSegments;
  private rainPos!: Float32Array;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private season: Season | null = null;
  private selectRing: THREE.Mesh;
  private gateSprays: (THREE.Mesh | null)[] = [];
  private splashes: Splash[] = [];
  private shake = 0;
  private rainLevel = 0;
  /** 카메라 이동 애니메이션 */
  private camTween: { from: THREE.Vector3; to: THREE.Vector3; fromPos: THREE.Vector3; toPos: THREE.Vector3; t: number; dur: number } | null = null;
  pickables: THREE.Object3D[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.background = new THREE.Color(COLORS.background);
    this.scene.fog = new THREE.Fog(COLORS.background, 260, 520);

    this.camera = new THREE.PerspectiveCamera(32, 16 / 9, 1, 1200);
    this.camera.position.set(0, 110, 120);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 30;
    this.controls.maxDistance = 260;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.screenSpacePanning = false;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    this.hemi = new THREE.HemisphereLight('#fff1d6', '#7a5a3a', 0.75);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#ffd9a8', 2.9);
    this.sun.position.set(-70, 110, 55);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -100;
    sc.right = 100;
    sc.top = 70;
    sc.bottom = -70;
    sc.near = 10;
    sc.far = 320;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.4;
    this.sun.shadow.radius = 4;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.scene.add(this.makeTable());
    this.scene.add(this.stageGroup);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 2.8, 32),
      new THREE.MeshBasicMaterial({ color: '#ffd84a', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 10;
    ring.visible = false;
    this.selectRing = ring;
    this.scene.add(ring);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.tiltH = new ShaderPass(HorizontalTiltShiftShader);
    this.tiltV = new ShaderPass(VerticalTiltShiftShader);
    this.tiltH.uniforms.r.value = 0.55;
    this.tiltV.uniforms.r.value = 0.55;
    this.composer.addPass(this.tiltH);
    this.composer.addPass(this.tiltV);
    this.composer.addPass(new OutputPass());
  }

  private makeTable(): THREE.Mesh {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const g = c.getContext('2d')!;
    g.fillStyle = COLORS.table;
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 90; i++) {
      const y = (i / 90) * 512 + Math.sin(i * 1.7) * 3;
      g.strokeStyle = `rgba(${90 + (i % 5) * 8}, ${55 + (i % 3) * 6}, 30, ${0.12 + (i % 4) * 0.04})`;
      g.lineWidth = 1 + (i % 3);
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x / 60 + i) * 4);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshLambertMaterial({ map: tex }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.01;
    mesh.receiveShadow = true;
    mesh.name = 'table';
    return mesh;
  }

  /** 셀 좌표 → 월드 좌표 */
  cellToWorld(x: number, y: number, h = 0): THREE.Vector3 {
    return new THREE.Vector3(x - this.W / 2 + 0.5, (h - this.baseY) * VS, y - this.H / 2 + 0.5);
  }

  setWorld(world: World): void {
    this.world = world;
    this.W = world.terrain.w;
    this.H = world.terrain.h;
    let minG = Infinity;
    for (const g of world.terrain.ground) minG = Math.min(minG, g);
    this.baseY = minG - 3;
    this.stageGroup.clear();
    this.pickables = [];
    this.dams = world.sites.map(() => null);
    this.markers = [];
    this.gateSprays = world.sites.map(() => null);
    this.season = null;
    this.buildTerrain();
    this.buildWater();
    this.buildTowns();
    this.buildTrees();
    this.buildMarkers();
    this.buildRain();
    this.sun.target.position.set(0, 0, 0);
    this.resetCamera();
    this.update(0);
  }

  resetCamera(): void {
    this.camTween = null;
    this.controls.target.set(0, 6, 4);
    this.camera.position.set(0, 122, 106);
    this.controls.update();
  }

  private buildTerrain(): void {
    const { W, H } = this;
    const pos = new Float32Array(W * H * 3);
    const g = this.world.terrain.ground;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const p = this.cellToWorld(x, y, g[i]);
        pos[i * 3] = p.x;
        pos[i * 3 + 1] = p.y;
        pos[i * 3 + 2] = p.z;
      }
    }
    const idx: number[] = [];
    for (let y = 0; y < H - 1; y++) {
      for (let x = 0; x < W - 1; x++) {
        const a = y * W + x;
        const b = a + 1;
        const c = a + W;
        const d = c + 1;
        if ((x + y) % 2 === 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, c, d, a, d, b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(W * H * 3), 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.terrainGeo = geo;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.terrainMesh = new THREE.Mesh(geo, mat);
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.castShadow = true;
    this.terrainMesh.name = 'terrain';
    this.stageGroup.add(this.terrainMesh);

    // 옆면 흙 단면 (층층이 색이 다른 띠)
    const sp: number[] = [];
    const sc: number[] = [];
    const sidx: number[] = [];
    // 지층 경계(월드 높이). 각 띠는 색이 일정해서 또렷한 줄무늬가 된다.
    const strata = [0, 3.2, 7.5, 11, 15.5, 21, 27, 60];
    const grassCol = new THREE.Color('#6f9a45');
    const edge = (cells: [number, number][]) => {
      const bands = strata.length; // 지층 strata.length-1개 + 풀 띠 1개
      const start = sp.length / 3;
      for (const [x, y] of cells) {
        const top = (g[y * W + x] - this.baseY) * VS;
        const grassLo = top - 0.6;
        const p = this.cellToWorld(x, y, 0);
        for (let k = 0; k < bands; k++) {
          let lo: number;
          let hi: number;
          let col: THREE.Color;
          if (k < bands - 1) {
            lo = Math.min(strata[k], grassLo);
            hi = Math.min(strata[k + 1], grassLo);
            col = COLORS.soil[k % COLORS.soil.length];
          } else {
            lo = grassLo;
            hi = top;
            col = grassCol;
          }
          sp.push(p.x, lo, p.z, p.x, hi, p.z);
          sc.push(col.r, col.g, col.b, col.r, col.g, col.b);
        }
      }
      const per = bands * 2;
      for (let c = 0; c < cells.length - 1; c++) {
        for (let k = 0; k < bands; k++) {
          const a = start + c * per + k * 2;
          const b = a + 1;
          const a2 = a + per;
          const b2 = b + per;
          sidx.push(a, b, a2, b, b2, a2);
        }
      }
    };
    const top: [number, number][] = [];
    const bottom: [number, number][] = [];
    const left: [number, number][] = [];
    const right: [number, number][] = [];
    for (let x = 0; x < W; x++) {
      top.push([x, 0]);
      bottom.push([W - 1 - x, H - 1]);
    }
    for (let y = 0; y < H; y++) {
      left.push([0, H - 1 - y]);
      right.push([W - 1, y]);
    }
    edge(top);
    edge(right);
    edge(bottom);
    edge(left);
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sgeo.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
    sgeo.setIndex(sidx);
    sgeo.computeVertexNormals();
    this.skirt = new THREE.Mesh(sgeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
    this.skirt.castShadow = true;
    this.skirt.receiveShadow = true;
    this.stageGroup.add(this.skirt);
    // 바닥판
    const base = new THREE.Mesh(new THREE.BoxGeometry(W - 1, 0.6, H - 1), new THREE.MeshLambertMaterial({ color: '#5e3f27' }));
    base.position.set(0, 0.3, 0);
    base.scale.y = 1;
    base.receiveShadow = true;
    this.stageGroup.add(base);
  }

  private paintTerrain(season: Season): void {
    const { W, H } = this;
    const t = this.world.terrain;
    const col = this.terrainGeo.getAttribute('color') as THREE.BufferAttribute;
    const sc = SEASON_COLORS[season];
    const grass = new THREE.Color(sc.grass);
    const grassHigh = new THREE.Color(sc.grassHigh);
    const field = new THREE.Color(sc.field);
    const fieldDark = field.clone().multiplyScalar(0.86);
    const tmp = new THREE.Color();
    const facType = new Map<number, string>();
    this.world.townLayouts.forEach((l) => l.facilities.forEach((f) => facType.set(f.cell, f.type)));
    const town = new Set<number>();
    this.world.townLayouts.forEach((l) => {
      for (let y = l.y0; y < l.y0 + l.def.h; y++) for (let x = l.x0; x < l.x0 + l.def.w; x++) town.add(y * W + x);
    });
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const rel = t.ground[i] - t.bankHeight[i];
        const n = hash01(x, y);
        const ft = facType.get(i);
        if (ft === 'farm') tmp.copy(x % 2 === 0 ? field : fieldDark);
        else if (ft === 'road') tmp.copy(COLORS.road);
        else if (town.has(i)) tmp.copy(COLORS.plaza);
        else if (rel < -0.25) tmp.copy(COLORS.sand).lerp(COLORS.gravel, n * 0.6);
        else if (rel < 0.05) tmp.copy(COLORS.sand).lerp(grass, 0.35 + n * 0.2);
        else if (rel < 1.0) tmp.copy(grass).lerp(grassHigh, n * 0.5);
        else if (rel < 5.5) {
          const k = Math.min(1, (rel - 1) / 3);
          tmp.copy(grassHigh).lerp(COLORS.rock, k * (0.55 + n * 0.3));
        } else tmp.copy(grassHigh).lerp(grass, n * 0.4);
        if (sc.snow > 0 && rel > 3.5 + n * 2) tmp.lerp(COLORS.snow, sc.snow);
        col.setXYZ(i, tmp.r, tmp.g, tmp.b);
      }
    }
    col.needsUpdate = true;
    // 나무 색
    const treeCol = new THREE.Color(sc.tree);
    for (let k = 0; k < this.treeCells.length; k++) {
      const n = hash01(this.treeCells[k], 7);
      tmp.copy(treeCol).offsetHSL((n - 0.5) * 0.05, 0, (n - 0.5) * 0.12);
      if (season === 'winter' && n > 0.55) tmp.lerp(COLORS.snow, 0.6);
      this.treeFoliage.setColorAt(k, tmp);
    }
    if (this.treeFoliage.instanceColor) this.treeFoliage.instanceColor.needsUpdate = true;
  }

  private buildWater(): void {
    const { W, H } = this;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(W * H * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(W * H * 4), 4));
    geo.setIndex((this.terrainGeo.getIndex() as THREE.BufferAttribute).clone());
    this.waterGeo = geo;
    const mat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      transparent: true,
      shininess: 80,
      specular: new THREE.Color('#cfefff'),
      depthWrite: false,
    });
    this.waterMesh = new THREE.Mesh(geo, mat);
    this.waterMesh.receiveShadow = true;
    this.waterMesh.renderOrder = 2;
    this.waterMesh.name = 'water';
    this.stageGroup.add(this.waterMesh);
  }

  private updateWater(time: number): void {
    const { W, H } = this;
    const g = this.world.grid;
    const pos = this.waterGeo.getAttribute('position') as THREE.BufferAttribute;
    const col = this.waterGeo.getAttribute('color') as THREE.BufferAttribute;
    const pa = pos.array as Float32Array;
    const ca = col.array as Float32Array;
    const sh = COLORS.waterShallow;
    const dp = COLORS.waterDeep;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        let d = g.depth[i];
        const ground = g.ground[i] + g.barrier[i];
        const wet = d > WET;
        if (!wet) {
          // 젖은 이웃 수면 높이를 빌려와 물가를 매끈하게
          let s = 0;
          let n = 0;
          if (x > 0 && g.depth[i - 1] > WET) {
            s += g.ground[i - 1] + g.barrier[i - 1] + g.depth[i - 1];
            n++;
          }
          if (x < W - 1 && g.depth[i + 1] > WET) {
            s += g.ground[i + 1] + g.barrier[i + 1] + g.depth[i + 1];
            n++;
          }
          if (y > 0 && g.depth[i - W] > WET) {
            s += g.ground[i - W] + g.barrier[i - W] + g.depth[i - W];
            n++;
          }
          if (y < H - 1 && g.depth[i + W] > WET) {
            s += g.ground[i + W] + g.barrier[i + W] + g.depth[i + W];
            n++;
          }
          const avg = n ? s / n : ground - 0.3;
          pa[i * 3 + 1] = (Math.min(avg, ground + 0.02) - this.baseY - 0.04) * VS;
          d = 0;
        } else {
          const ripple = Math.sin(x * 0.9 + time * 2.2) * Math.cos(y * 0.8 + time * 1.7) * 0.025;
          pa[i * 3 + 1] = (ground + d - this.baseY) * VS + ripple;
        }
        pa[i * 3] = x - W / 2 + 0.5;
        pa[i * 3 + 2] = y - H / 2 + 0.5;
        const k = Math.min(1, d / 1.6);
        ca[i * 4] = sh.r + (dp.r - sh.r) * k;
        ca[i * 4 + 1] = sh.g + (dp.g - sh.g) * k;
        ca[i * 4 + 2] = sh.b + (dp.b - sh.b) * k;
        ca[i * 4 + 3] = wet ? 0.72 + 0.23 * k : 0;
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.waterGeo.computeVertexNormals();
    this.waterGeo.computeBoundingSphere();
  }

  private buildTowns(): void {
    this.houseCells = [];
    const W = this.W;
    const g = this.world.terrain.ground;
    this.world.townLayouts.forEach((l, ti) => {
      l.facilities.forEach((f, fi) => {
        if (f.type !== 'building') return;
        const x = f.cell % W;
        const y = Math.floor(f.cell / W);
        this.houseCells.push({ cell: f.cell, town: ti, fac: fi, rot: (hash01(x, y) - 0.5) * 0.4, x, z: y, ground: g[f.cell] });
      });
    });
    const n = this.houseCells.length;
    const wallGeo = new THREE.BoxGeometry(0.72, 0.55, 0.62);
    wallGeo.translate(0, 0.275, 0);
    const roofGeo = new THREE.ConeGeometry(0.62, 0.42, 4);
    roofGeo.rotateY(Math.PI / 4);
    roofGeo.translate(0, 0.55 + 0.21, 0);
    this.houses = new THREE.InstancedMesh(wallGeo, new THREE.MeshLambertMaterial({ flatShading: true }), Math.max(1, n));
    this.roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshLambertMaterial({ flatShading: true }), Math.max(1, n));
    this.houses.castShadow = this.roofs.castShadow = true;
    this.houses.receiveShadow = this.roofs.receiveShadow = true;
    const c = new THREE.Color();
    this.houseCells.forEach((hc, k) => {
      c.set(COLORS.houseWalls[Math.floor(hash01(hc.x, hc.z + 3) * COLORS.houseWalls.length)]);
      this.houses.setColorAt(k, c);
      c.set(COLORS.houseRoofs[Math.floor(hash01(hc.x + 9, hc.z) * COLORS.houseRoofs.length)]);
      this.roofs.setColorAt(k, c);
    });
    this.houses.count = n;
    this.roofs.count = n;
    this.stageGroup.add(this.houses, this.roofs);
    this.updateHouses(0);
  }

  private updateHouses(time: number): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);
    this.houseCells.forEach((hc, k) => {
      const flooded = this.world.towns[hc.town].floodedMask[hc.fac] === 1;
      const depth = this.world.grid.depth[hc.cell];
      const sink = flooded ? Math.min(0.3, depth * 0.5) : 0;
      const tilt = flooded ? 0.18 + Math.sin(time * 1.5 + k) * 0.03 : 0;
      e.set(tilt * 0.7, hc.rot, tilt);
      q.setFromEuler(e);
      p.copy(this.cellToWorld(hc.x, hc.z, hc.ground - sink));
      m.compose(p, q, s);
      this.houses.setMatrixAt(k, m);
      this.roofs.setMatrixAt(k, m);
    });
    this.houses.instanceMatrix.needsUpdate = true;
    this.roofs.instanceMatrix.needsUpdate = true;
  }

  private buildTrees(): void {
    const W = this.W;
    const H = this.H;
    const t = this.world.terrain;
    const blocked = new Set<number>();
    this.world.townLayouts.forEach((l) => {
      for (let y = l.y0 - 1; y <= l.y0 + l.def.h; y++) for (let x = l.x0 - 1; x <= l.x0 + l.def.w; x++) blocked.add(y * W + x);
    });
    this.world.sites.forEach((s) => {
      s.cells.forEach((c) => {
        for (let k = -2; k <= 2; k++) blocked.add(c + k * s.step);
      });
    });
    const cells: number[] = [];
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (blocked.has(i)) continue;
        const rel = t.ground[i] - t.bankHeight[i];
        const r = hash01(x * 3, y * 5);
        if (rel > 0.5 && rel < 3 && r < 0.05) cells.push(i);
        else if (rel >= 3 && r < 0.09) cells.push(i);
      }
    }
    this.treeCells = cells;
    const fol = new THREE.ConeGeometry(0.55, 1.3, 6);
    fol.translate(0, 1.05, 0);
    const trunk = new THREE.CylinderGeometry(0.1, 0.13, 0.5, 5);
    trunk.translate(0, 0.25, 0);
    this.treeFoliage = new THREE.InstancedMesh(fol, new THREE.MeshLambertMaterial({ flatShading: true }), Math.max(1, cells.length));
    this.treeTrunks = new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: COLORS.trunk }), Math.max(1, cells.length));
    this.treeFoliage.castShadow = this.treeTrunks.castShadow = true;
    const m = new THREE.Matrix4();
    const c = new THREE.Color('#4b8e38');
    cells.forEach((cell, k) => {
      const x = cell % W;
      const y = Math.floor(cell / W);
      const sc = 0.7 + hash01(x, y * 11) * 0.7;
      const p = this.cellToWorld(x + (hash01(x, y) - 0.5) * 0.6, y + (hash01(y, x) - 0.5) * 0.6, t.ground[cell] - 0.05);
      m.makeScale(sc, sc, sc).setPosition(p);
      this.treeFoliage.setMatrixAt(k, m);
      this.treeTrunks.setMatrixAt(k, m);
      this.treeFoliage.setColorAt(k, c);
    });
    this.treeFoliage.count = this.treeTrunks.count = cells.length;
    this.stageGroup.add(this.treeFoliage, this.treeTrunks);
  }

  private buildMarkers(): void {
    this.world.sites.forEach((s, i) => {
      const grp = new THREE.Group();
      const top = s.bottom + maxCrestHeight(s.def) * 0.55;
      const lineMat = new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.55, depthWrite: false });
      for (const c of s.cells) {
        const x = c % this.W;
        const y = Math.floor(c / this.W);
        const g = this.world.terrain.ground[c];
        if (g > top + 0.5) continue;
        const h = Math.max(0.15, top - g);
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, h * VS, 0.35), lineMat);
        const p = this.cellToWorld(x, y, g + h / 2);
        box.position.copy(p);
        if (s.def.flow !== 'E') box.rotation.y = Math.PI / 2;
        box.userData.siteId = s.def.id;
        grp.add(box);
        this.pickables.push(box);
      }
      // 깃발
      const bx = s.cx;
      const by = s.cy;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.2, 6), new THREE.MeshStandardMaterial({ color: '#f3efe6' }));
      const base = this.cellToWorld(bx, by, top);
      pole.position.copy(base).add(new THREE.Vector3(0, 1.6, 0));
      const flagGeo = new THREE.BufferGeometry();
      flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1.4, -0.4, 0, 0, -0.8, 0], 3));
      flagGeo.computeVertexNormals();
      const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: COLORS.flag, side: THREE.DoubleSide }));
      flag.position.copy(base).add(new THREE.Vector3(0.05, 3.2, 0));
      pole.userData.siteId = flag.userData.siteId = s.def.id;
      grp.add(pole, flag);
      pole.castShadow = flag.castShadow = true;
      // 넓게 클릭되는 투명 판
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 6, 12), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.copy(base).add(new THREE.Vector3(0, 1.5, 0));
      hit.userData.siteId = s.def.id;
      grp.add(hit);
      this.pickables.push(pole, flag, hit);
      grp.userData.flag = flag;
      this.markers[i] = grp;
      this.stageGroup.add(grp);
    });
  }

  private buildDam(i: number): DamVisual | null {
    const dam = this.world.dams[i];
    if (!dam) return null;
    const s = this.world.sites[i];
    const grp = new THREE.Group();
    const W = this.W;
    const ground = this.world.terrain.ground;
    if (dam.status === 'collapsed') {
      const mat = new THREE.MeshStandardMaterial({ color: COLORS.rubble, flatShading: true });
      s.cells.forEach((c, k) => {
        if (hash01(c, k) > 0.6) return;
        const x = c % W;
        const y = Math.floor(c / W);
        const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.35 + hash01(k, c) * 0.3, 0), mat);
        r.position.copy(this.cellToWorld(x + (hash01(c, 1) - 0.5), y + (hash01(c, 2) - 0.5), ground[c] + 0.2));
        r.castShadow = true;
        grp.add(r);
      });
    } else {
      const crest = crestOf(s, dam);
      const color = dam.method === 'earth' ? COLORS.damEarth : dam.method === 'stone' ? COLORS.damStone : COLORS.damConcrete;
      const mat = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: dam.method === 'concrete' ? 0.6 : 0.95 });
      const capMat = new THREE.MeshStandardMaterial({
        color: dam.method === 'earth' ? '#7e9a48' : dam.method === 'stone' ? '#8b897f' : '#bfbab0',
        flatShading: true,
      });
      const thick = dam.method === 'earth' ? 1.8 : dam.method === 'stone' ? 1.25 : 0.95;
      const gateSet = new Set(s.gatePairs.map((p) => p[0] + s.step));
      for (const c of s.cells) {
        const h = crest - ground[c];
        if (h <= 0.02) continue;
        const x = c % W;
        const y = Math.floor(c / W);
        const geo =
          dam.method === 'earth'
            ? new THREE.CylinderGeometry(0.5, thick / 2 + 0.5, h * VS, 4, 1)
            : new THREE.BoxGeometry(1.0, h * VS, thick);
        if (dam.method === 'earth') geo.rotateY(Math.PI / 4);
        const box = new THREE.Mesh(geo, mat);
        box.scale.set(dam.method === 'earth' ? 1.4 : 1, 1, dam.method === 'earth' ? 0.9 : 1);
        box.position.copy(this.cellToWorld(x, y, ground[c] + h / 2));
        if (s.def.flow !== 'E') box.rotation.y = Math.PI / 2;
        box.castShadow = true;
        box.receiveShadow = true;
        box.userData.siteId = s.def.id;
        grp.add(box);
        this.pickables.push(box);
        if (dam.method !== 'earth') {
          const cap = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.14, thick + 0.12), capMat);
          cap.position.copy(this.cellToWorld(x, y, crest + 0.07));
          if (s.def.flow !== 'E') cap.rotation.y = Math.PI / 2;
          cap.castShadow = true;
          grp.add(cap);
        }
        if (gateSet.has(c) && dam.method !== 'earth') {
          const gate = new THREE.Mesh(new THREE.BoxGeometry(0.5, Math.min(0.9, h * 0.6) * VS, 0.1), new THREE.MeshStandardMaterial({ color: '#3d4a52' }));
          const off = s.def.flow === 'E' ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3(0, 0, 0);
          gate.position.copy(this.cellToWorld(x, y, ground[c] + 0.45)).add(off);
          const shift = thick / 2 + 0.03;
          if (s.def.flow === 'E') gate.position.x += shift;
          else {
            gate.rotation.y = Math.PI / 2;
            gate.position.z += s.def.flow === 'S' ? shift : -shift;
          }
          grp.add(gate);
        }
      }
      // 방류 물보라
      const spray = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.max(1, s.gatePairs.length * 0.9), 1),
        new THREE.MeshBasicMaterial({ color: '#e9fbff', transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false }),
      );
      const mid = s.gatePairs.length ? s.gatePairs[Math.floor(s.gatePairs.length / 2)][1] : s.cells[0];
      spray.position.copy(this.cellToWorld(mid % W, Math.floor(mid / W), ground[mid] + 0.5));
      spray.rotation.x = -Math.PI / 2.6;
      if (s.def.flow !== 'E') spray.rotation.z = Math.PI / 2;
      spray.renderOrder = 3;
      this.gateSprays[i] = spray;
      grp.add(spray);
    }
    this.stageGroup.add(grp);
    return { group: grp, key: this.damKey(i) };
  }

  private damKey(i: number): string {
    const d = this.world.dams[i];
    if (!d) return 'none';
    return `${d.method}:${d.status}:${d.levels.capacity}`;
  }

  private updateDams(time: number): void {
    for (let i = 0; i < this.world.sites.length; i++) {
      const key = this.damKey(i);
      const vis = this.dams[i];
      if (!vis || vis.key !== key) {
        if (vis) {
          this.stageGroup.remove(vis.group);
          this.pickables = this.pickables.filter((p) => !vis.group.children.includes(p));
          vis.group.traverse((o) => {
            if (o instanceof THREE.Mesh) o.geometry.dispose();
          });
        }
        this.gateSprays[i] = null;
        this.dams[i] = this.buildDam(i);
      }
      const marker = this.markers[i];
      marker.visible = !this.world.dams[i];
      if (marker.visible) {
        const flag = marker.userData.flag as THREE.Mesh;
        flag.rotation.y = Math.sin(time * 2 + i) * 0.35;
      }
      const spray = this.gateSprays[i];
      const dam = this.world.dams[i];
      if (spray && dam) {
        const m = spray.material as THREE.MeshBasicMaterial;
        m.opacity = Math.min(0.75, dam.releasePerTick * 0.35) * (0.8 + Math.sin(time * 12 + i) * 0.2);
      }
    }
  }

  private buildRain(): void {
    const N = 1800;
    this.rainPos = new Float32Array(N * 6);
    for (let k = 0; k < N; k++) {
      const x = (hash01(k, 1) - 0.5) * this.W;
      const z = (hash01(k, 2) - 0.5) * this.H;
      const y = hash01(k, 3) * 40;
      this.rainPos.set([x, y, z, x + 0.15, y - 1.4, z], k * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#d7ecff', transparent: true, opacity: 0.0 }));
    this.rain.frustumCulled = false;
    this.stageGroup.add(this.rain);
  }

  private updateRain(dt: number, intensity: number): void {
    this.rainLevel += (Math.min(1, intensity / 2.5) - this.rainLevel) * Math.min(1, dt * 2);
    const lv = this.rainLevel;
    const mat = this.rain.material as THREE.LineBasicMaterial;
    mat.opacity = lv * 0.55;
    this.rain.visible = lv > 0.02;
    const N = this.rainPos.length / 6;
    const active = Math.floor(N * Math.min(1, 0.25 + lv));
    const geo = this.rain.geometry;
    geo.setDrawRange(0, active * 2);
    if (this.rain.visible) {
      const p = this.rainPos;
      const fall = dt * 45;
      for (let k = 0; k < active; k++) {
        const o = k * 6;
        p[o + 1] -= fall;
        p[o + 4] -= fall;
        if (p[o + 4] < 0) {
          p[o + 1] += 40;
          p[o + 4] += 40;
        }
      }
      geo.getAttribute('position').needsUpdate = true;
    }
    // 비가 오면 화면 톤을 어둡게
    this.sun.intensity = 2.9 * (1 - 0.55 * lv);
    this.hemi.intensity = 0.75 * (1 - 0.3 * lv);
    const bg = new THREE.Color(COLORS.background).lerp(new THREE.Color('#8f949a'), lv * 0.6);
    (this.scene.background as THREE.Color).copy(bg);
    (this.scene.fog as THREE.Fog).color.copy(bg);
  }

  splash(siteId: string): void {
    const s = this.world.sites.find((x) => x.def.id === siteId);
    if (!s) return;
    const N = 400;
    const pos = new Float32Array(N * 3);
    const vel = new Float32Array(N * 3);
    const c = this.cellToWorld(s.cx, s.cy, s.bottom + s.def.baseHeight);
    for (let k = 0; k < N; k++) {
      pos.set([c.x + (Math.random() - 0.5) * 6, c.y, c.z + (Math.random() - 0.5) * 6], k * 3);
      vel.set([(Math.random() - 0.3) * 8, 4 + Math.random() * 9, (Math.random() - 0.5) * 8], k * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#f2fdff', size: 0.45, transparent: true, opacity: 0.95, depthWrite: false }));
    this.stageGroup.add(pts);
    this.splashes.push({ points: pts, vel, life: 2.5 });
    this.shake = 1;
  }

  private updateSplashes(dt: number): void {
    for (const sp of this.splashes) {
      sp.life -= dt;
      const pos = sp.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const a = pos.array as Float32Array;
      for (let k = 0; k < a.length; k += 3) {
        sp.vel[k + 1] -= 14 * dt;
        a[k] += sp.vel[k] * dt;
        a[k + 1] += sp.vel[k + 1] * dt;
        a[k + 2] += sp.vel[k + 2] * dt;
      }
      pos.needsUpdate = true;
      (sp.points.material as THREE.PointsMaterial).opacity = Math.max(0, sp.life / 2.5);
    }
    const dead = this.splashes.filter((s) => s.life <= 0);
    for (const d of dead) {
      this.stageGroup.remove(d.points);
      d.points.geometry.dispose();
    }
    this.splashes = this.splashes.filter((s) => s.life > 0);
  }

  /** 카메라를 셀 위치로 부드럽게 옮긴다 */
  focusCell(x: number, y: number, distance = 55, dur = 1.0): void {
    const g = this.world.terrain.ground[Math.max(0, Math.min(this.W * this.H - 1, Math.round(y) * this.W + Math.round(x)))];
    const to = this.cellToWorld(x, y, g);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.y < 0.45) dir.setY(0.6).normalize();
    this.camTween = {
      from: this.controls.target.clone(),
      to,
      fromPos: this.camera.position.clone(),
      toPos: to.clone().add(dir.multiplyScalar(distance)),
      t: 0,
      dur,
    };
  }

  tweenCamera(pos: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }, dur: number): void {
    this.camTween = {
      from: this.controls.target.clone(),
      to: new THREE.Vector3(target.x, target.y, target.z),
      fromPos: this.camera.position.clone(),
      toPos: new THREE.Vector3(pos.x, pos.y, pos.z),
      t: 0,
      dur,
    };
  }

  focusSite(siteId: string, distance = 45): void {
    const s = this.world.sites.find((x) => x.def.id === siteId);
    if (s) this.focusCell(s.cx, s.cy, distance);
  }

  select(siteId: string | null): void {
    if (!siteId) {
      this.selectRing.visible = false;
      return;
    }
    const s = this.world.sites.find((x) => x.def.id === siteId);
    if (!s) return;
    this.selectRing.visible = true;
    this.selectRing.position.copy(this.cellToWorld(s.cx, s.cy, s.bottom + maxCrestHeight(s.def) + 0.6));
  }

  /** 화면을 돌려 놓았을 때(localCoords)는 캔버스 자체 좌표계를 쓴다 */
  localCoords = false;

  private canvasRect(): { left: number; top: number; width: number; height: number } {
    const c = this.renderer.domElement;
    if (this.localCoords) return { left: 0, top: 0, width: c.clientWidth, height: c.clientHeight };
    return c.getBoundingClientRect();
  }

  /** 화면 좌표(픽셀)에 있는 부지 id */
  pick(clientX: number, clientY: number): string | null {
    const rect = this.canvasRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects(this.pickables.filter((p) => p.visible && p.parent?.visible !== false), false);
    for (const h of hits) if (h.object.userData.siteId) return h.object.userData.siteId as string;
    return null;
  }

  /** 부지의 화면 좌표 (테스트·튜토리얼 말풍선용) */
  siteScreenPos(siteId: string): { x: number; y: number } | null {
    const s = this.world.sites.find((x) => x.def.id === siteId);
    if (!s) return null;
    const p = this.cellToWorld(s.cx, s.cy, s.bottom + maxCrestHeight(s.def) * 0.55 + 2.5).project(this.camera);
    const rect = this.canvasRect();
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }

  setQuality(pixelRatio: number, shadows: boolean): void {
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material) (o.material as THREE.Material).needsUpdate = true;
    });
    const c = this.renderer.domElement;
    this.resize(c.clientWidth, c.clientHeight);
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.tiltH.uniforms.h.value = 1 / w;
    this.tiltV.uniforms.v.value = 1 / h;
  }

  /** 매 프레임 호출. dt는 실제 초 */
  update(dt: number, time = performance.now() / 1000): void {
    if (!this.world) return;
    const pt0 = performance.now();
    const season = seasonOfMonth(this.world.date.month);
    if (season !== this.season) {
      this.season = season;
      this.paintTerrain(season);
    }
    this.updateWater(time);
    this.updateDams(time);
    this.updateHouses(time);
    this.updateRain(dt, this.world.today.rain);
    this.updateSplashes(dt);
    const pt1 = performance.now();

    if (this.camTween) {
      const tw = this.camTween;
      tw.t += dt / tw.dur;
      const k = Math.min(1, tw.t);
      const e = k * k * (3 - 2 * k);
      this.controls.target.lerpVectors(tw.from, tw.to, e);
      this.camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
      if (k >= 1) this.camTween = null;
    }
    this.controls.update();
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 0.6);
      const a = this.shake * 0.6;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
    }
    if (this.tiltShift) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.perf = { cpu: pt1 - pt0, draw: performance.now() - pt1 };
  }

  perf = { cpu: 0, draw: 0 };

  /** 지금 장면을 즉시 그린다 (캡처 직전용) */
  renderNow(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
