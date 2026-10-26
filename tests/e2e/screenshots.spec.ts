import { expect, test } from '@playwright/test';
import { buildViaUi, clearStorage, openGame, startStage1, state } from './helpers';

const DIR = 'screenshots';

test('6. 주요 화면 스크린샷 (메뉴·시작·건설·우기·붕괴·결과·도감)', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await openGame(page, errors);
  await clearStorage(page);
  // 날씨를 고정해 장마철 비 오는 날이 항상 같은 날에 오게 한다
  await page.goto('/?seed=7');
  await page.waitForFunction(() => (window as any).__game?.ready === true);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${DIR}/01-main-menu.png` });

  await startStage1(page);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${DIR}/02-stage1-start.png` });

  await buildViaUi(page, 's1a', 'stone');
  await page.getByTestId('gate-slider').fill('45');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${DIR}/03-dam-built.png` });

  // 장마철 비 오는 날로 이동
  const rain = await page.evaluate(() => {
    const g = (window as any).__game;
    g.selectSite(null);
    return g.skipToRain(118);
  });
  expect(rain).toBeGreaterThan(0);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${DIR}/04-rainy-season.png` });

  // 붕괴 연출: 수문을 닫고 내구도를 바닥으로
  await page.evaluate(() => {
    const g = (window as any).__game;
    g.setGate('s1a', 0);
    g.skipDays(3);
    g.setDurability('s1a', 0.0001);
    g.skipDays(0.05);
  });
  await page.getByTestId('speed-1').click();
  await page.waitForFunction(() => (window as any).__game.inCinematic === true, null, { timeout: 30_000 });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${DIR}/05-collapse.png` });
  expect((await state(page)).dams[0]!.status).toBe('collapsed');

  // 3년 끝까지
  await page.evaluate(() => (window as any).__game.skipToDay(1095));
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${DIR}/06-result.png` });

  await page.goto('/');
  await page.waitForFunction(() => (window as any).__game?.ready === true);
  await page.getByTestId('menu-codex').click();
  await expect(page.getByTestId('codex-firstCollapse')).not.toHaveClass(/locked/);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${DIR}/07-codex.png` });
  expect(errors).toEqual([]);
});
