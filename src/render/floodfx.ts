import * as THREE from 'three';
import { WATER } from '../data/balance';
import type { World } from '../sim/world';

/** 휩쓸린 물건이 물에 뜨기 시작하는 수심 */
const FLOAT_DEPTH = { house: 0.28, tree: 0.25, car: 0.1 } as const;
/** 원래 자리가 이만큼(게임 틱) 말라 있으면 물건이 다시 생긴다 */
const RESPAWN_DRY_TICKS = 48;
const CAR_COLORS = ['#e8483b', '#f2b632', '#3b7fd4', '#4cae5a', '#f07f2e', '#9b59b6'];

type Kind = 'house' | 'tree' | 'car';

export interface FxHouse {
  cell: number;
  x: number;
  z: number;
  ground: number;
  wall: THREE.Color;
  roof: THREE.Color;
}

export interface FxTree {
  cell: number;
  x: number;
  z: number;
  scale: number;
}

/** 디오라마가 FloodFX에 빌려주는 것들 */
export interface FxHost {
  world: World;
  group: THREE.Group;
  cellToWorld(x: number, y: number, h?: number): THREE.Vector3;
  houses: FxHouse[];
  trees: FxTree[];
  hideHouse(k: number, hidden: boolean): void;
  hideTree(k: number, hidden: boolean): void;
  smallSplash(pos: THREE.Vector3, n: number): void;
}

interface Debris {
  kind: Kind;
  idx: number;
  obj: THREE.Object3D;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  floating: boolean;
  gone: boolean;
}

interface Car {
  obj: THREE.Group;
  row: number[];
  pos: number;
  dir: number;
  speed: number;
  swept: boolean;
}

/**
 * 장난감 디오라마의 홍수 장면: 물살이 세지면 집·나무·장난감 자동차가 떠내려가고,
 * 물이 빠진 뒤 시간이 지나면 제자리에 다시 놓인다. 시뮬레이션에는 영향을 주지 않는 연출이다.
 */
export class FloodFX {
  private debris: Debris[] = [];
  private swept = { house: new Map<number, Debris>(), tree: new Map<number, Debris>(), car: new Map<number, Debris>() };
  private dry = { house: new Map<number, number>(), tree: new Map<number, number>(), car: new Map<number, number>() };
  private cars: Car[] = [];
  private lastTick = -1;
  private host: FxHost;

  constructor(host: FxHost) {
    this.host = host;
    this.buildCars();
  }

  dispose(): void {
    for (const d of this.debris) this.host.group.remove(d.obj);
    for (const c of this.cars) this.host.group.remove(c.obj);
    this.debris = [];
    this.cars = [];
  }

  /** 지금 떠내려가는 물건 수 (연출·테스트용) */
  get floatingCount(): number {
    return this.debris.filter((d) => d.floating && !d.gone).length;
  }

  private buildCars(): void {
    const { world } = this.host;
    const W = world.terrain.w;
    let n = 0;
    world.townLayouts.forEach((l) => {
      // 강 쪽 농지 다음 줄이 큰길이다
      const roadRow = l.def.riverSide === 'N' ? l.y0 + 2 : l.y0 + l.def.h - 3;
      const row: number[] = [];
      for (let x = l.x0; x < l.x0 + l.def.w; x++) row.push(roadRow * W + x);
      const count = Math.max(2, Math.round(l.def.w / 6));
      for (let k = 0; k < count; k++) {
        const obj = makeCar(CAR_COLORS[n++ % CAR_COLORS.length]);
        this.host.group.add(obj);
        this.cars.push({ obj, row, pos: ((k + 0.5) / count) * (row.length - 1), dir: k % 2 ? 1 : -1, speed: 0.08 + 0.04 * (k % 3), swept: false });
      }
    });
  }

