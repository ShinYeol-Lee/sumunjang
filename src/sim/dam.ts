import { DAM, METHODS, UPGRADE_AXES, type MethodId, type UpgradeAxis } from '../data/balance';
import type { DamSiteDef, FlowDir } from '../data/stages';
import type { Terrain } from './terrain';
import type { WaterGrid } from './water';

export type DamStatus = 'ok' | 'collapsed';

export interface DamState {
  siteId: string;
  method: MethodId;
  levels: Record<UpgradeAxis, number>;
  durability: number;
  status: DamStatus;
  /** 수동 방류율 0~1 */
  gate: number;
  autoEnabled: boolean;
  autoSetpoint: number;
  /** 최근 틱 통계 */
  opening: number;
  releasePerTick: number;
  head: number;
  level: number;
  surface: number;
  overtopping: boolean;
  /** 최근 7일 일별 수위 비율 */
  levelHistory: number[];
  collapses: number;
  lastCollapseTick: number;
  /** 무너진 뒤 지난 틱 (터진 곳이 가운데서부터 넓어진다). 옛 저장에는 없을 수 있다 */
  breachTicks?: number;
}

export interface SiteGeom {
  def: DamSiteDef;
  index: number;
  cells: number[];
  bottom: number;
  /** 흐름 방향 셀 오프셋 */
  step: number;
  gatePairs: [number, number][];
  /** cells 안에서 바닥 셀의 위치 (붕괴가 시작되는 곳) */
  bottomIdx: number;
  /** 수위 측정 셀 (바닥 셀 상류 2칸) */
  refCell: number;
  /** 저수지 영역 (상류 쪽, 수위 계산·연출용) */
  reservoirCells: number[];
  cx: number;
  cy: number;
}

export function flowOffset(flow: FlowDir, w: number): number {
  return flow === 'E' ? 1 : flow === 'S' ? w : -w;
}

export function maxCrestHeight(def: DamSiteDef): number {
  return def.baseHeight + DAM.CAPACITY_STEP * METHODS.concrete.maxUpgrade;
}

/** 부지의 댐 라인 셀을 정한다: 중심에서 흐름에 수직으로, 최대 마루보다 높은 땅이 나올 때까지 */
export function computeSiteGeom(def: DamSiteDef, index: number, terrain: Terrain): SiteGeom {
  const { w, h, ground } = terrain;
  const along = def.flow === 'E' ? [0, 1] : [1, 0];
  const center = def.y * w + def.x;
  // 중심 근처 최저점을 바닥으로
  let bottom = ground[center];
  for (let k = -4; k <= 4; k++) {
    const x = def.x + along[0] * k;
    const y = def.y + along[1] * k;
    if (x >= 0 && y >= 0 && x < w && y < h) bottom = Math.min(bottom, ground[y * w + x]);
  }
  const top = bottom + maxCrestHeight(def) + 0.4;
  const cells: number[] = [center];
  for (const sign of [-1, 1]) {
    for (let k = 1; k < 40; k++) {
      const x = def.x + along[0] * k * sign;
      const y = def.y + along[1] * k * sign;
      if (x < 0 || y < 0 || x >= w || y >= h) break;
      const c = y * w + x;
      cells.push(c);
      if (ground[c] >= top) break;
    }
  }
  cells.sort((a, b) => a - b);
  const step = flowOffset(def.flow, w);
  const gatePairs: [number, number][] = [];
  let bottomCell = center;
  for (const c of cells) {
    if (ground[c] < ground[bottomCell]) bottomCell = c;
    if (ground[c] <= bottom + DAM.GATE_BAND) gatePairs.push([c - step, c + step]);
  }
  const refCell = bottomCell - 2 * step;
  // 저수지 영역: 상류 방향 40칸 안에서 최대 마루보다 낮은 셀
  const reservoirCells: number[] = [];
  const ux = def.flow === 'E' ? -1 : 0;
  const uy = def.flow === 'S' ? -1 : def.flow === 'N' ? 1 : 0;
  const lineSet = new Set(cells);
  for (const c of cells) {
    let cx = c % w;
    let cy = Math.floor(c / w);
    for (let k = 1; k <= 45; k++) {
      cx += ux;
      cy += uy;
      if (cx < 0 || cy < 0 || cx >= w || cy >= h) break;
      const cc = cy * w + cx;
      if (lineSet.has(cc)) break;
      if (ground[cc] < top) reservoirCells.push(cc);
    }
  }
  const bottomIdx = cells.indexOf(bottomCell);
  return { def, index, cells, bottom, step, gatePairs, bottomIdx, refCell, reservoirCells, cx: def.x, cy: def.y };
}

