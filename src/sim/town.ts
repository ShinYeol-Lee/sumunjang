import { TOWN } from '../data/balance';
import type { TownDef } from '../data/stages';
import type { WaterGrid } from './water';

export type FacilityType = 'building' | 'road' | 'farm';

export interface Facility {
  cell: number;
  type: FacilityType;
}

export interface TownLayout {
  def: TownDef;
  facilities: Facility[];
  x0: number;
  y0: number;
}

export interface TownState {
  id: string;
  trust: number;
  flooded: number;
  floodRatio: number;
  /** 시설별 침수 여부 (렌더링용) */
  floodedMask: number[];
  totalDamage: number;
  bigFloodActive: boolean;
  bigFloodDamage: number;
  bigFloods: number;
  /** 오늘 계측선 통과 유량 */
  flowToday: number;
  farmFloodedToday: boolean;
  roadFloodedToday: boolean;
  contractDays: number;
  contractMet: number;
  wasFlooding: boolean;
}

/** 강 쪽 두 줄은 농지, 그다음 줄은 큰길, 나머지는 집과 골목 */
export function layoutTown(def: TownDef, w: number, h: number): TownLayout {
  const x0 = Math.round(def.x - def.w / 2);
  const y0 = Math.round(def.y - def.h / 2);
  const facilities: Facility[] = [];
  for (let r = 0; r < def.h; r++) {
    const y = def.riverSide === 'N' ? y0 + r : y0 + def.h - 1 - r;
    for (let cx = 0; cx < def.w; cx++) {
      const x = x0 + cx;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const cell = y * w + x;
      if (r < 2) facilities.push({ cell, type: 'farm' });
      else if (r === 2) facilities.push({ cell, type: 'road' });
      else if (cx % 5 === 2) facilities.push({ cell, type: 'road' });
      else if ((cx + r) % 2 === 0) facilities.push({ cell, type: 'building' });
    }
  }
  return { def, facilities, x0, y0 };
}

export function newTownState(layout: TownLayout): TownState {
  return {
    id: layout.def.id,
    trust: TOWN.START_TRUST,
    flooded: 0,
    floodRatio: 0,
    floodedMask: layout.facilities.map(() => 0),
    totalDamage: 0,
    bigFloodActive: false,
    bigFloodDamage: 0,
    bigFloods: 0,
    flowToday: 0,
    farmFloodedToday: false,
    roadFloodedToday: false,
    contractDays: 0,
    contractMet: 0,
    wasFlooding: false,
  };
}

export interface TownTickResult {
  damage: number;
  floodStarted: boolean;
  bigFloodStarted: boolean;
  bigFloodEnded: boolean;
  eventDamage: number;
}

export function updateTown(grid: WaterGrid, layout: TownLayout, st: TownState): TownTickResult {
  let flooded = 0;
  let damage = 0;
  const fac = layout.facilities;
  for (let k = 0; k < fac.length; k++) {
    const f = fac[k];
    const wet = grid.depth[f.cell] > TOWN.FLOOD_DEPTH[f.type];
    st.floodedMask[k] = wet ? 1 : 0;
    if (wet) {
      flooded++;
      damage += TOWN.DAMAGE_PER_TICK[f.type];
      if (f.type === 'farm') st.farmFloodedToday = true;
      if (f.type === 'road') st.roadFloodedToday = true;
    }
  }
  st.flooded = flooded;
  st.floodRatio = fac.length ? flooded / fac.length : 0;
  st.totalDamage += damage;
  st.trust = Math.max(0, st.trust - TOWN.TRUST_FLOOD_PER_TICK * st.floodRatio);
  const res: TownTickResult = { damage, floodStarted: false, bigFloodStarted: false, bigFloodEnded: false, eventDamage: 0 };
  if (flooded > 0 && !st.wasFlooding) res.floodStarted = true;
  st.wasFlooding = flooded > 0;
  if (st.bigFloodActive) {
    st.bigFloodDamage += damage;
    if (st.floodRatio < TOWN.BIG_FLOOD_END_RATIO) {
      st.bigFloodActive = false;
      res.bigFloodEnded = true;
      res.eventDamage = st.bigFloodDamage;
    }
  } else if (st.floodRatio >= TOWN.BIG_FLOOD_RATIO) {
    st.bigFloodActive = true;
    st.bigFloodDamage = damage;
    st.bigFloods++;
    res.bigFloodStarted = true;
  }
  return res;
}
