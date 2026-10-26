import { ECONOMY } from '../data/balance';

export type IncomeKind = 'power' | 'contract' | 'tourism' | 'tax' | 'relief' | 'emergency';
export type ExpenseKind = 'build' | 'upgrade' | 'repair' | 'upkeep' | 'damage' | 'penalty';

export interface EconomyState {
  funds: number;
  income: Record<IncomeKind, number>;
  expense: Record<ExpenseKind, number>;
  reliefCount: number;
  emergencyCount: number;
  /** 이번 달 수입/지출 (HUD용) */
  monthIncome: number;
  monthExpense: number;
}

export function newEconomy(startFunds: number): EconomyState {
  return {
    funds: startFunds,
    income: { power: 0, contract: 0, tourism: 0, tax: 0, relief: 0, emergency: 0 },
    expense: { build: 0, upgrade: 0, repair: 0, upkeep: 0, damage: 0, penalty: 0 },
    reliefCount: 0,
    emergencyCount: 0,
    monthIncome: 0,
    monthExpense: 0,
  };
}

export function earn(e: EconomyState, kind: IncomeKind, amount: number): void {
  if (amount <= 0) return;
  e.funds += amount;
  e.income[kind] += amount;
  e.monthIncome += amount;
}

export function spend(e: EconomyState, kind: ExpenseKind, amount: number): void {
  if (amount <= 0) return;
  e.funds -= amount;
  e.expense[kind] += amount;
  e.monthExpense += amount;
}

/** 발전 수입 = 방류량 × 낙차 × 효율 × 단가 */
export function powerIncome(releaseTimesHead: number, efficiency: number): number {
  return releaseTimesHead * efficiency * ECONOMY.POWER_PRICE;
}

export function reliefAmount(eventDamage: number): number {
  return Math.min(ECONOMY.RELIEF_MAX, Math.max(ECONOMY.RELIEF_MIN, eventDamage * ECONOMY.RELIEF_RATIO));
}

/** 파산하면 0까지 메워 주고 감점 플래그를 단다. 반환: 지원했는지 */
export function checkBankruptcy(e: EconomyState): boolean {
  if (e.funds >= 0) return false;
  const gap = -e.funds;
  e.funds = 0;
  e.income.emergency += gap;
  e.emergencyCount++;
  return true;
}
