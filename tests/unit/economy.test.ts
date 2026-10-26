import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../../src/data/balance';
import { powerEfficiency } from '../../src/sim/dam';
import { checkBankruptcy, newEconomy, powerIncome } from '../../src/sim/economy';
import { computeStars } from '../../src/sim/scoring';
import { World } from '../../src/sim/world';

const DAY = 24;

function oneTickPower(w: World): number {
  const before = w.economy.income.power;
  w.step();
  return w.economy.income.power - before;
}

describe('경제', () => {
  it('발전 수입 = 방류량 × 낙차 × 효율 × 단가', () => {
    expect(powerIncome(10, 1)).toBeCloseTo(10 * ECONOMY.POWER_PRICE);
    expect(powerIncome(20, 1)).toBeCloseTo(2 * powerIncome(10, 1));
    expect(powerIncome(10, 1.5)).toBeCloseTo(1.5 * powerIncome(10, 1));
    const w = new World(1, 4);
    w.build('s1a', 'concrete');
    w.setGate('s1a', 0);
    w.runTicks(8 * DAY);
    w.setGate('s1a', 0.5);
    const inc = oneTickPower(w);
    const d = w.dam('s1a')!;
    expect(inc).toBeGreaterThan(0);
    expect(inc).toBeCloseTo(d.releasePerTick * d.head * powerEfficiency(d) * ECONOMY.POWER_PRICE, 9);
  });

  it('같은 방류량이면 낙차가 클수록 수입이 크다', () => {
    const lowHead = new World(1, 4);
    lowHead.build('s1a', 'stone');
    lowHead.setGate('s1a', 1);
    lowHead.runTicks(4 * DAY);
    lowHead.setGate('s1a', 0.3);
    const a = oneTickPower(lowHead) / lowHead.dam('s1a')!.releasePerTick;

    const highHead = new World(1, 4);
    highHead.build('s1a', 'stone');
    highHead.setGate('s1a', 0);
    highHead.runTicks(8 * DAY);
    highHead.setGate('s1a', 0.3);
    const b = oneTickPower(highHead) / highHead.dam('s1a')!.releasePerTick;
    expect(b).toBeGreaterThan(a * 1.5);
  });

  it('방류량을 늘리면 발전 수입도 늘어난다', () => {
    const mk = (gate: number) => {
      const w = new World(1, 4);
      w.build('s1a', 'stone');
      w.setGate('s1a', 0);
      w.runTicks(8 * DAY);
      w.setGate('s1a', gate);
      return oneTickPower(w);
    };
    const small = mk(0.2);
    const big = mk(0.4);
    expect(big / small).toBeGreaterThan(1.7);
    expect(big / small).toBeLessThan(2.3);
  });

  it('용수 계약을 채우지 못하면 마을 신뢰도가 떨어진다', () => {
    const control = new World(1, 6);
    const w = new World(1, 6);
    // 상류 댐 수문을 모두 막으면 하류 유량이 끊긴다
    w.build('s1a', 'concrete');
    w.build('s1b', 'stone');
    w.setGate('s1a', 0);
    w.setGate('s1b', 0);
    control.runTicks(8 * DAY);
    w.runTicks(8 * DAY);
    const c = control.towns[0];
    const t = w.towns[0];
    expect(c.contractMet).toBeGreaterThanOrEqual(6);
    expect(t.contractMet).toBeLessThan(c.contractMet);
    expect(t.trust).toBeLessThan(c.trust);
  });

  it('파산하면 0원까지 메워 주고 감점 플래그를 단다', () => {
    const e = newEconomy(100);
    e.funds = -500;
    expect(checkBankruptcy(e)).toBe(true);
    expect(e.funds).toBe(0);
    expect(e.emergencyCount).toBe(1);
  });

  it('별 평가 규칙', () => {
    const base = { finished: true, funds: 100, targetFunds: 50, totalDamage: 0, collapses: 0, bigFloods: 0, reliefCount: 0, emergencyCount: 0, contractRate: 1 };
    expect(computeStars(base)).toBe(3);
    expect(computeStars({ ...base, bigFloods: 1 })).toBe(2);
    expect(computeStars({ ...base, reliefCount: 1 })).toBe(2);
    expect(computeStars({ ...base, emergencyCount: 1 })).toBe(2);
    expect(computeStars({ ...base, funds: 10 })).toBe(1);
    expect(computeStars({ ...base, finished: false })).toBe(0);
  });
});
