import { expect, test } from '@playwright/test';
import { buildViaUi, clearStorage, openGame, startStage1, state } from './helpers';

test.describe.configure({ mode: 'serial' });

test('1. 페이지를 로드했을 때 콘솔 에러가 0건이다', async ({ page }) => {
  const errors: string[] = [];
  await openGame(page, errors);
  await page.waitForTimeout(2000);
  await expect(page.getByTestId('main-menu')).toBeVisible();
  expect(errors).toEqual([]);
});

test('2. 스테이지 1에서 UI로 부지를 클릭·공법 선택·건설하면 자금이 차감되고 댐이 생긴다', async ({ page }) => {
  const errors: string[] = [];
  await openGame(page, errors);
  await clearStorage(page);
  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.ready === true);
  await startStage1(page);
  const before = await state(page);
  expect(before.dams.every((d) => d === null)).toBe(true);
  await buildViaUi(page, 's1a', 'stone');
  await expect(page.getByTestId('gate-slider')).toBeVisible();
  const after = await state(page);
  expect(after.funds).toBeLessThan(before.funds);
  expect(after.dams[0]).toMatchObject({ siteId: 's1a', method: 'stone', status: 'ok' });
  expect(errors).toEqual([]);
});

test('3. 수문 슬라이더를 조작하면 수위 표시가 변한다', async ({ page }) => {
  const errors: string[] = [];
  await openGame(page, errors);
  await startStage1(page);
  await buildViaUi(page, 's1a', 'stone');
  const slider = page.getByTestId('gate-slider');
  // 수문을 닫고 시간을 흘려 물을 채운다
  await slider.fill('0');
  await page.getByTestId('speed-3').click();
  await page.waitForTimeout(4000);
  const closedText = await page.getByTestId('level-text').textContent();
  const closed = (await state(page)).dams[0]!;
  expect(closed.gate).toBe(0);
  // 수문을 활짝 열면 수위가 내려간다
  await slider.fill('100');
  await page.waitForTimeout(5000);
  const openText = await page.getByTestId('level-text').textContent();
  const opened = (await state(page)).dams[0]!;
  expect(opened.gate).toBe(1);
  expect(openText).not.toBe(closedText);
  expect(opened.level).toBeLessThan(closed.level);
  expect(errors).toEqual([]);
});

test('4. 3배속으로 게임 시간 30일을 진행해도 멈춤이나 에러가 없다', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  await openGame(page, errors);
  await startStage1(page);
  await buildViaUi(page, 's1a', 'earth');
  const start = await state(page);
  await page.getByTestId('speed-3').click();
  await page.waitForFunction((d0) => (window as any).__game.state().dayIndex >= d0 + 30, start.dayIndex, { timeout: 120_000, polling: 1000 });
  const end = await state(page);
  expect(end.dayIndex - start.dayIndex).toBeGreaterThanOrEqual(30);
  expect(errors).toEqual([]);
});

test('5. 슬롯 1에 저장하고 새로고침 후 불러오면 날짜·자금·댐 상태가 일치한다', async ({ page }) => {
  const errors: string[] = [];
  await openGame(page, errors);
  await startStage1(page);
  await buildViaUi(page, 's1a', 'stone');
  await page.getByTestId('gate-slider').fill('65');
  await page.evaluate(() => (window as any).__game.skipDays(12));
  await page.getByTestId('open-save').click();
  await page.getByTestId('save-slot1').click();
  await expect(page.getByTestId('slots')).toHaveCount(0);
  const saved = await state(page);

  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.ready === true);
  await page.getByTestId('menu-load').click();
  await page.getByTestId('load-slot1').click();
  await page.waitForFunction(() => (window as any).__game.screen === 'game');
  const loaded = await state(page);
  expect(loaded.date).toBe(saved.date);
  expect(loaded.tick).toBe(saved.tick);
  expect(loaded.funds).toBeCloseTo(saved.funds, 6);
  expect(loaded.dams).toEqual(saved.dams);
  expect(errors).toEqual([]);
});
