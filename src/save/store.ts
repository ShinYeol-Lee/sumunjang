import { openDB, type IDBPDatabase } from 'idb';
import type { CodexId } from '../data/codex';
import { SAVE_VERSION, type WorldSave } from '../sim/world';

export type SlotId = 'auto' | 'slot1' | 'slot2' | 'slot3';
export const MANUAL_SLOTS: SlotId[] = ['slot1', 'slot2', 'slot3'];

export interface SaveRecord {
  slot: SlotId;
  saveVersion: number;
  savedAt: number;
  stageId: number;
  stageName: string;
  dateLabel: string;
  funds: number;
  world: WorldSave;
}

export interface CodexEntry {
  id: CodexId;
  unlockedAt: number;
  dateLabel: string;
  stageName: string;
  thumb?: string;
}

export interface Progress {
  /** 열린 최대 스테이지 */
  unlocked: number;
  best: Record<number, number>;
  tutorialDone: boolean;
  tiltShift: boolean;
}

const DB_NAME = 'sumunjang';
const DB_VERSION = 1;

let dbp: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbp) {
    dbp = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('saves')) d.createObjectStore('saves', { keyPath: 'slot' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      },
    });
  }
  return dbp;
}

export async function writeSave(rec: Omit<SaveRecord, 'saveVersion' | 'savedAt'>): Promise<void> {
  const full: SaveRecord = { ...rec, saveVersion: SAVE_VERSION, savedAt: Date.now() };
  await (await db()).put('saves', full);
}

export async function readSave(slot: SlotId): Promise<SaveRecord | undefined> {
  const r = (await (await db()).get('saves', slot)) as SaveRecord | undefined;
  if (r && r.saveVersion !== SAVE_VERSION) return undefined;
  return r;
}

export async function listSaves(): Promise<SaveRecord[]> {
  const all = (await (await db()).getAll('saves')) as SaveRecord[];
  return all.filter((r) => r.saveVersion === SAVE_VERSION);
}

export async function latestSave(): Promise<SaveRecord | undefined> {
  const all = await listSaves();
  return all.sort((a, b) => b.savedAt - a.savedAt)[0];
}

export async function deleteSave(slot: SlotId): Promise<void> {
  await (await db()).delete('saves', slot);
}

const DEFAULT_PROGRESS: Progress = { unlocked: 1, best: {}, tutorialDone: false, tiltShift: false };

export async function readProgress(): Promise<Progress> {
  const p = (await (await db()).get('meta', 'progress')) as Progress | undefined;
  return { ...DEFAULT_PROGRESS, ...(p ?? {}) };
}

export async function writeProgress(p: Progress): Promise<void> {
  await (await db()).put('meta', p, 'progress');
}

export async function readCodex(): Promise<Partial<Record<CodexId, CodexEntry>>> {
  return ((await (await db()).get('meta', 'codex')) as Partial<Record<CodexId, CodexEntry>>) ?? {};
}

let codexChain: Promise<unknown> = Promise.resolve();

/** 도감 해금. 동시에 여러 개가 와도 읽고-쓰기가 겹치지 않게 차례로 처리한다 */
export function unlockCodex(entry: CodexEntry): Promise<boolean> {
  const run = codexChain.then(async () => {
    const all = await readCodex();
    if (all[entry.id]) return false;
    all[entry.id] = entry;
    await (await db()).put('meta', all, 'codex');
    return true;
  });
  codexChain = run.catch(() => false);
  return run;
}
