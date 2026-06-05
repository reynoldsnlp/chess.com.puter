import js from '@eslint/js';
import globals from 'globals';

// Empty catch blocks are used intentionally (best-effort runtime calls); unused
// function args / caught errors / _-prefixed vars are common in callbacks and loops.
const sharedRules = {
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
};

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'public/**',
      'vendor/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },

  js.configs.recommended,

  {
    // Extension runtime code: content scripts, side panel, service worker.
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.worker,
        ...globals.serviceworker,
        ...globals.webextensions,
      },
    },
    rules: sharedRules,
  },

  {
    // Node-side tooling: build, scripts, unit tests, config.
    files: [
      'build.js',
      'scripts/**/*.js',
      'test/**/*.{js,mjs}',
      'playwright.config.js',
      'eslint.config.js',
    ],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: sharedRules,
  },

  {
    // Playwright e2e: node test files, but evaluate()/addInitScript callbacks
    // reference extension globals (chrome), and fixtures use empty patterns.
    files: ['e2e/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser, ...globals.webextensions },
    },
    rules: { ...sharedRules, 'no-empty-pattern': 'off' },
  },
];
