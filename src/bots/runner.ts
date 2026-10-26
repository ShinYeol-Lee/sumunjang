import type { StageResult } from '../sim/scoring';
import { World } from '../sim/world';
import { BOT_FACTORIES, type BotId } from './bots';

export interface BotRun {
  stage: number;
  seed: number;
  bot: BotId;
  result: StageResult;
  /** 대형 침수 또는 붕괴가 있었는지 */
  disaster: boolean;
  seconds: number;
  income: Record<string, number>;
  expense: Record<string, number>;
}

export function runBot(stage: number, seed: number, bot: BotId): BotRun {
  const t0 = performance.now();
  const world = new World(stage, seed);
  const b = BOT_FACTORIES[bot]();
  while (!world.finished) {
    b.act(world);
    world.step();
  }
  const result = world.result!;
  return {
    stage,
    seed,
    bot,
    result,
    disaster: result.collapses > 0 || result.bigFloods > 0,
    seconds: (performance.now() - t0) / 1000,
    income: { ...world.economy.income },
    expense: { ...world.economy.expense },
  };
}
