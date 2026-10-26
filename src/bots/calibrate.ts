/** 방치 상태에서 마을별 대형 침수 횟수를 시드별로 센다 (마을 높이 조정용). 사용: calibrate.ts <stage> <townId=elev,...> */
import { overrideTownElevation } from '../data/stages';
import { World } from '../sim/world';

const stage = Number(process.argv[2]);
for (const kv of (process.argv[3] ?? '').split(',').filter(Boolean)) {
  const [id, v] = kv.split('=');
  overrideTownElevation(id, Number(v));
}
const seeds = (process.argv[4] ?? '11,22,33').split(',').map(Number);
for (const seed of seeds) {
  const w = new World(stage, seed);
  const hours = w.towns.map(() => 0);
  while (!w.finished) {
    w.step();
    w.towns.forEach((t, i) => t.floodRatio >= 0.3 && hours[i]++);
  }
  console.log(`seed ${seed}: big ${w.towns.map((t) => t.bigFloods).join(',')} hours>=30% ${hours.join(',')} dmg ${Math.round(w.result!.totalDamage)}`);
}