  /** dt: 실제 초, ticksPerSec: 지금 게임 속도 (멈추면 0) */
  update(dt: number, ticksPerSec: number, time: number): void {
    const { world } = this.host;
    const g = world.grid;
    const W = world.terrain.w;
    const H = world.terrain.h;
    const ticks = this.lastTick < 0 ? 0 : Math.max(0, world.tick - this.lastTick);
    this.lastTick = world.tick;

    // 1) 물살에 휩쓸리는지 확인
    this.host.houses.forEach((h, k) => {
      if (this.swept.house.has(k)) return;
      const d = g.depth[h.cell];
      const sp = speedAt(world, h.cell);
      if (d > 0.4 || (d > 0.2 && sp > 0.15)) this.sweep('house', k, h.x, h.z, makeHouse(h.wall, h.roof));
    });
    this.host.trees.forEach((t, k) => {
      if (this.swept.tree.has(k)) return;
      const d = g.depth[t.cell];
      if (d > 0.25 && speedAt(world, t.cell) > 0.25) this.sweep('tree', k, t.x, t.z, makeTree(t.scale));
    });
    this.cars.forEach((c, k) => {
      if (c.swept) return;
      const cell = c.row[Math.round(c.pos)];
      if (g.depth[cell] > FLOAT_DEPTH.car) {
        c.swept = true;
        this.host.group.remove(c.obj);
        this.sweep('car', k, cell % W, Math.floor(cell / W), c.obj);
        return;
      }
      // 평소에는 큰길을 오간다
      c.pos += c.dir * c.speed * ticks;
      if (c.pos <= 0 || c.pos >= c.row.length - 1) {
        c.dir *= -1;
        c.pos = Math.max(0, Math.min(c.row.length - 1, c.pos));
      }
      const cur = c.row[Math.round(c.pos)];
      const p = this.host.cellToWorld(c.pos + (c.row[0] % W), Math.floor(cur / W), world.terrain.ground[cur]);
      c.obj.position.copy(p);
      c.obj.rotation.set(0, c.dir > 0 ? 0 : Math.PI, 0);
    });

    // 2) 떠내려가는 물건 움직이기
    const scale = WATER.SUBSTEPS * ticksPerSec;
    for (const d of this.debris) {
      if (d.gone) continue;
      const cx = Math.min(W - 1, Math.max(0, Math.round(d.x)));
      const cy = Math.min(H - 1, Math.max(0, Math.round(d.y)));
      const i = cy * W + cx;
      const depth = g.depth[i];
      const surface = g.ground[i] + g.barrier[i] + depth;
      const floating = depth > FLOAT_DEPTH[d.kind];
      if (floating && !d.floating) this.host.smallSplash(this.host.cellToWorld(d.x, d.y, surface), d.kind === 'house' ? 50 : 25);
      d.floating = floating;
      if (floating) {
        const inv = 1 / (depth + 0.05);
        const tvx = (g.fR[i] - g.fL[i]) * inv * scale * 0.9;
        const tvy = (g.fD[i] - g.fU[i]) * inv * scale * 0.9;
        const k = Math.min(1, dt * 3);
        d.vx += (tvx - d.vx) * k;
        d.vy += (tvy - d.vy) * k;
      } else {
        const k = Math.exp(-dt * 5);
        d.vx *= k;
        d.vy *= k;
      }
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      const speed = Math.hypot(d.vx, d.vy);
      d.rot += d.spin * Math.min(1, speed) * dt;
      if (d.x < -1 || d.y < -1 || d.x > W || d.y > H) {
        // 섬 밖으로 떠내려갔다
        d.gone = true;
        this.host.group.remove(d.obj);
        continue;
      }
      const bob = floating ? Math.sin(time * 3 + d.idx) * 0.05 : 0;
      const base = floating ? surface - (d.kind === 'house' ? 0.18 : 0.06) : g.ground[i];
      d.obj.position.copy(this.host.cellToWorld(d.x, d.y, base)).add(new THREE.Vector3(0, bob, 0));
      const tip = d.kind === 'tree' ? Math.PI / 2.2 : d.kind === 'house' ? 0.35 + Math.sin(time * 1.3 + d.idx) * 0.12 : 0.5 + Math.sin(time * 2 + d.idx) * 0.3;
      d.obj.rotation.set(tip * (floating ? 1 : 0.8), d.rot, floating ? Math.sin(time * 1.7 + d.idx) * 0.2 : 0.15);
    }

    // 3) 물이 빠지고 시간이 지나면 제자리에 다시 놓는다
    this.respawn('house', ticks, (k) => this.host.houses[k].cell, (k) => this.host.hideHouse(k, false));
    this.respawn('tree', ticks, (k) => this.host.trees[k].cell, (k) => this.host.hideTree(k, false));
    this.respawn(
      'car',
      ticks,
      (k) => this.cars[k].row[Math.round(this.cars[k].pos)],
      (k) => {
        const c = this.cars[k];
        c.swept = false;
        this.host.group.add(c.obj);
      },
    );
    if (this.debris.length > 200) this.debris = this.debris.filter((d) => !d.gone || this.swept[d.kind].get(d.idx) === d);
  }

