/** 재난 도감 항목 */
export type CodexId = 'firstCollapse' | 'overtop' | 'sunkenTown' | 'dryRiverbed' | 'chainCollapse';

export interface CodexDef {
  id: CodexId;
  name: string;
  icon: string;
  hint: string;
  text: string;
}

export const CODEX: CodexDef[] = [
  { id: 'firstCollapse', name: '첫 붕괴', icon: '💥', hint: '댐이 처음 무너졌을 때', text: '버티던 둑이 결국 터졌다. 모아 둔 물이 한꺼번에 쏟아진다.' },
  { id: 'overtop', name: '월류', icon: '🌊', hint: '수면이 댐 마루를 처음 넘었을 때', text: '물이 댐 꼭대기를 타고 넘는다. 흙댐이라면 오래 못 버틴다.' },
  { id: 'sunkenTown', name: '물에 잠긴 마을', icon: '🏚️', hint: '마을 시설 30% 이상이 동시에 잠겼을 때', text: '지붕만 남은 집들. 마을 사람들의 원성이 높다.' },
  { id: 'dryRiverbed', name: '메마른 강바닥', icon: '🏜️', hint: '건기에 저수지 수위가 10% 아래로 떨어졌을 때', text: '갈라진 바닥이 드러났다. 물을 너무 일찍 다 썼다.' },
  { id: 'chainCollapse', name: '연쇄 붕괴', icon: '⛓️', hint: '상류 댐이 무너진 물로 하류 댐까지 무너졌을 때', text: '위에서 터진 물이 아래 댐까지 집어삼켰다.' },
];
