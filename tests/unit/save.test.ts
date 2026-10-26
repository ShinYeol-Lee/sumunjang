import { describe, expect, it } from 'vitest';
import { heuristicBot } from '../../src/bots/bots';
import { SAVE_VERSION, World, type WorldSave } from '../../src/sim/world';

describe('저장/불러오기', () => {
  it('직렬화 후 역직렬화한 상태로 계속 진행한 결과가 원본과 같다', () => {
    const a = new World(3, 2024);
    const botA = heuristicBot();
    for (let t = 0; t < 24 * 100; t++) {
      botA.act(a);
      a.step();
    }
    // JSON을 한 번 거쳐도 숫자가 그대로 보존된다
    const save = JSON.parse(JSON.stringify(a.serialize())) as WorldSave;
    expect(save.saveVersion).toBe(SAVE_VERSION);
    const b = World.deserialize(save);
    expect(b.hash()).toBe(a.hash());

    const botB = heuristicBot();
    for (let t = 0; t < 24 * 150; t++) {
      botA.act(a);
      a.step();
      botB.act(b);
      b.step();
    }
    expect(b.tick).toBe(a.tick);
    expect(b.hash()).toBe(a.hash());
    expect(b.economy.funds).toBe(a.economy.funds);
  });

  it('구조화 복제(IndexedDB 저장 방식)로도 왕복이 같다', () => {
    const a = new World(2, 77);
    a.build('s2b', 'stone');
    a.setGate('s2b', 0.4);
    a.runTicks(24 * 40);
    const b = World.deserialize(structuredClone(a.serialize()));
    a.runTicks(24 * 30);
    b.runTicks(24 * 30);
    expect(b.hash()).toBe(a.hash());
  });

  it('다른 저장 버전은 거부한다', () => {
    const save = new World(1, 1).serialize();
    expect(() => World.deserialize({ ...save, saveVersion: 999 })).toThrow();
  });
});
