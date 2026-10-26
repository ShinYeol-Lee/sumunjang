import { DAM, ECONOMY, GAME_TITLE, METHODS, TIME, TOWN, UPGRADE_AXES, UPGRADE_NAMES, type MethodId, type UpgradeAxis } from '../data/balance';
import { CODEX, type CodexId } from '../data/codex';
import { STAGES, getStage } from '../data/stages';
import { Diorama } from '../render/diorama';
import {
  MANUAL_SLOTS,
  latestSave,
  listSaves,
  readCodex,
  readProgress,
  readSave,
  unlockCodex,
  writeProgress,
  writeSave,
  type Progress,
  type SlotId,
} from '../save/store';
import { SEASON_NAMES, formatDate, seasonOfMonth } from '../sim/calendar';
import { buildCost, canUpgrade, crestOf, maxDurability, maxRelease, newDam, rebuildCost, repairCost, upgradeCost, upstreamTownMargin } from '../sim/dam';
import type { StageResult } from '../sim/scoring';
import { World, type WorldEvent } from '../sim/world';

const TICKS_PER_SEC_1X = TIME.TICKS_PER_DAY / TIME.SECONDS_PER_DAY_1X;
const SPEEDS = [0, 1, 2, 3];
const MAX_TICKS_PER_FRAME = 40;

type Screen = 'menu' | 'stages' | 'game' | 'result' | 'codex' | 'slots';

interface AlertItem {
  id: number;
  text: string;
  sub: string;
  kind: 'danger' | 'warn' | 'good' | 'info';
  siteId?: string;
  townId?: string;
  born: number;
}

interface Cinematic {
  siteId: string;
  t: number;
  phase: number;
  /** 연출 전 카메라 (끝나면 되돌아간다) */
  camPos: { x: number; y: number; z: number };
  camTarget: { x: number; y: number; z: number };
}

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;

function starsHtml(n: number, max = 3): string {
  let s = '';
  for (let i = 0; i < max; i++) s += i < n ? '★' : '<span class="off">★</span>';
  return `<span class="stars">${s}</span>`;
}

function el<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

export class App {
  readonly diorama: Diorama;
  world: World;
  progress: Progress = { unlocked: 1, best: {}, tutorialDone: false, tiltShift: false };
  screen: Screen = 'menu';
  playing = false;
  speedIndex = 0;
  selected: string | null = null;
  private chosenMethod: MethodId = 'stone';
  private tickAcc = 0;
  private slowmo = 1;
  private cine: Cinematic | null = null;
  private alerts: AlertItem[] = [];
  private alertSeq = 0;
  private tutorialStep = -1;
  private lastFrame = performance.now();
  private panelKey = '';
  private ui: HTMLDivElement;
  private hud!: HTMLDivElement;
  private screenEl!: HTMLDivElement;
  private panelEl!: HTMLDivElement;
  private alertsEl!: HTMLDivElement;
  private bubbleEl!: HTMLDivElement;
  private cineEl!: HTMLDivElement;
  private townsEl!: HTMLDivElement;
  private toastTimer = 0;
  private slotsMode: 'save' | 'load' = 'load';
  private codexQueue: { id: CodexId; date: string }[] = [];
  ready = false;
  perf = { sim: 0, render: 0, hud: 0 };

  constructor(canvas: HTMLCanvasElement, ui: HTMLDivElement) {
    this.ui = ui;
    this.diorama = new Diorama(canvas);
    this.world = new World(1, 1);
    this.diorama.setWorld(this.world);
    this.buildDom();
    this.bindInput(canvas);
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('beforeunload', () => {
      if (this.screen === 'game' || this.screen === 'result') void this.save('auto');
    });
    this.resize();
    (window as unknown as { __game: unknown }).__game = this.testHooks();
  }

  async start(): Promise<void> {
    try {
      this.progress = await readProgress();
    } catch {
      // IndexedDB가 막힌 환경에서도 게임은 돈다
    }
    this.diorama.tiltShift = this.progress.tiltShift;
    await this.showMenu();
    this.ready = true;
    requestAnimationFrame((t) => this.frame(t));
  }

  // ───────────────────────── DOM ─────────────────────────

