import type { BotId } from './bots';
import { runBot } from './runner';

// 사용법: vite-node src/bots/worker.ts -- stage:seed:bot ...
for (const job of process.argv.slice(2)) {
  if (!job.includes(':')) continue;
  const [stage, seed, bot] = job.split(':');
  const r = runBot(Number(stage), Number(seed), bot as BotId);
  process.stdout.write(`@@RESULT ${JSON.stringify(r)}\n`);
}
