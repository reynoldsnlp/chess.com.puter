// End-to-end: moves made in Sandbox (and variations off an analyzed game) are
// classified by the real engine, just like moves of an analyzed game (#16).

import { test, expect, openPanel, setEngineSpeed } from './support/extension.js';

/** Center of a square on the (white-oriented, square) chessground board. */
async function squareCenter(page, square) {
  const box = await page.locator('#board-container cg-board').boundingBox();
  const size = box.width / 8;
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  return { x: box.x + (file + 0.5) * size, y: box.y + (7 - rank + 0.5) * size };
}

/** Drag a piece (the board has click-to-move disabled, so drag like a user). */
async function playMove(page, from, to) {
  const a = await squareCenter(page, from);
  const b = await squareCenter(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

test('sandbox moves receive classifications', async ({ context, extensionId, serviceWorker }) => {
  await setEngineSpeed(serviceWorker, { depth: 6, multiPv: 1 });
  const panel = await openPanel(context, extensionId);
  await panel.setViewportSize({ width: 420, height: 900 }); // side-panel-like; square board

  await panel.locator('#lobby-sandbox').click();
  await expect(panel.locator('#analysis-section')).toBeVisible();
  await expect(panel.locator('#board-container cg-board')).toBeVisible();

  // 1. e4 (book), then 1...a5: each variation move gets its own classification.
  await playMove(panel, 'e2', 'e4');
  const first = panel.locator('.hypo-move[data-hypo-index="0"]');
  await expect(first).toHaveText(/e4/);
  await expect(first).toHaveClass(/move-book/, { timeout: 60_000 });
  await expect(first).toHaveAttribute('title', /book/);

  await playMove(panel, 'a7', 'a5');
  const second = panel.locator('.hypo-move[data-hypo-index="1"]');
  await expect(second).toHaveText(/a5/);
  await expect(second).toHaveClass(/\bmove-[a-z]+\b/, { timeout: 60_000 });
  await expect(second).toHaveAttribute('title', /EP loss/);

  // Live analysis resumes afterwards (engine lines for the current position).
  await expect(panel.locator('#engine-lines .engine-line').first()).toBeVisible({ timeout: 60_000 });
});

test('a variation branched from an analyzed game is classified', async ({ context, extensionId, serviceWorker }) => {
  await setEngineSpeed(serviceWorker, { depth: 6, multiPv: 1 });
  const panel = await openPanel(context, extensionId);
  await panel.setViewportSize({ width: 420, height: 900 });

  await panel.locator('#lobby-paste').click();
  await panel.locator('#pgn-textarea').fill('1. f3 e5 2. g4 Qh4# 0-1');
  await panel.locator('#pgn-analyze').click();
  await expect(panel.locator('#analysis-summary')).toBeVisible({ timeout: 60_000 });
  await expect(panel.locator('#move-list .move[data-ply="4"][class*="move-"]')).toBeVisible({ timeout: 60_000 });

  // After 1.f3 e5, play 2.e4 instead of 2.g4??.
  await panel.locator('#move-list .move[data-ply="2"]').click();
  await playMove(panel, 'e2', 'e4');
  const branch = panel.locator('.hypo-move[data-hypo-index="0"]');
  await expect(branch).toHaveText(/e4/);
  await expect(branch).toHaveClass(/\bmove-[a-z]+\b/, { timeout: 60_000 });
  await expect(branch).toHaveAttribute('title', /EP loss/);
});
