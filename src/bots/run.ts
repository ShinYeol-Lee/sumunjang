/**
 * 밸런스 봇 검수: 스테이지 1~3 × 시드 5개 × 봇 4종을 병렬로 돌리고 통과 조건을 검사한다.
 * 결과는 bots-report.json과 표준 출력 표로 남긴다. 실패하면 종료 코드 1.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import type { BotId } from './bots';
import type { BotRun } from './runner';

const STAGES = [1, 2, 3];
const SEEDS = [11, 22, 33, 44, 55];
const BOTS: BotId[] = ['idle', 'empty', 'fill', 'heuristic'];

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--stages='))?.slice(9).split(',').map(Number);
const onlyBots = args.find((a) => a.startsWith('--bots='))?.slice(7).split(',') as BotId[] | undefined;
const seedArg = args.find((a) => a.startsWith('--seeds='))?.slice(8).split(',').map(Number);

const jobs: string[] = [];
for (const st of only ?? STAGES) for (const seed of seedArg ?? SEEDS) for (const bot of onlyBots ?? BOTS) jobs.push(`${st}:${seed}:${bot}`);

const workers = Math.max(1, Math.min(cpus().length, 8));
const chunks: string[][] = Array.from({ length: workers }, () => []);
jobs.forEach((j, i) => chunks[i % workers].push(j));

function runChunk(chunk: string[]): Promise<BotRun[]> {
  return new Promise((resolve, reject) => {
    if (!chunk.length) return resolve([]);
    const p = spawn('npx', ['vite-node', 'src/bots/worker.ts', '--', ...chunk], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`worker exited ${code}`));
      const runs = out
        .split('\n')
        .filter((l) => l.startsWith('@@RESULT '))
        .map((l) => JSON.parse(l.slice(9)) as BotRun);
      resolve(runs);
    });
  });
}

const t0 = Date.now();
const runs = (await Promise.all(chunks.map(runChunk))).flat();

interface Row {
  stage: number;
  bot: BotId;
  avgStars: number;
  minStars: number;
  maxStars: number;
  avgFunds: number;
  avgCollapses: number;
  avgBigFloods: number;
  disasterRuns: number;
  runs: number;
  avgContract: number;
}

const rows: Row[] = [];
for (const st of only ?? STAGES) {
  for (const bot of onlyBots ?? BOTS) {
    const rs = runs.filter((r) => r.stage === st && r.bot === bot);
    if (!rs.length) continue;
    const avg = (f: (r: BotRun) => number) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
    rows.push({
      stage: st,
      bot,
      avgStars: avg((r) => r.result.stars),
      minStars: Math.min(...rs.map((r) => r.result.stars)),
      maxStars: Math.max(...rs.map((r) => r.result.stars)),
      avgFunds: avg((r) => r.result.funds),
      avgCollapses: avg((r) => r.result.collapses),
      avgBigFloods: avg((r) => r.result.bigFloods),
      disasterRuns: rs.filter((r) => r.disaster).length,
      runs: rs.length,
      avgContract: avg((r) => r.result.contractRate),
    });
  }
}

const failures: string[] = [];
const get = (st: number, bot: BotId) => rows.find((r) => r.stage === st && r.bot === bot);
const checkedStages = only ?? STAGES;
for (const st of checkedStages) {
  const idle = get(st, 'idle');
  const empty = get(st, 'empty');
  const fill = get(st, 'fill');
  const heur = get(st, 'heuristic');
  if (idle && st >= 2 && idle.maxStars >= 3) failures.push(`스테이지 ${st}: 방치 봇이 ★★★를 받았다`);
  if (empty && empty.maxStars >= 2) failures.push(`스테이지 ${st}: 비움 봇이 목표 자금에 도달했다`);
  if (fill && fill.disasterRuns < fill.runs) failures.push(`스테이지 ${st}: 채움 봇이 재난 없이 끝난 판이 있다 (${fill.runs - fill.disasterRuns}판)`);
  if (heur) {
    if (heur.avgStars < 2) failures.push(`스테이지 ${st}: 휴리스틱 봇 평균 별 ${heur.avgStars.toFixed(2)} < 2`);
    if (st === 1 && heur.maxStars < 3) failures.push('스테이지 1: 휴리스틱 봇이 ★★★를 한 번도 못 받았다');
    for (const other of [idle, empty, fill]) {
      if (!other) continue;
      if (other.avgStars > heur.avgStars || (other.avgStars === heur.avgStars && other.avgFunds > heur.avgFunds)) {
        failures.push(`스테이지 ${st}: ${other.bot} 봇 점수가 휴리스틱보다 높다`);
      }
    }
  }
}

const fmt = (n: number, d = 2) => n.toFixed(d);
console.log('\n스테이지 | 봇        | 평균★ | 최소★ | 최대★ | 평균 최종 자금 | 평균 붕괴 | 평균 대형침수 | 재난 판수 | 계약 충족률');
for (const r of rows) {
  console.log(
    `${r.stage}        | ${r.bot.padEnd(9)} | ${fmt(r.avgStars)}  | ${r.minStars}     | ${r.maxStars}     | ${fmt(r.avgFunds, 0).padStart(13)} | ${fmt(r.avgCollapses).padStart(8)} | ${fmt(r.avgBigFloods).padStart(12)} | ${r.disasterRuns}/${r.runs}       | ${fmt(r.avgContract * 100, 0)}%`,
  );
}
console.log(`\n${runs.length}판, ${((Date.now() - t0) / 1000).toFixed(0)}초`);
writeFileSync('bots-report.json', JSON.stringify({ rows, runs, failures }, null, 2));
if (failures.length) {
  console.log('\n실패:');
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
}
console.log('\n밸런스 봇 검수 통과');