  private sweep(kind: Kind, idx: number, x: number, y: number, obj: THREE.Object3D): void {
    if (kind === 'house') this.host.hideHouse(idx, true);
    if (kind === 'tree') this.host.hideTree(idx, true);
    this.host.group.add(obj);
    const d: Debris = { kind, idx, obj, x, y, vx: 0, vy: 0, rot: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 4, floating: false, gone: false };
    this.debris.push(d);
    this.swept[kind].set(idx, d);
    this.dry[kind].set(idx, 0);
  }

  private respawn(kind: Kind, ticks: number, homeCell: (k: number) => number, restore: (k: number) => void): void {
    const g = this.host.world.grid;
    for (const [k, d] of this.swept[kind]) {
      const dryTicks = g.depth[homeCell(k)] < 0.03 ? (this.dry[kind].get(k) ?? 0) + ticks : 0;
      this.dry[kind].set(k, dryTicks);
      // 아직 떠다니는 중이면 기다린다
      if (dryTicks < RESPAWN_DRY_TICKS || (d.floating && !d.gone)) continue;
      if (d.kind !== 'car') this.host.group.remove(d.obj);
      d.gone = true;
      this.swept[kind].delete(k);
      this.dry[kind].delete(k);
      restore(k);
    }
  }
}

/** 셀의 물살 세기 (서브스텝당 셀) */
export function speedAt(world: World, i: number): number {
  const g = world.grid;
  const d = g.depth[i];
  if (d <= 0.02) return 0;
  return (g.fL[i] + g.fR[i] + g.fU[i] + g.fD[i]) / (d + 0.05);
}

function makeHouse(wall: THREE.Color, roof: THREE.Color): THREE.Group {
  const grp = new THREE.Group();
  const w = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.55, 0.62), new THREE.MeshLambertMaterial({ color: wall, flatShading: true }));
  w.position.y = 0.275;
  const r = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.42, 4), new THREE.MeshLambertMaterial({ color: roof, flatShading: true }));
  r.rotation.y = Math.PI / 4;
  r.position.y = 0.76;
  w.castShadow = r.castShadow = true;
  grp.add(w, r);
  return grp;
}

function makeTree(scale: number): THREE.Group {
  const grp = new THREE.Group();
  const f = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.3, 6), new THREE.MeshLambertMaterial({ color: '#3d7f30', flatShading: true }));
  f.position.y = 1.05;
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.5, 5), new THREE.MeshLambertMaterial({ color: '#7a5636' }));
  t.position.y = 0.25;
  f.castShadow = true;
  grp.add(f, t);
  grp.scale.setScalar(scale);
  return grp;
}

function makeCar(color: string): THREE.Group {
  const grp = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.34), new THREE.MeshLambertMaterial({ color, flatShading: true }));
  body.position.y = 0.17;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.3), new THREE.MeshLambertMaterial({ color: '#eef6fb', flatShading: true }));
  cabin.position.set(-0.04, 0.34, 0);
  const wheelGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.06, 8);
  wheelGeo.rotateX(Math.PI / 2);
  const wheelMat = new THREE.MeshLambertMaterial({ color: '#2b2b2b' });
  for (const [x, z] of [
    [0.2, 0.17],
    [-0.2, 0.17],
    [0.2, -0.17],
    [-0.2, -0.17],
  ]) {
    const wh = new THREE.Mesh(wheelGeo, wheelMat);
    wh.position.set(x, 0.08, z);
    grp.add(wh);
  }
  body.castShadow = cabin.castShadow = true;
  grp.add(body, cabin);
  return grp;
}