export function newDam(siteId: string, method: MethodId): DamState {
  const levels = Object.fromEntries(UPGRADE_AXES.map((a) => [a, 0])) as Record<UpgradeAxis, number>;
  const dam: DamState = {
    siteId,
    method,
    levels,
    durability: 0,
    status: 'ok',
    gate: 0.3,
    autoEnabled: false,
    autoSetpoint: DAM.AUTO_DEFAULT_SETPOINT,
    opening: 0,
    releasePerTick: 0,
    head: 0,
    level: 0,
    surface: 0,
    overtopping: false,
    levelHistory: [],
    collapses: 0,
    lastCollapseTick: -1,
  };
  dam.durability = maxDurability(dam);
  return dam;
}

export function crestOf(geom: SiteGeom, dam: DamState): number {
  return geom.bottom + geom.def.baseHeight + dam.levels.capacity * DAM.CAPACITY_STEP;
}

export function maxDurability(dam: DamState): number {
  return METHODS[dam.method].baseDurability * (1 + DAM.DURABILITY_PER_LEVEL * dam.levels.durability);
}

export function maxRelease(dam: DamState): number {
  return DAM.BASE_RELEASE * (1 + DAM.RELEASE_PER_LEVEL * dam.levels.release);
}

export function powerEfficiency(dam: DamState): number {
  return METHODS[dam.method].powerEfficiency * (1 + DAM.POWER_PER_LEVEL * dam.levels.power);
}

export function buildCost(def: DamSiteDef, method: MethodId): number {
  return Math.round(def.baseCost * METHODS[method].costMult);
}

export function upgradeCost(def: DamSiteDef, dam: DamState, axis: UpgradeAxis): number {
  return Math.round(buildCost(def, dam.method) * DAM.UPGRADE_COST_RATIO * (dam.levels[axis] + 1) * 0.5);
}

export function repairCost(dam: DamState): number {
  return Math.ceil((maxDurability(dam) - dam.durability) * DAM.REPAIR_COST_PER_POINT);
}

export function rebuildCost(def: DamSiteDef, method: MethodId): number {
  return Math.round(buildCost(def, method) * DAM.REBUILD_RATIO);
}

export function canUpgrade(dam: DamState, axis: UpgradeAxis): boolean {
  return dam.status === 'ok' && dam.levels[axis] < METHODS[dam.method].maxUpgrade;
}

/** 무너지는 중인 댐의 셀별 남은 높이 비율 (가운데부터 터지고 양옆으로 넓어지며 전체가 깎인다) */
export function breachFactor(geom: SiteGeom, dam: DamState, k: number): number {
  const t = dam.breachTicks ?? DAM.BREACH_TICKS;
  if (t >= DAM.BREACH_TICKS) return 0;
  const width = DAM.BREACH_START + t * DAM.BREACH_WIDEN;
  const side = Math.min(1, Math.max(0, (Math.abs(k - geom.bottomIdx) - width) / DAM.BREACH_EDGE));
  return side * (1 - t / DAM.BREACH_TICKS);
}

export function applyBarrier(grid: WaterGrid, geom: SiteGeom, dam: DamState | null): void {
  if (!dam) {
    for (const c of geom.cells) grid.barrier[c] = 0;
    return;
  }
  const crest = crestOf(geom, dam);
  geom.cells.forEach((c, k) => {
    let b = crest - grid.ground[c];
    if (dam.status !== 'ok') b *= breachFactor(geom, dam, k);
    grid.barrier[c] = b > 0 ? b : 0;
  });
}

