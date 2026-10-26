import { describe, expect, it } from 'vitest';
import { heuristicBot } from '../../src/bots/bots';
import { STAGE_TICKS } from '../../src/data/balance';
import { World } from '../../src/sim/world';

function play(seed: number, ticks: number): World {
  const w = new World(2, seed);
  const bot = heuristicBot();
  for (let t = 0; t < ticks; t++) {
    bot.act(w);
    w.step();
  }
  return w;
}

describe('결정론', () => {
  it('같은 시드로 두 번 돌리면 최종 상태 해시가 같다', () => {
    const a = play(42, 24 * 120);
    const b = play(42, 24 * 120);
    expect(a.hash()).toBe(b.hash());
    expect(a.economy.funds).toBe(b.economy.funds);
  });

  it('다른 시드는 다른 결과를 낸다', () => {
    expect(play(1, 24 * 60).hash()).not.toBe(play(2, 24 * 60).hash());
  });

  it('성능: 화면 없이 3년(26,280틱)을 60초 이내에 시뮬레이션한다', () => {
    const t0 = performance.now();
    const w = play(7, STAGE_TICKS);
    const sec = (performance.now() - t0) / 1000;
    expect(w.finished).toBe(true);
    expect(sec).toBeLessThan(60);
  }, 120_000);
});
