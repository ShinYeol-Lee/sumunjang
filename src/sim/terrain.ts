import type { RiverDef, StageDef } from '../data/stages';
import { hashSeed } from './rng';

export interface Terrain {
  w: number;
  h: number;
  ground: Float64Array;
  /** 가장 가까운 강 중심선까지 거리 */
  riverDist: Float64Array;
  /** 가장 가까운 강의 하상(둑) 높이 */
  bankHeight: Float64Array;
  /** 강별 유입 셀 */
  sources: number[][];
}

interface PathInfo {
  pts: [number, number][];
  cum: number[];
  length: number;
}

function pathInfo(pts: [number, number][]): PathInfo {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  return { pts, cum, length: cum[cum.length - 1] };
}

/** 점에서 꺾은선까지 최단 거리와 경로상 위치 */
function project(p: PathInfo, x: number, y: number): { d: number; s: number } {
  let best = Infinity;
  let bestS = 0;
  for (let i = 1; i < p.pts.length; i++) {
    const [ax, ay] = p.pts[i - 1];
    const [bx, by] = p.pts[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t;
    const py = ay + dy * t;
    const d = Math.hypot(x - px, y - py);
    if (d < best) {
      best = d;
      bestS = p.cum[i - 1] + Math.sqrt(len2) * t;
    }
  }
  return { d: best, s: bestS };
}

function interp(table: [number, number][], t: number): number {
  if (t <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (t <= table[i][0]) {
      const [t0, v0] = table[i - 1];
      const [t1, v1] = table[i];
      const k = (t - t0) / (t1 - t0 || 1);
      return v0 + (v1 - v0) * k;
    }
  }
  return table[table.length - 1][1];
}

function makeNoise(seed: number): (x: number, y: number) => number {
  const lattice = (ix: number, iy: number) => (hashSeed(seed, ix, iy) / 4294967296) * 2 - 1;
  return (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = lattice(ix, iy);
    const b = lattice(ix + 1, iy);
    const c = lattice(ix, iy + 1);
    const d = lattice(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

export const TERRAIN_SHAPE = {
  FLOODPLAIN_SLOPE: 0.05,
  WALL_SLOPE: 1.4,
};

/** 스테이지 정의로 지형 높이맵을 만든다 (결정론적). */
export function generateTerrain(stage: StageDef): Terrain {
  const { width: w, height: h } = stage;
  const ground = new Float64Array(w * h);
  const riverDist = new Float64Array(w * h);
  const bankHeight = new Float64Array(w * h);
  const infos = stage.rivers.map((r) => pathInfo(r.path));

  // 하천별 시작 하상 높이 (지류는 합류점 높이에 맞춘다)
  const startBeds: number[] = [];
  stage.rivers.forEach((r, i) => {
    if (r.startBed !== undefined) {
      startBeds.push(r.startBed);
    } else {
      const end = r.path[r.path.length - 1];
      const main = stage.rivers[0];
      const pm = project(infos[0], end[0], end[1]);
      const bedAtJunction = (main.startBed ?? 10) - main.slope * pm.s;
      startBeds.push(bedAtJunction + r.slope * infos[i].length);
    }
  });

  const noise = makeNoise(hashSeed('terrain', stage.id));
  const noise2 = makeNoise(hashSeed('terrain2', stage.id));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let gBest = Infinity;
      let dBest = Infinity;
      let bankBest = 0;
      stage.rivers.forEach((r: RiverDef, ri) => {
        const info = infos[ri];
        const { d, s } = project(info, x + 0.5, y + 0.5);
        const bed = startBeds[ri] - r.slope * s;
        const vw = interp(r.valley, s / info.length);
        const cw = r.channelHalfWidth;
        let g: number;
        if (d < cw) {
          const k = d / cw;
          g = bed - r.channelDepth * (1 - k * k);
        } else if (d < vw) {
          g = bed + TERRAIN_SHAPE.FLOODPLAIN_SLOPE * (d - cw);
        } else {
          const fp = TERRAIN_SHAPE.FLOODPLAIN_SLOPE * (vw - cw);
          const rise = Math.min(stage.plateau, TERRAIN_SHAPE.WALL_SLOPE * (d - vw));
          // 벽은 부드럽게 고원으로 이어진다
          g = bed + fp + rise;
          const wallness = Math.min(1, (d - vw) / 3);
          g += wallness * (noise(x / 9, y / 9) * 1.2 + noise2(x / 3.5, y / 3.5) * 0.35);
        }
        if (g < gBest) {
          gBest = g;
          bankBest = bed;
        }
        if (d < dBest) dBest = d;
      });
      ground[i] = gBest;
      riverDist[i] = dBest;
      bankHeight[i] = bankBest;
    }
  }

  // 마을 부지: 둑보다 정해진 만큼 높은 완만한 땅으로 고른다
  for (const t of stage.towns) {
    const x0 = Math.round(t.x - t.w / 2);
    const y0 = Math.round(t.y - t.h / 2);
    for (let y = y0; y < y0 + t.h; y++) {
      for (let x = x0; x < x0 + t.w; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = y * w + x;
        const rowFromRiver = t.riverSide === 'N' ? y - y0 : y0 + t.h - 1 - y;
        ground[i] = bankHeight[i] + t.elevation + 0.035 * rowFromRiver;
      }
    }
  }

  // 유입 셀: 경로 시작점이 닿는 격자 가장자리의 하도 셀
  const sources = stage.rivers.map((r) => {
    const [sx, sy] = r.path[0];
    const cells: number[] = [];
    const reach = r.channelHalfWidth;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const onEdge = sx <= 0 ? x === 0 : sy <= 0 ? y === 0 : false;
        if (!onEdge) continue;
        if (Math.hypot(x + 0.5 - Math.max(sx, 0.5), y + 0.5 - Math.max(sy, 0.5)) <= reach) cells.push(y * w + x);
      }
    }
    return cells;
  });

  return { w, h, ground, riverDist, bankHeight, sources };
}
