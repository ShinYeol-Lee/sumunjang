import type { Page } from '@playwright/test';

export interface GameState {
  stageId: number;
  tick: number;
  dayIndex: number;
  date: string;
  funds: number;
  finished: boolean;
  dams: ({ siteId: string; method: string; status: string; gate: number; level: number; durability: number; levels: Record<string, number> } | null)[];
}

export async function openGame(page: Page, errors: string[] = []): Promise<void> {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__game?.ready === true, null, { timeout: 60_000 });
}

export async function clearStorage(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase('sumunjang');
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      }),
  );
}

export async function state(page: Page): Promise<GameState> {
  return page.evaluate(() => (window as any).__game.state());
}

export async function startStage1(page: Page): Promise<void> {
  await page.getByTestId('menu-new').click();
  await page.getByTestId('stage-1').click();
  await page.waitForFunction(() => (window as any).__game.screen === 'game');
  // 튜토리얼 말풍선은 테스트 흐름을 막지 않지만, 스크린샷을 위해 남겨 둔다
  await page.waitForTimeout(500);
}

/** UI로 부지를 클릭하고 공법을 골라 건설한다 */
export async function buildViaUi(page: Page, siteId: string, method: 'earth' | 'stone' | 'concrete'): Promise<void> {
  const pos = await page.evaluate((id) => (window as any).__game.siteScreenPos(id), siteId);
  await page.mouse.click(pos.x, pos.y);
  await page.getByTestId(`method-${method}`).click();
  await page.getByTestId('build-confirm').click();
}