/** 이번 틱의 실제 방류율 (수동 + 자동 수문) */
export function effectiveOpening(dam: DamState): number {
  let open = dam.gate;
  if (dam.autoEnabled && dam.levels.auto > 0 && dam.level > dam.autoSetpoint) {
    const maxAuto = Math.min(1, DAM.AUTO_BASE_OPEN + DAM.AUTO_OPEN_PER_LEVEL * dam.levels.auto);
    const auto = Math.min(maxAuto, ((dam.level - dam.autoSetpoint) / 0.08) * maxAuto);
    if (auto > open) open = auto;
  }
  return Math.max(0, Math.min(1, open));
}

/** 서브스텝 하나 분량 수문 방류. 반환: [방류량, 낙차×방류량] */
export function gateTransfer(grid: WaterGrid, geom: SiteGeom, dam: DamState, substeps: number): [number, number] {
  if (dam.status !== 'ok' || dam.opening <= 0 || geom.gatePairs.length === 0) return [0, 0];
  const { ground, barrier, depth } = grid;
  const perPair = (dam.opening * maxRelease(dam)) / substeps / geom.gatePairs.length;
  let moved = 0;
  let energy = 0;
  for (const [up, down] of geom.gatePairs) {
    const du = depth[up];
    if (du <= 0) continue;
    const su = ground[up] + barrier[up] + du;
    const sd = ground[down] + barrier[down] + depth[down];
    const head = su - sd;
    if (head <= 0) continue;
    let t = perPair;
    if (t > du * 0.5) t = du * 0.5;
    if (t > head * 0.45) t = head * 0.45;
    depth[up] = du - t;
    depth[down] += t;
    moved += t;
    energy += t * head;
  }
  return [moved, energy];
}

export function measureLevel(grid: WaterGrid, geom: SiteGeom, dam: DamState): void {
  const crest = crestOf(geom, dam);
  const s = grid.ground[geom.refCell] + grid.depth[geom.refCell];
  dam.surface = s;
  const range = crest - geom.bottom;
  dam.level = Math.max(0, (s - geom.bottom) / range);
  dam.overtopping = dam.status === 'ok' && s > crest + DAM.OVERTOP_MARGIN;
}

/** 내구도 감소. 반환: 이번 틱에 무너졌는지 */
export function updateDurability(dam: DamState): boolean {
  if (dam.status !== 'ok') return false;
  const m = METHODS[dam.method];
  const reduce = Math.max(0.2, 1 - DAM.DECAY_REDUCTION_PER_LEVEL * dam.levels.durability);
  let loss = m.decayPerTick * reduce;
  if (dam.level >= DAM.DANGER_LEVEL) loss *= DAM.DANGER_DECAY_MULT;
  if (dam.overtopping) loss += m.overtopDecayPerTick * reduce;
  dam.durability -= loss;
  if (dam.durability <= 0) {
    dam.durability = 0;
    dam.status = 'collapsed';
    dam.breachTicks = 0;
    dam.collapses++;
    return true;
  }
  return false;
}

/**
 * 이 댐을 가득 채웠을 때 상류 마을까지의 여유 높이(m). 음수면 상류 마을이 잠긴다.
 * 여유가 1m 안쪽이면 홍수 때 역류로 상류 마을이 잠기기 쉽다.
 */
export function upstreamTownMargin(
  geom: SiteGeom,
  crest: number,
  ground: Float64Array,
  towns: { def: { x: number }; facilities: { cell: number; type: 'building' | 'road' | 'farm' }[] }[],
  floodDepth: Record<'building' | 'road' | 'farm', number>,
): number {
  let margin = Infinity;
  if (geom.def.flow !== 'E') return margin;
  for (const t of towns) {
    if (t.def.x >= geom.cx) continue;
    for (const f of t.facilities) margin = Math.min(margin, ground[f.cell] + floodDepth[f.type] - crest);
  }
  return margin;
}

/** 저수지 영역 저수량 */
export function reservoirVolume(grid: WaterGrid, geom: SiteGeom): number {
  let v = 0;
  for (const c of geom.reservoirCells) v += grid.depth[c];
  return v;
}
