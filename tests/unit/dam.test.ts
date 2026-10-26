import { describe, expect, it } from 'vitest';
import { METHODS } from '../../src/data/balance';
import { crestOf, maxDurability, reservoirVolume } from '../../src/sim/dam';
import { World } from '../../src/sim/world';

const DAY = 24;

describe('댐', () => {
  it('수문을 닫으면 상류 수위가 오르고, 열면 내려간다', () => {
    const w = new World(1, 3);
    expect(w.build('s1a', 'stone').ok).toBe(true);
    const dam = w.dam('s1a')!;
    w.setGate('s1a', 0);
    w.runTicks(DAY);
    const l0 = dam.level;
    w.runTicks(4 * DAY);
    const closed = dam.level;
    expect(closed).toBeGreaterThan(l0 + 0.1);
    w.setGate('s1a', 1);
    w.runTicks(3 * DAY);
    expect(dam.level).toBeLessThan(closed - 0.1);
    expect(dam.releasePerTick).toBeGreaterThan(0);
  });

  it('수문을 닫은 채 폭우가 오면 월류가 일어나고 내구도가 줄어든다', () => {
    const w = new World(1, 5, { rainScale: 4 });
    w.build('s1a', 'stone');
    const dam = w.dam('s1a')!;
    w.setGate('s1a', 0);
    const max = maxDurability(dam);
    let overtopped = false;
    let event = false;
    for (let t = 0; t < 20 * DAY && !overtopped; t++) {
      w.step();
      if (w.drainEvents().some((e) => e.type === 'overtopStart')) event = true;
      overtopped = dam.overtopping;
    }
    expect(overtopped).toBe(true);
    expect(event).toBe(true);
    const before = dam.durability;
    w.runTicks(6);
    // 월류 중 감소율은 평소 노후보다 훨씬 크다
    expect(before - dam.durability).toBeGreaterThan(METHODS.stone.decayPerTick * 6 * 20);
    expect(dam.durability).toBeLessThan(max);
  });

  it('내구도가 0이 되면 저수량 대부분이 48틱 안에 하류로 빠진다', () => {
    const w = new World(1, 7);
    w.build('s1a', 'stone');
    w.setGate('s1a', 0);
    w.runTicks(12 * DAY);
    const geom = w.sites[0];
    const dam = w.dam('s1a')!;
    expect(dam.level).toBeGreaterThan(0.7);
    // 비교 기준: 댐이 없을 때의 자연 하천 수량
    const natural = new World(1, 7);
    natural.runTicks(12 * DAY);
    const vNatural = reservoirVolume(natural.grid, natural.sites[0]);
    const vFull = reservoirVolume(w.grid, geom);
    const stored = vFull - vNatural;
    expect(stored).toBeGreaterThan(100);
    const W = w.terrain.w;
    const downstream = () => {
      let v = 0;
      for (let y = 0; y < w.terrain.h; y++) for (let x = geom.cx + 2; x < W; x++) v += w.grid.depth[y * W + x];
      return v;
    };
    const downBefore = downstream();
    dam.durability = 0.0001;
    w.step();
    expect(dam.status).toBe('collapsed');
    expect(w.drainEvents().some((e) => e.type === 'collapse')).toBe(true);
    w.runTicks(47);
    const vAfter = reservoirVolume(w.grid, geom);
    expect(vFull - vAfter).toBeGreaterThan(stored * 0.7);
    // 빠진 물은 댐 하류로 쏟아진다
    expect(downstream() - downBefore).toBeGreaterThan(stored * 0.4);
  });

  it('무너진 댐은 재건할 수 있다', () => {
    const w = new World(1, 7);
    w.build('s1a', 'earth');
    const dam = w.dam('s1a')!;
    dam.durability = 0.0001;
    w.step();
    expect(dam.status).toBe('collapsed');
    expect(w.grid.barrier[w.sites[0].cells[0]]).toBe(0);
    const r = w.rebuild('s1a');
    expect(r.ok).toBe(true);
    expect(dam.status).toBe('ok');
    expect(dam.durability).toBe(maxDurability(dam));
  });

  it('공법 한계: 흙댐은 업그레이드 2단계가 거부된다', () => {
    const w = new World(1, 1);
    w.economy.funds = 1e6;
    w.build('s1a', 'earth');
    expect(w.upgrade('s1a', 'capacity').ok).toBe(true);
    const second = w.upgrade('s1a', 'capacity');
    expect(second.ok).toBe(false);
    expect(w.dam('s1a')!.levels.capacity).toBe(1);
    // 석축은 3단계, 콘크리트는 5단계까지
    w.build('s1b', 'stone');
    for (let k = 0; k < 3; k++) expect(w.upgrade('s1b', 'release').ok).toBe(true);
    expect(w.upgrade('s1b', 'release').ok).toBe(false);
  });

  it('저수 용량 업그레이드는 댐 마루를 올린다', () => {
    const w = new World(1, 1);
    w.economy.funds = 1e6;
    w.build('s1b', 'concrete');
    const g = w.sites[1];
    const d = w.dam('s1b')!;
    const c0 = crestOf(g, d);
    w.upgrade('s1b', 'capacity');
    expect(crestOf(g, d)).toBeGreaterThan(c0);
    const lowest = g.cells.reduce((a, c) => (w.grid.ground[c] < w.grid.ground[a] ? c : a), g.cells[0]);
    expect(w.grid.ground[lowest] + w.grid.barrier[lowest]).toBeCloseTo(crestOf(g, d), 9);
  });

  it('자동 수문은 설정 수위를 넘으면 스스로 연다', () => {
    const w = new World(1, 2);
    w.economy.funds = 1e6;
    w.build('s1a', 'stone');
    w.upgrade('s1a', 'auto');
    const d = w.dam('s1a')!;
    expect(d.autoEnabled).toBe(true);
    w.setGate('s1a', 0);
    w.setAuto('s1a', true, 0.5);
    let opened = false;
    for (let t = 0; t < 15 * DAY; t++) {
      w.step();
      if (d.opening > 0.05) opened = true;
    }
    expect(opened).toBe(true);
    expect(d.level).toBeLessThan(0.75);
  });
});
