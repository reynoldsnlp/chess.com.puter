// End-to-end pipeline: a mocked chess.com / lichess page -> content-script
// scrape -> service-worker anti-cheating gate -> side-panel UI.
//
// Drive order matters: open the panel first so it is listening for the
// broadcast GAME_DATA, then open the fake site tab.

import { test, expect, openPanel, mockSite } from './support/extension.js';

const CHESSCOM_GAME = 'https://www.chess.com/game/live/123';
const CHESSCOM_LIVE = 'https://www.chess.com/game/live/456';
const LICHESS_GAME = 'https://lichess.org/abcd1234';

test('chess.com completed game is scraped and offered for analysis', async ({ context, extensionId }) => {
  await mockSite(context, CHESSCOM_GAME, 'chesscom-gameover.html');

  const panel = await openPanel(context, extensionId);
  await expect(panel.locator('#lobby')).toBeVisible();

  const site = await context.newPage();
  await site.goto(CHESSCOM_GAME);
  await site.bringToFront();

  await expect(panel.locator('#lobby-status')).toContainText('Completed game found', { timeout: 25_000 });
  await expect(panel.locator('#lobby-import')).toBeEnabled();
});

test('chess.com live game is blocked and no PGN leaks to the panel', async ({ context, extensionId }) => {
  await mockSite(context, CHESSCOM_LIVE, 'chesscom-live.html');

  const panel = await openPanel(context, extensionId);
  await expect(panel.locator('#lobby')).toBeVisible();

  const site = await context.newPage();
  await site.goto(CHESSCOM_LIVE);
  await site.bringToFront();

  // The panel switches to the live-helper (blocked) view...
  await expect(panel.locator('#live-section')).toBeVisible({ timeout: 25_000 });
  // ...and never offers the completed-game import (PGN was gated out).
  await expect(panel.locator('#lobby-import')).toBeDisabled();
});

test('lichess completed game is scraped and offered for analysis', async ({ context, extensionId }) => {
  await mockSite(context, LICHESS_GAME, 'lichess-gameover.html');

  const panel = await openPanel(context, extensionId);
  await expect(panel.locator('#lobby')).toBeVisible();

  const site = await context.newPage();
  await site.goto(LICHESS_GAME);
  await site.bringToFront();

  await expect(panel.locator('#lobby-status')).toContainText('Completed game found', { timeout: 25_000 });
  await expect(panel.locator('#lobby-import')).toBeEnabled();
});
