import { defineConfig } from '@playwright/test';

// e2e tests load the real built extension (dist/) into a persistent Chromium
// context. A single worker is used because the whole suite shares one extension
// context, and the engine test boots the real WASM Stockfish (needs headroom).
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 90_000, // generous: the engine test runs a real low-depth analysis
  expect: { timeout: 15_000 },
});
