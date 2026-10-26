import { TOWN } from '../data/balance';

export interface StageResult {
  stars: number;
  finished: boolean;
  funds: number;
  targetFunds: number;
  totalDamage: number;
  collapses: number;
  bigFloods: number;
  reliefCount: number;
  emergencyCount: number;
  /** 용수 계약 충족률 0~1 */
  contractRate: number;
}

export function computeStars(r: Omit<StageResult, 'stars'>): number {
  if (!r.finished) return 0;
  let stars = 1;
  if (r.funds >= r.targetFunds) {
    stars = 2;
    if (r.bigFloods === 0 && r.reliefCount === 0 && r.emergencyCount === 0) stars = 3;
  }
  return stars;
}

export const BIG_FLOOD_RATIO = TOWN.BIG_FLOOD_RATIO;
