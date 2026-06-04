// End-to-end engine test: paste a PGN and let the REAL WASM Stockfish run a
// full-game analysis in the browser, then assert the panel renders move
// classifications. Depth is forced low so this stays reasonably fast.

import { test, expect, openPanel, setEngineSpeed } from './support/extension.js';

// Fool's mate. The panel loads a pasted game from White's perspective and only
// colorizes the player's own moves, so we want WHITE to make the blunder
// (2.g4?? allows 2...Qh4#) — that move then gets a classification class.
const PGN = '1. f3 e5 2. g4 Qh4# 0-1';

test('real engine analyzes a pasted game and renders classifications', async ({ context, extensionId, serviceWorker }) => {
  await setEngineSpeed(serviceWorker, { depth: 6, multiPv: 1 });

  const panel = await openPanel(context, extensionId);

  await panel.locator('#lobby-paste').click();
  await panel.locator('#pgn-textarea').fill(PGN);
  await panel.locator('#pgn-analyze').click();

  // Game loads -> analysis mode.
  await expect(panel.locator('#analysis-section')).toBeVisible();
  await expect(panel.locator('#move-list .move[data-ply]')).toHaveCount(4);

  // Full-game analysis runs: the summary (with accuracy %) appears...
  await expect(panel.locator('#analysis-summary')).toBeVisible({ timeout: 60_000 });
  await expect(panel.locator('#analysis-summary .summary-accuracy')).toContainText('%');

  // ...and at least one move receives a classification class (move-best, etc.).
  await expect(panel.locator('#move-list .move[class*="move-"]').first()).toBeVisible({ timeout: 60_000 });

  // Prove the real engine actually evaluated (a dead engine would still produce
  // book/"excellent" labels): the live engine lines must populate with a real
  // line, not the "Engine idle" placeholder...
  await expect(panel.locator('#engine-lines .engine-line').first()).toBeVisible({ timeout: 60_000 });

  // ...and the losing move (3...Nf6?? allows 4.Qxf7#) must be penalised — a
  // classification only a real eval can produce.
  await expect(
    panel.locator('#move-list .move.move-blunder, #move-list .move.move-mistake, #move-list .move.move-miss'),
  ).not.toHaveCount(0);
});