  private buildDom(): void {
    this.hud = el(`<div id="hud" class="hidden">
      <div class="stage-tag" data-b="stage-tag"></div>
      <div class="topbar">
        <div class="chip" data-testid="hud-date"><span data-b="season"></span><span data-b="date"></span></div>
        <div class="chip" data-testid="hud-weather" data-b="weather"></div>
        <div class="chip funds" data-testid="hud-funds"><span class="label">자금</span><span data-b="funds"></span></div>
        <div class="chip" data-testid="hud-trust"><span class="label">신뢰도</span><span data-b="trust"></span></div>
        <div class="speed" data-testid="speed">
          <button data-speed="0" title="일시정지 (Space)">⏸</button>
          <button data-speed="1" data-testid="speed-1">1x</button>
          <button data-speed="2" data-testid="speed-2">2x</button>
          <button data-speed="3" data-testid="speed-3">3x</button>
        </div>
        <button class="icon-btn" data-action="tilt" title="틸트시프트 효과">📷</button>
        <button class="icon-btn" data-action="open-save" data-testid="open-save" title="저장">💾</button>
        <button class="icon-btn" data-action="to-menu" title="메뉴로">🏠</button>
      </div>
      <div class="alerts" data-testid="alerts"></div>
      <div class="towns" data-testid="towns"></div>
      <div class="panel hidden" data-testid="panel"></div>
      <div class="bubble hidden" data-testid="tutorial"></div>
      <div class="cine hidden"><div class="big"></div><div class="skip">아무 키나 누르면 건너뜁니다</div></div>
    </div>`);
    this.screenEl = el(`<div id="screens"></div>`);
    this.ui.append(this.hud, this.screenEl);
    this.panelEl = this.hud.querySelector('.panel')!;
    this.alertsEl = this.hud.querySelector('.alerts')!;
    this.bubbleEl = this.hud.querySelector('.bubble')!;
    this.cineEl = this.hud.querySelector('.cine')!;
    this.townsEl = this.hud.querySelector('.towns')!;
    this.townsEl.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-town]')?.dataset.town;
      const l = this.world.townLayouts.find((t) => t.def.id === id);
      if (l) this.diorama.focusCell(l.def.x, l.def.y, 50);
    });

    this.hud.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const sp = t.closest('[data-speed]') as HTMLElement | null;
      if (sp) this.setSpeed(Number(sp.dataset.speed));
      const act = (t.closest('[data-action]') as HTMLElement | null)?.dataset.action;
      if (act === 'tilt') this.toggleTilt();
      if (act === 'open-save') void this.showSlots('save');
      if (act === 'to-menu') void this.leaveToMenu();
    });
    this.panelEl.addEventListener('click', (e) => this.onPanelClick(e));
    this.panelEl.addEventListener('input', (e) => this.onPanelInput(e));
    this.alertsEl.addEventListener('click', (e) => {
      const id = Number((e.target as HTMLElement).closest<HTMLElement>('[data-alert]')?.dataset.alert);
      const a = this.alerts.find((x) => x.id === id);
      if (!a) return;
      if (a.siteId) {
        this.diorama.focusSite(a.siteId);
        this.selectSite(a.siteId);
      } else if (a.townId) {
        const l = this.world.townLayouts.find((t) => t.def.id === a.townId);
        if (l) this.diorama.focusCell(l.def.x, l.def.y, 50);
      }
      this.alerts = this.alerts.filter((x) => x.id !== id);
      this.renderAlerts();
    });
    this.bubbleEl.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).dataset.action;
      if (act === 'tut-skip') this.finishTutorial();
      if (act === 'tut-next') this.advanceTutorial(this.tutorialStep + 1);
    });
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    let down: { x: number; y: number; t: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (this.cine) this.endCinematic();
    });
    canvas.addEventListener('pointerup', (e) => {
      if (!down || this.screen !== 'game') return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved < 6 && e.button === 0) {
        const id = this.diorama.pick(e.clientX, e.clientY);
        this.selectSite(id);
      }
      down = null;
    });
    window.addEventListener('keydown', (e) => {
      if (this.cine) {
        this.endCinematic();
        return;
      }
      if (this.screen !== 'game') return;
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.setSpeed(this.speedIndex === 0 ? 1 : 0);
      } else if (e.key === '1' || e.key === '2' || e.key === '3') this.setSpeed(Number(e.key));
      else if (e.key === 'Escape') this.selectSite(null);
    });
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.diorama.resize(w, h);
  }

  private toast(msg: string): void {
    this.ui.querySelector('.toast')?.remove();
    const t = el(`<div class="toast">${msg}</div>`);
    this.ui.append(t);
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.remove(), 2600);
  }

  // ───────────────────────── 화면 ─────────────────────────

  private setScreen(s: Screen, html = ''): void {
    this.screen = s;
    this.screenEl.innerHTML = html;
    this.hud.classList.toggle('hidden', s !== 'game');
    this.diorama.controls.autoRotate = s !== 'game';
    this.diorama.controls.autoRotateSpeed = 0.35;
  }

  async showMenu(): Promise<void> {
    this.playing = false;
    const hasSave = await latestSave().then(
      (r) => !!r,
      () => false,
    );
    this.setScreen(
      'menu',
      `<div class="screen" data-testid="main-menu"><div class="sheet" style="text-align:center">
        <h1 class="title">${GAME_TITLE}</h1>
        <p class="tagline">물을 모을수록 돈이 되고, 모을수록 위험해진다.</p>
        <div class="menu" style="margin:0 auto">
          <button class="btn primary" data-m="continue" data-testid="menu-continue" ${hasSave ? '' : 'disabled'}>이어하기</button>
          <button class="btn" data-m="new" data-testid="menu-new">스테이지 선택</button>
          <button class="btn" data-m="load" data-testid="menu-load">불러오기</button>
          <button class="btn" data-m="codex" data-testid="menu-codex">재난 도감</button>
        </div>
      </div></div>`,
    );
    this.screenEl.querySelector('.menu')!.addEventListener('click', (e) => {
      const m = (e.target as HTMLElement).closest<HTMLElement>('[data-m]')?.dataset.m;
      if (m === 'continue') void this.continueLatest();
      if (m === 'new') this.showStages();
      if (m === 'load') void this.showSlots('load');
      if (m === 'codex') void this.showCodex();
    });
  }

  showStages(): void {
    const cards = STAGES.map((s) => {
      const locked = s.id > this.progress.unlocked;
      const best = this.progress.best[s.id] ?? 0;
      return `<button class="stage-card ${locked ? 'locked' : ''}" data-stage="${s.id}" data-testid="stage-${s.id}" ${locked ? 'disabled' : ''}>
        <span class="n">스테이지 ${s.id}</span>
        <span class="nm">${locked ? '🔒 ' : ''}${s.name}</span>
        <span class="ds">${s.description}</span>
        <span>${starsHtml(best)}</span>
        <span class="n">목표 자금 ${won(s.targetFunds)} · 부지 ${s.sites.length}곳</span>
      </button>`;
    }).join('');
    this.setScreen(
      'stages',
      `<div class="screen dim" data-testid="stage-select"><div class="sheet">
        <div class="head"><h2>스테이지 선택</h2><button class="btn" data-back>← 뒤로</button></div>
        <div class="stages">${cards}</div>
      </div></div>`,
    );
    this.screenEl.addEventListener(
      'click',
      (e) => {
        const t = e.target as HTMLElement;
        if (t.closest('[data-back]')) return void this.showMenu();
        const id = Number(t.closest<HTMLElement>('[data-stage]')?.dataset.stage);
        if (id && id <= this.progress.unlocked) this.startStage(id);
        else this.showStages();
      },
      { once: true },
    );
  }

  startStage(stageId: number, seed?: number): void {
    const s = seed ?? (Date.now() & 0x7fffffff);
    this.enterGame(new World(stageId, s));
    if (stageId === 1 && !this.progress.tutorialDone) this.advanceTutorial(0);
  }

  private enterGame(world: World): void {
    this.world = world;
    this.diorama.setWorld(world);
    this.selected = null;
    this.alerts = [];
    this.renderAlerts();
    this.cine = null;
    this.slowmo = 1;
    this.tickAcc = 0;
    this.panelKey = '';
    this.tutorialStep = -1;
    this.bubbleEl.classList.add('hidden');
    this.setScreen('game');
    this.playing = true;
    this.setSpeed(0);
    this.selectSite(null);
    const st = this.world.stage;
    this.hud.querySelector('[data-b=stage-tag]')!.innerHTML = `스테이지 ${st.id} · ${st.name}<small>목표 자금 ${won(st.targetFunds)}</small>`;
    this.syncTiltButton();
    this.townsEl.innerHTML =
      '<div class="tt">마을</div>' +
      world.townLayouts
        .map(
          (l) => `<div class="town" data-town="${l.def.id}" title="눌러서 보기">
        <div class="nm">${l.def.name} <span data-t="flood"></span></div>
        <div class="kv"><span>신뢰도</span><div class="bar"><div data-t="trust"></div></div></div>
        <div class="kv"><span>오늘 용수</span><div class="bar water"><div data-t="water"></div></div></div>
      </div>`,
        )
        .join('');
    if (world.finished && world.result) this.showResult(world.result);
  }

  private async continueLatest(): Promise<void> {
    const rec = await latestSave();
    if (!rec) return this.toast('저장된 게임이 없습니다');
    this.loadRecord(rec.world);
  }

  private loadRecord(save: Parameters<typeof World.deserialize>[0]): void {
    try {
      this.enterGame(World.deserialize(save));
      this.toast(`불러왔습니다 · ${formatDate(this.world.date)}`);
    } catch (err) {
      this.toast('저장 데이터를 읽을 수 없습니다');
      console.warn(err);
    }
  }

  private async leaveToMenu(): Promise<void> {
    await this.save('auto');
    this.world = new World(1, 1);
    this.diorama.setWorld(this.world);
    await this.showMenu();
  }

  async showSlots(mode: 'save' | 'load'): Promise<void> {
    this.slotsMode = mode;
    const prev = this.screen;
    if (mode === 'save') this.setSpeed(0);
    const saves = await listSaves();
    const slots: SlotId[] = mode === 'load' ? ['auto', ...MANUAL_SLOTS] : MANUAL_SLOTS;
    const rows = slots
      .map((slot) => {
        const r = saves.find((x) => x.slot === slot);
        const name = slot === 'auto' ? '자동 저장' : `슬롯 ${slot.slice(4)}`;
        const info = r ? `${r.stageName} · ${r.dateLabel} · ${won(r.funds)}<br>${new Date(r.savedAt).toLocaleString('ko-KR')}` : '비어 있음';
        const btn =
          mode === 'save'
            ? `<button class="btn primary small" data-slot="${slot}" data-testid="save-${slot}">여기에 저장</button>`
            : `<button class="btn primary small" data-slot="${slot}" data-testid="load-${slot}" ${r ? '' : 'disabled'}>불러오기</button>`;
        return `<div class="slot"><div><div class="nm">${name}</div><div class="info">${info}</div></div>${btn}</div>`;
      })
      .join('');
    const html = `<div class="screen dim" data-testid="slots"><div class="sheet">
      <div class="head"><h2>${mode === 'save' ? '저장하기' : '불러오기'}</h2><button class="btn" data-close data-testid="slots-close">닫기</button></div>
      <div class="slots">${rows}</div></div></div>`;
    if (prev === 'game') {
      this.screenEl.innerHTML = html;
      this.screen = 'slots';
      this.hud.classList.remove('hidden');
    } else this.setScreen('slots', html);
    const onClick = async (e: Event) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-close]')) {
        this.screenEl.removeEventListener('click', onClick);
        if (prev === 'game' || this.hasGame()) {
          this.screenEl.innerHTML = '';
          this.screen = 'game';
        } else await this.showMenu();
        return;
      }
      const slot = t.closest<HTMLElement>('[data-slot]')?.dataset.slot as SlotId | undefined;
      if (!slot) return;
      this.screenEl.removeEventListener('click', onClick);
      if (this.slotsMode === 'save') {
        await this.save(slot);
        this.toast(`슬롯 ${slot.slice(4)}에 저장했습니다`);
        this.screenEl.innerHTML = '';
        this.screen = 'game';
      } else {
        const r = await readSave(slot);
        if (r) this.loadRecord(r.world);
      }
    };
    this.screenEl.addEventListener('click', onClick);
  }

  private hasGame(): boolean {
    return !this.hud.classList.contains('hidden');
  }

  async save(slot: SlotId): Promise<void> {
    const w = this.world;
    try {
      await writeSave({
        slot,
        stageId: w.stage.id,
        stageName: w.stage.name,
        dateLabel: formatDate(w.date),
        funds: w.economy.funds,
        world: w.serialize(),
      });
    } catch (err) {
      console.warn('저장 실패', err);
    }
  }

  async showCodex(): Promise<void> {
    const entries = await readCodex();
    const items = CODEX.map((c) => {
      const e = entries[c.id];
      const pic = e?.thumb ? `<img src="${e.thumb}" alt="${c.name}">` : `<div class="ic">${c.icon}</div>`;
      return `<div class="codex-item ${e ? '' : 'locked'}" data-testid="codex-${c.id}">
        ${e ? pic : `<div class="ic">❔</div>`}
        <div class="nm">${e ? c.name : '???'}</div>
        <div class="dt">${e ? `${e.stageName} · ${e.dateLabel}` : c.hint}</div>
        ${e ? `<div class="dt" style="margin-top:4px">${c.text}</div>` : ''}
      </div>`;
    }).join('');
    const count = Object.keys(entries).length;
    this.setScreen(
      'codex',
      `<div class="screen dim" data-testid="codex"><div class="sheet">
        <div class="head"><h2>재난 도감 <small style="font-size:15px;color:var(--ink-soft)">${count} / ${CODEX.length}</small></h2><button class="btn" data-back>← 뒤로</button></div>
        <p class="tagline" style="margin:6px 0 0">실패도 구경거리다. 처음 겪는 재난은 여기에 기록된다.</p>
        <div class="codex">${items}</div>
      </div></div>`,
    );
    this.screenEl.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-back]')) void this.showMenu();
    });
  }

  private showResult(r: StageResult): void {
    const st = this.world.stage;
    const next = STAGES.find((s) => s.id === st.id + 1);
    const canNext = next && r.stars >= 1;
    this.setSpeed(0);
    if (this.cine) this.endCinematic();
    this.diorama.resetCamera();
    const reasons: string[] = [];
    if (r.funds < r.targetFunds) reasons.push(`목표 자금 ${won(r.targetFunds)}에 못 미쳤어요`);
    else if (r.stars < 3) {
      if (r.bigFloods) reasons.push(`대형 침수 ${r.bigFloods}회`);
      if (r.reliefCount) reasons.push(`복구 지원금 ${r.reliefCount}회`);
      if (r.emergencyCount) reasons.push(`긴급 지원금 ${r.emergencyCount}회`);
    }
    this.setScreen(
      'result',
      `<div class="screen dim" data-testid="result"><div class="sheet" style="min-width:min(420px,92vw)">
        <h2 style="text-align:center;margin:0">${st.name} · 3년 완주</h2>
        <div class="result-stars" data-testid="result-stars">${starsHtml(r.stars)}</div>
        ${reasons.length ? `<p style="text-align:center;color:var(--ink-soft);margin:0">${reasons.join(' · ')}</p>` : ''}
        <table class="result-table">
          <tr><td>최종 자금</td><td data-testid="result-funds">${won(r.funds)}</td></tr>
          <tr><td>목표 자금</td><td>${won(r.targetFunds)}</td></tr>
          <tr><td>총 피해액</td><td>${won(r.totalDamage)}</td></tr>
          <tr><td>붕괴 횟수</td><td>${r.collapses}회</td></tr>
          <tr><td>대형 침수</td><td>${r.bigFloods}회</td></tr>
          <tr><td>용수 계약 충족률</td><td>${Math.round(r.contractRate * 100)}%</td></tr>
        </table>
        <div class="menu">
          ${canNext ? `<button class="btn primary" data-r="next" data-testid="result-next">다음 스테이지: ${next!.name}</button>` : ''}
          <button class="btn" data-r="retry">다시 하기</button>
          <button class="btn" data-r="stages">스테이지 선택</button>
        </div>
      </div></div>`,
    );
    this.screenEl.addEventListener(
      'click',
      (e) => {
        const r2 = (e.target as HTMLElement).closest<HTMLElement>('[data-r]')?.dataset.r;
        if (r2 === 'next' && next) this.startStage(next.id);
        else if (r2 === 'retry') this.startStage(st.id);
        else if (r2 === 'stages') this.showStages();
        else this.showResult(r);
      },
      { once: true },
    );
  }

  // ───────────────────────── 진행 ─────────────────────────

  setSpeed(i: number): void {
    this.speedIndex = i;
    this.hud.querySelectorAll<HTMLElement>('[data-speed]').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === i));
    if (i > 0 && this.tutorialStep === 2) this.advanceTutorial(3);
  }

  private toggleTilt(): void {
    this.diorama.tiltShift = !this.diorama.tiltShift;
    this.progress.tiltShift = this.diorama.tiltShift;
    void writeProgress(this.progress).catch(() => {});
    this.syncTiltButton();
    this.toast(`틸트시프트 ${this.diorama.tiltShift ? '켬' : '끔'}`);
  }

  private syncTiltButton(): void {
    this.hud.querySelector('[data-action=tilt]')!.classList.toggle('on', this.diorama.tiltShift);
  }

  private frame(now: number): void {
    const real = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    // 시뮬레이션은 느린 기기에서도 실제 시간을 따라가게 1초까지 따라잡고, 연출은 0.1초로 끊는다
    const dt = Math.min(0.1, real);
    const simDt = Math.min(1, real);
    if (this.screen === 'game' && this.playing && !this.world.finished) {
      this.tickAcc += simDt * SPEEDS[this.speedIndex] * TICKS_PER_SEC_1X * this.slowmo;
      let n = Math.floor(this.tickAcc);
      this.tickAcc -= n;
      n = Math.min(n, MAX_TICKS_PER_FRAME);
      this.advance(n);
    }
    if (this.cine) this.updateCinematic(dt);
    const t1 = performance.now();
    this.diorama.update(dt, now / 1000);
    const t2 = performance.now();
    if (this.screen === 'game' || this.screen === 'slots') this.updateHud();
    const t3 = performance.now();
    this.perf = { sim: t1 - now, render: t2 - t1, hud: t3 - t2 };
    if (this.codexQueue.length) this.flushCodex();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** n틱 진행하고 이벤트를 처리한다 */
  advance(n: number): void {
    for (let k = 0; k < n && !this.world.finished; k++) {
      this.world.step();
      const ev = this.world.drainEvents();
      if (ev.length) this.handleEvents(ev);
    }
  }

  private handleEvents(events: WorldEvent[]): void {
    const w = this.world;
    for (const e of events) {
      const siteName = e.siteId ? w.sites.find((s) => s.def.id === e.siteId)?.def.name : '';
      const townName = e.townId ? w.townLayouts.find((t) => t.def.id === e.townId)?.def.name : '';
      switch (e.type) {
        case 'collapse':
          this.pushAlert(`💥 ${siteName} 댐이 무너졌습니다!`, '재건하려면 댐을 눌러 주세요', 'danger', e.siteId);
          this.codexQueue.push({ id: 'firstCollapse', date: formatDate(w.date) });
          this.startCinematic(e.siteId!);
          break;
        case 'chainCollapse':
          this.codexQueue.push({ id: 'chainCollapse', date: formatDate(w.date) });
          break;
        case 'overtopStart':
          this.pushAlert(`🌊 ${siteName} 월류 중`, '물이 댐을 넘고 있어요. 수문을 여세요!', 'danger', e.siteId);
          this.codexQueue.push({ id: 'overtop', date: formatDate(w.date) });
          break;
        case 'dangerLevel':
          this.pushAlert(`⚠️ ${siteName} 수위 90% 초과`, '위험 구간입니다', 'warn', e.siteId);
          break;
        case 'lowDurability':
          this.pushAlert(`🧱 ${siteName} 내구도 20% 미만`, '보수가 필요합니다', 'warn', e.siteId);
          break;
        case 'floodStart':
          this.pushAlert(`🏠 ${townName} 침수 시작`, '마을에 물이 들어옵니다', 'danger', undefined, e.townId);
          break;
        case 'bigFlood':
          this.pushAlert(`🏚️ ${townName} 대형 침수!`, '시설 30% 이상이 잠겼습니다', 'danger', undefined, e.townId);
          this.codexQueue.push({ id: 'sunkenTown', date: formatDate(w.date) });
          break;
        case 'relief':
          this.pushAlert(`💰 복구 지원금 ${won(e.amount ?? 0)}`, '★★★ 조건에서 감점됩니다', 'info', undefined, e.townId);
          break;
        case 'emergency':
          this.pushAlert('🆘 긴급 지원금', '자금이 바닥나 0원까지 메워 받았습니다 (감점)', 'info');
          break;
        case 'dryRiverbed':
          this.pushAlert(`🏜️ ${siteName} 강바닥이 드러났습니다`, '수위 10% 미만', 'warn', e.siteId);
          this.codexQueue.push({ id: 'dryRiverbed', date: formatDate(w.date) });
          break;
        case 'monthStart':
          void this.save('auto');
          break;
        case 'stageEnd':
          void this.onStageEnd();
          break;
        case 'built':
          if (this.tutorialStep === 0) this.advanceTutorial(1);
          break;
      }
    }
  }

  private async onStageEnd(): Promise<void> {
    const r = this.world.result!;
    const id = this.world.stage.id;
    this.progress.best[id] = Math.max(this.progress.best[id] ?? 0, r.stars);
    if (r.stars >= 1) this.progress.unlocked = Math.max(this.progress.unlocked, Math.min(STAGES.length, id + 1));
    try {
      await writeProgress(this.progress);
    } catch {
      /* 저장 불가 환경 */
    }
    await this.save('auto');
    this.showResult(r);
  }

  private flushCodex(): void {
    const seen = new Set<CodexId>();
    const items = this.codexQueue.filter((q) => !seen.has(q.id) && seen.add(q.id));
    this.codexQueue = [];
    const thumb = this.captureThumb();
    for (const { id, date } of items) {
      void unlockCodex({ id, unlockedAt: Date.now(), dateLabel: date, stageName: this.world.stage.name, thumb })
        .then((isNew) => {
          if (isNew) {
            const c = CODEX.find((x) => x.id === id)!;
            this.pushAlert(`📖 도감 해금: ${c.name}`, c.text, 'good');
          }
        })
        .catch(() => {});
    }
  }

  private captureThumb(): string | undefined {
    try {
      this.diorama.renderNow();
      const src = this.diorama.renderer.domElement;
      const c = document.createElement('canvas');
      c.width = 240;
      c.height = 135;
      const g = c.getContext('2d')!;
      const sw = src.width;
      const sh = Math.round(sw * (135 / 240));
      g.drawImage(src, 0, Math.max(0, (src.height - sh) / 2), sw, Math.min(sh, src.height), 0, 0, 240, 135);
      return c.toDataURL('image/jpeg', 0.7);
    } catch {
      return undefined;
    }
  }

  // ───────────────────────── 재난 연출 ─────────────────────────

  private startCinematic(siteId: string): void {
    if (this.screen !== 'game') return;
    const c = this.diorama.camera.position;
    const t = this.diorama.controls.target;
    this.cine = { siteId, t: 0, phase: 0, camPos: { x: c.x, y: c.y, z: c.z }, camTarget: { x: t.x, y: t.y, z: t.z } };
    this.slowmo = 0.3;
    this.diorama.focusSite(siteId, 58);
    this.diorama.splash(siteId);
    this.hud.classList.add('letterbox');
    const name = this.world.sites.find((s) => s.def.id === siteId)?.def.name ?? '';
    this.cineEl.querySelector('.big')!.textContent = `💥 ${name} 붕괴!`;
    this.cineEl.classList.remove('hidden');
  }

  private updateCinematic(dt: number): void {
    const c = this.cine!;
    c.t += dt;
    if (c.phase === 0 && c.t > 1.6) {
      c.phase = 1;
      const s = this.world.sites.find((x) => x.def.id === c.siteId)!;
      const dx = s.def.flow === 'E' ? 22 : 0;
      const dy = s.def.flow === 'S' ? 18 : s.def.flow === 'N' ? -18 : 0;
      this.diorama.focusCell(Math.min(this.world.terrain.w - 8, s.cx + dx), s.cy + dy, 64, 2.2);
    }
    if (c.t > 4.2) this.endCinematic();
  }

  private endCinematic(): void {
    if (this.cine) this.diorama.tweenCamera(this.cine.camPos, this.cine.camTarget, 1.2);
    this.cine = null;
    this.slowmo = 1;
    this.hud.classList.remove('letterbox');
    this.cineEl.classList.add('hidden');
  }

  get inCinematic(): boolean {
    return this.cine !== null;
  }

  // ───────────────────────── 알림 ─────────────────────────

  private pushAlert(text: string, sub: string, kind: AlertItem['kind'], siteId?: string, townId?: string): void {
    this.alerts.unshift({ id: ++this.alertSeq, text, sub, kind, siteId, townId, born: performance.now() });
    this.alerts = this.alerts.slice(0, 5);
    this.renderAlerts();
  }

  private renderAlerts(): void {
    this.alertsEl.innerHTML = this.alerts
      .map((a) => `<div class="alert ${a.kind}" data-alert="${a.id}">${a.text}<small>${a.sub}${a.siteId || a.townId ? ' · 눌러서 보기' : ''}</small></div>`)
      .join('');
  }

  // ───────────────────────── 튜토리얼 ─────────────────────────

  private advanceTutorial(step: number): void {
    if (this.progress.tutorialDone && step > 0 && this.tutorialStep < 0) return;
    this.tutorialStep = step;
    const texts = [
      '🚩 깃발이 꽂힌 곳이 댐 부지예요. 깃발을 눌러 댐을 지어 보세요!',
      '🚪 수문 슬라이더로 물을 하류로 내보낼 수 있어요. 수위 게이지의 빨간 구간에 닿지 않게 관리해요.',
      '⏩ 위쪽 배속 버튼(1x·2x·3x)으로 시간을 흘려 보세요. 언제든 ⏸로 멈출 수 있어요.',
    ];
    if (step >= texts.length) return this.finishTutorial();
    this.bubbleEl.innerHTML = `${texts[step]}<div style="display:flex;gap:6px">${step === 1 ? '<button class="btn small" data-action="tut-next">알겠어요</button>' : ''}<button class="btn small" data-action="tut-skip">튜토리얼 건너뛰기</button></div>`;
    this.bubbleEl.classList.remove('hidden');
  }

  private finishTutorial(): void {
    this.tutorialStep = -1;
    this.bubbleEl.classList.add('hidden');
    this.progress.tutorialDone = true;
    void writeProgress(this.progress).catch(() => {});
  }

  private positionBubble(): void {
    if (this.tutorialStep < 0) return;
    const b = this.bubbleEl;
    if (this.tutorialStep === 0) {
      const p = this.diorama.siteScreenPos(this.world.sites[0].def.id);
      if (p) {
        b.style.left = `${Math.max(8, p.x - 30)}px`;
        b.style.top = `${Math.max(70, p.y - b.offsetHeight - 26)}px`;
      }
      b.classList.remove('above-none');
    } else if (this.tutorialStep === 1) {
      const r = this.panelEl.getBoundingClientRect();
      b.style.left = `${Math.max(8, r.left - 280)}px`;
      b.style.top = `${r.top + 150}px`;
      b.classList.add('above-none');
    } else {
      const sp = this.hud.querySelector('.speed')!.getBoundingClientRect();
      b.style.left = `${Math.max(8, sp.left - 40)}px`;
      b.style.top = `${sp.bottom + 14}px`;
      b.classList.add('above-none');
    }
  }

  // ───────────────────────── HUD ─────────────────────────

  private updateHud(): void {
    const w = this.world;
    const d = w.date;
    const season = seasonOfMonth(d.month);
    const seasonIcon = { spring: '🌸', summer: '☀️', autumn: '🍂', winter: '❄️' }[season];
    const monsoon = w.today.season === 'monsoon';
    this.setText('season', `${seasonIcon} ${SEASON_NAMES[season]}${monsoon ? '·장마' : ''}`);
    this.setText('date', `${formatDate(d)} ${String(d.hour).padStart(2, '0')}시`);
    const r = w.today.rain;
    this.setText('weather', r <= 0 ? '☀️ 맑음' : r < 1 ? '🌦️ 약한 비' : r < 2.5 ? '🌧️ 비' : '⛈️ 폭우');
    this.setText('funds', won(w.economy.funds));
    const trust = w.towns.reduce((a, t) => a + t.trust, 0) / Math.max(1, w.towns.length);
    this.setText('trust', `${trust < 40 ? '😟' : trust < 70 ? '🙂' : '😊'} ${Math.round(trust)}`);
    this.updatePanel();
    this.updateTowns();
    this.positionBubble();
    const now = performance.now();
    const before = this.alerts.length;
    this.alerts = this.alerts.filter((a) => now - a.born < 9000);
    if (this.alerts.length !== before) this.renderAlerts();
  }

  private updateTowns(): void {
    const w = this.world;
    const dry = w.today.season === 'winter';
    const hour = w.date.hour + 1;
    w.townLayouts.forEach((l, i) => {
      const box = this.townsEl.querySelector<HTMLElement>(`[data-town="${l.def.id}"]`);
      if (!box) return;
      const t = w.towns[i];
      const trust = box.querySelector<HTMLElement>('[data-t=trust]')!;
      trust.style.width = `${t.trust}%`;
      trust.className = t.trust < 30 ? 'low' : t.trust < 60 ? 'mid' : '';
      // 용수: 하루 요구량 대비 지금까지 흘려보낸 양 (시간 비례로 기대치와 비교)
      const demand = l.def.demandPerDay * (dry ? ECONOMY.DRY_DEMAND_MULT : 1);
      const water = box.querySelector<HTMLElement>('[data-t=water]')!;
      const pace = t.flowToday / Math.max(1e-6, (demand * hour) / TIME.TICKS_PER_DAY);
      water.style.width = `${Math.min(100, (t.flowToday / demand) * 100)}%`;
      water.className = pace < 0.8 ? 'low' : '';
      const fl = box.querySelector<HTMLElement>('[data-t=flood]')!;
      const txt = t.floodRatio > 0 ? `🌊 침수 ${Math.round(t.floodRatio * 100)}%` : '';
      if (fl.textContent !== txt) fl.textContent = txt;
      box.classList.toggle('flooding', t.floodRatio >= 0.3);
    });
  }

  private setText(key: string, text: string): void {
    const e = this.hud.querySelector<HTMLElement>(`[data-b="${key}"]`);
    if (e && e.textContent !== text) e.textContent = text;
  }

  selectSite(id: string | null): void {
    this.selected = id;
    this.diorama.select(id);
    this.panelKey = '';
    this.updatePanel();
  }

  private updatePanel(): void {
    const id = this.selected;
    if (!id) {
      this.panelEl.classList.add('hidden');
      return;
    }
    const w = this.world;
    const i = w.siteIndex(id);
    const site = w.sites[i];
    const dam = w.dams[i];
    const key = `${id}:${dam ? `${dam.method}:${dam.status}:${UPGRADE_AXES.map((a) => dam.levels[a]).join('')}` : `empty:${this.chosenMethod}`}`;
    if (key !== this.panelKey) {
      this.panelKey = key;
      this.panelEl.innerHTML = dam ? this.damPanelHtml(i) : this.sitePanelHtml(i);
      this.panelEl.classList.remove('hidden');
    }
    const funds = w.economy.funds;
    if (!dam) {
      const btn = this.panelEl.querySelector<HTMLButtonElement>('[data-p=build]');
      if (btn) btn.disabled = funds < buildCost(site.def, this.chosenMethod);
      return;
    }
    if (dam.status === 'collapsed') {
      const btn = this.panelEl.querySelector<HTMLButtonElement>('[data-p=rebuild]');
      if (btn) btn.disabled = funds < rebuildCost(site.def, dam.method);
      return;
    }
    const lv = dam.level;
    const fill = this.panelEl.querySelector<HTMLElement>('[data-b=level-fill]')!;
    fill.style.height = `${Math.min(100, lv * 100)}%`;
    fill.classList.toggle('danger', lv >= DAM.DANGER_LEVEL);
    const sp = this.panelEl.querySelector<HTMLElement>('[data-b=sp]');
    if (sp) {
      sp.style.bottom = `${dam.autoSetpoint * 100}%`;
      sp.classList.toggle('hidden', !(dam.autoEnabled && dam.levels.auto > 0));
    }
    this.setPanelText('level-text', `${Math.round(lv * 100)}%${dam.overtopping ? ' 🌊월류!' : ''}`);
    const maxD = maxDurability(dam);
    const dp = dam.durability / maxD;
    const df = this.panelEl.querySelector<HTMLElement>('[data-b=dur-fill]')!;
    df.style.width = `${dp * 100}%`;
    df.className = dp < 0.2 ? 'low' : dp < 0.5 ? 'mid' : '';
    this.setPanelText('dur-text', `${Math.ceil(dam.durability)} / ${Math.round(maxD)}`);
    this.setPanelText('release', `${dam.releasePerTick.toFixed(2)} / 시간 (최대 ${maxRelease(dam).toFixed(1)})`);
    this.setPanelText('head', `${dam.head.toFixed(2)} m`);
    this.setPanelText('gate-text', `${Math.round(dam.gate * 100)}%${dam.opening > dam.gate + 0.01 ? ` (자동 ${Math.round(dam.opening * 100)}%)` : ''}`);
    const slider = this.panelEl.querySelector<HTMLInputElement>('[data-p=gate]');
    if (slider && document.activeElement !== slider) slider.value = String(Math.round(dam.gate * 100));
    for (const axis of UPGRADE_AXES) {
      const b = this.panelEl.querySelector<HTMLButtonElement>(`[data-up=${axis}]`);
      if (b) b.disabled = !canUpgrade(dam, axis) || funds < upgradeCost(site.def, dam, axis);
    }
    const rep = this.panelEl.querySelector<HTMLButtonElement>('[data-p=repair]')!;
    const rc = repairCost(dam);
    rep.disabled = rc <= 0 || funds < rc;
    rep.textContent = rc > 0 ? `🔧 보수 ${won(rc)}` : '🔧 튼튼함';
  }

  private setPanelText(key: string, text: string): void {
    const e = this.panelEl.querySelector<HTMLElement>(`[data-b="${key}"]`);
    if (e && e.textContent !== text) e.textContent = text;
  }

  private sitePanelHtml(i: number): string {
    const s = this.world.sites[i];
    const cards = (['earth', 'stone', 'concrete'] as MethodId[])
      .map((m) => {
        const st = METHODS[m];
        const feat = m === 'earth' ? '싸지만 월류에 매우 약함' : m === 'stone' ? '균형형' : `발전 효율 +${Math.round((st.powerEfficiency - 1) * 100)}%`;
        return `<button class="card ${this.chosenMethod === m ? 'sel' : ''}" data-method="${m}" data-testid="method-${m}">
          <div class="t"><span>${st.name}</span><span>${won(buildCost(s.def, m))}</span></div>
          <div class="d">내구도 ${st.baseDurability} · 업그레이드 최대 ${st.maxUpgrade}단계</div>
          <div class="d">${feat} · 월 유지비 ${won(st.upkeepPerMonth)}</div>
        </button>`;
      })
      .join('');
    const kind = s.def.kind === 'narrow' ? '좁은 협곡 — 싸지만 저수량이 작다' : '넓은 부지 — 비싸지만 저수량이 크다';
    const w = this.world;
    const margin = upstreamTownMargin(s, crestOf(s, newDam(s.def.id, 'stone')), w.terrain.ground, w.townLayouts, TOWN.FLOOD_DEPTH);
    const upstreamNote = Number.isFinite(margin)
      ? `<div class="sub">⬆ 상류에 마을이 있어요. 저수 용량을 너무 올리면 역류로 잠길 수 있어요.</div>`
      : '';
    return `<button class="close" data-p="close">✕</button>
      <h3>🚩 ${s.def.name}</h3><div class="sub">${kind}</div>${upstreamNote}
      <div class="section-title">공법 선택 (건설 후 바꿀 수 없음)</div>
      <div class="cards">${cards}</div>
      <div class="row"><button class="btn primary" style="flex:1" data-p="build" data-testid="build-confirm">건설하기</button></div>`;
  }

  private damPanelHtml(i: number): string {
    const w = this.world;
    const s = w.sites[i];
    const dam = w.dams[i]!;
    const m = METHODS[dam.method];
    if (dam.status === 'collapsed') {
      return `<button class="close" data-p="close">✕</button>
        <h3>💥 ${s.def.name}</h3><div class="sub">${m.name} · 무너짐</div>
        <p style="font-size:13px">댐이 무너졌습니다. 같은 공법과 업그레이드로 다시 쌓을 수 있어요.</p>
        <button class="btn warn" style="width:100%" data-p="rebuild" data-testid="rebuild">재건 ${won(rebuildCost(s.def, dam.method))}</button>`;
    }
    const ups = UPGRADE_AXES.map((a: UpgradeAxis) => {
      const lvl = dam.levels[a];
      const max = m.maxUpgrade;
      const pips = '●'.repeat(lvl) + '○'.repeat(Math.max(0, max - lvl));
      const can = canUpgrade(dam, a);
      let warn = '';
      if (a === 'capacity' && can) {
        const m = upstreamTownMargin(s, crestOf(s, dam) + DAM.CAPACITY_STEP, w.terrain.ground, w.townLayouts, TOWN.FLOOD_DEPTH);
        if (m < 1) warn = `<div class="warn">⚠ 더 높이면 상류 마을이 역류로 잠길 수 있어요</div>`;
      }
      return `<div class="upg"><div>${UPGRADE_NAMES[a]} <span class="pips">${pips}</span>${warn}</div>
        <button class="btn small" data-up="${a}" data-testid="upgrade-${a}">${can ? won(upgradeCost(s.def, dam, a)) : '최대'}</button></div>`;
    }).join('');
    const auto =
      dam.levels.auto > 0
        ? `<div class="toggle"><label><input type="checkbox" data-p="auto" ${dam.autoEnabled ? 'checked' : ''}> 자동 수문</label>
           <span>설정 수위</span><input type="range" min="40" max="95" value="${Math.round(dam.autoSetpoint * 100)}" data-p="autosp" style="flex:1"></div>`
        : '';
    return `<button class="close" data-p="close">✕</button>
      <h3>${s.def.name}</h3><div class="sub">${m.name} · ${s.def.kind === 'narrow' ? '좁은 협곡' : '넓은 부지'}</div>
      <div class="gauge-wrap">
        <div class="gauge" data-testid="level-gauge"><div class="zone"></div><div class="fill" data-b="level-fill"></div><div class="sp hidden" data-b="sp"></div></div>
        <div class="stats">
          수위 <b data-b="level-text" data-testid="level-text"></b><br>
          방류 <span data-b="release"></span><br>
          낙차 <span data-b="head"></span><br>
          <div style="margin-top:6px">내구도 <span data-b="dur-text"></span></div>
          <div class="bar"><div data-b="dur-fill"></div></div>
        </div>
      </div>
      <div class="section-title">수문 방류율 <span data-b="gate-text"></span></div>
      <input class="slider" type="range" min="0" max="100" step="1" value="${Math.round(dam.gate * 100)}" data-p="gate" data-testid="gate-slider">
      ${auto}
      <div class="section-title">업그레이드</div>
      <div class="upgrades">${ups}</div>
      <div class="row"><button class="btn" style="flex:1" data-p="repair" data-testid="repair"></button></div>`;
  }

  private onPanelClick(e: Event): void {
    const t = e.target as HTMLElement;
    const id = this.selected;
    if (!id) return;
    const method = t.closest<HTMLElement>('[data-method]')?.dataset.method as MethodId | undefined;
    if (method) {
      this.chosenMethod = method;
      this.panelKey = '';
      return;
    }
    const up = t.closest<HTMLElement>('[data-up]')?.dataset.up as UpgradeAxis | undefined;
    if (up) {
      const r = this.world.upgrade(id, up);
      this.toast(r.ok ? `${UPGRADE_NAMES[up]} 업그레이드 (−${won(r.cost ?? 0)})` : r.reason ?? '');
      return;
    }
    const p = t.closest<HTMLElement>('[data-p]')?.dataset.p;
    if (p === 'close') this.selectSite(null);
    if (p === 'build') {
      const r = this.world.build(id, this.chosenMethod);
      this.toast(r.ok ? `${METHODS[this.chosenMethod].name} 건설 완료 (−${won(r.cost ?? 0)})` : r.reason ?? '');
      this.handleEvents(this.world.drainEvents());
    }
    if (p === 'repair') {
      const r = this.world.repair(id);
      this.toast(r.ok ? `보수 완료 (−${won(r.cost ?? 0)})` : r.reason ?? '');
    }
    if (p === 'rebuild') {
      const r = this.world.rebuild(id);
      this.toast(r.ok ? `재건 완료 (−${won(r.cost ?? 0)})` : r.reason ?? '');
    }
  }

  private onPanelInput(e: Event): void {
    const t = e.target as HTMLInputElement;
    const id = this.selected;
    if (!id) return;
    if (t.dataset.p === 'gate') {
      this.world.setGate(id, Number(t.value) / 100);
      if (this.tutorialStep === 1) this.advanceTutorial(2);
    }
    if (t.dataset.p === 'auto') this.world.setAuto(id, t.checked);
    if (t.dataset.p === 'autosp') {
      const d = this.world.dam(id);
      if (d) this.world.setAuto(id, d.autoEnabled, Number(t.value) / 100);
    }
  }

  // ───────────────────────── 테스트 훅 ─────────────────────────

  private testHooks() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const app = this;
    return {
      get ready() {
        return app.ready;
      },
      get screen() {
        return app.screen;
      },
      get inCinematic() {
        return app.inCinematic;
      },
      topView() {
        app.diorama.camera.position.set(0, 170, 1);
        app.diorama.controls.target.set(0, 0, 0);
      },
      startStage(id: number, seed: number) {
        app.startStage(id, seed);
      },
      gfx(pixelRatio: number, shadows: boolean) {
        app.diorama.setQuality(pixelRatio, shadows);
      },
      get perf() {
        return { ...app.perf, ...app.diorama.perf };
      },
      state() {
        const w = app.world;
        return {
          stageId: w.stage.id,
          tick: w.tick,
          dayIndex: w.date.dayIndex,
          date: formatDate(w.date),
          funds: w.economy.funds,
          finished: w.finished,
          dams: w.dams.map((d) =>
            d ? { siteId: d.siteId, method: d.method, status: d.status, gate: d.gate, level: d.level, durability: d.durability, levels: { ...d.levels } } : null,
          ),
        };
      },
      siteScreenPos(id: string) {
        return app.diorama.siteScreenPos(id);
      },
      siteIds() {
        return app.world.sites.map((s) => s.def.id);
      },
      /** 화면 연출 없이 n일을 빠르게 진행 (스크린샷용) */
      skipDays(n: number) {
        app.advance(n * TIME.TICKS_PER_DAY);
      },
      skipToDay(day: number) {
        const target = day * TIME.TICKS_PER_DAY;
        app.advance(Math.max(0, target - app.world.tick));
      },
      /** 장마철 비 오는 날까지 빠르게 진행 */
      skipToRain(minDay: number, minRain = 1.2) {
        const target = minDay * TIME.TICKS_PER_DAY;
        app.advance(Math.max(0, target - app.world.tick));
        for (let k = 0; k < 120 && app.world.today.rain < minRain; k++) app.advance(TIME.TICKS_PER_DAY);
        app.advance(6);
        return app.world.today.rain;
      },
      selectSite(id: string | null) {
        app.selectSite(id);
      },
      setDurability(siteId: string, v: number) {
        const d = app.world.dam(siteId);
        if (d) d.durability = v;
      },
      setGate(siteId: string, v: number) {
        app.world.setGate(siteId, v);
      },
      build(siteId: string, method: MethodId) {
        const r = app.world.build(siteId, method);
        app.handleEvents(app.world.drainEvents());
        return r;
      },
      focus(siteId: string) {
        app.diorama.focusSite(siteId, 60);
      },
      resetCamera() {
        app.diorama.resetCamera();
      },
      stageName(id: number) {
        return getStage(id).name;
      },
    };
  }
}
