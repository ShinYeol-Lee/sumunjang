/** 봇 한 판을 돌리며 월별 상태와 수입 구성을 출력한다 (밸런스 조정용). */
import { BOT_FACTORIES, type BotId } from './bots';
import { World } from '../sim/world';

const [stage, seed, bot] = [Number(process.argv[2] ?? 1), Number(process.argv[3] ?? 11), (process.argv[4] ?? 'heuristic') as BotId];
const w = new World(stage, seed);
const b = BOT_FACTORIES[bot]();
let lastIncome = { ...w.economy.income };
let lastExpense = { ...w.economy.expense };
let maxFlood = w.towns.map(() => 0);
let maxInflow = 0;
let levels: number[][] = w.sites.map(() => []);
const lines: string[] = [];
while (!w.finished) {
  b.act(w);
  w.step();
  w.towns.forEach((t, i) => (maxFlood[i] = Math.max(maxFlood[i], t.floodRatio)));
  w.dams.forEach((d, i) => d && d.status === 'ok' && levels[i].push(d.level));
  maxInflow = Math.max(maxInflow, w.lastInflow.reduce((a, x) => a + x, 0));
  if (w.tick % (24 * 30) === 0 || w.finished) {
    const inc = Object.fromEntries(Object.entries(w.economy.income).map(([k, v]) => [k, Math.round(v - (lastIncome as Record<string, number>)[k])]).filter(([, v]) => v !== 0));
    const exp = Object.fromEntries(Object.entries(w.economy.expense).map(([k, v]) => [k, Math.round(v - (lastExpense as Record<string, number>)[k])]).filter(([, v]) => v !== 0));
    lastIncome = { ...w.economy.income };
    lastExpense = { ...w.economy.expense };
    const d = w.date;
    const lv = levels.map((l) => (l.length ? `${Math.round(Math.min(...l) * 100)}-${Math.round((l.reduce((a, x) => a + x, 0) / l.length) * 100)}-${Math.round(Math.max(...l) * 100)}` : '-'));
    lines.push(
      `${d.year}-${String(d.month).padStart(2)} ${String(Math.round(w.economy.funds)).padStart(6)} Q${maxInflow.toFixed(1)} big${w.towns.map((t) => t.bigFloods).join(',')} lv[${lv.join(' ')}] fl[${maxFlood.map((x) => x.toFixed(2)).join(',')}] tr[${w.towns.map((t) => Math.round(t.trust)).join(',')}] dams[${w.dams.map((x) => (x ? `${x.method[0]}${x.status === 'ok' ? '' : 'X'}${Math.round(x.durability)}` : '.')).join(' ')}] +${JSON.stringify(inc)} -${JSON.stringify(exp)}`,
    );
    maxFlood = w.towns.map(() => 0);
    maxInflow = 0;
    levels = w.sites.map(() => []);
  }
}
console.log(lines.join('\n'));
console.log(JSON.stringify(w.result));
const tot = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));
console.log('income', JSON.stringify(tot(w.economy.income)));
console.log('expense', JSON.stringify(tot(w.economy.expense)));
