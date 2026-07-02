import js from '@eslint/js';
import globals from 'globals';

// Flat config (ESLint 9+/10). Node + ESM baseline for the Spectrum server.
// Goal: a running lint baseline — not a codebase-wide auto-rewrite. Rules are
// deliberately modest so the signal (real bugs like unused vars, undefined
// globals, unreachable code) isn't drowned out by stylistic noise.
export default [
  {
    ignores: [
      'node_modules/**',
      'data/**',
      'src/data/**',
      'coverage/**',
      '**/*.min.js',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Surface genuinely dead/unsafe code without demanding a full cleanup.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-console': 'off', // server logging is intentional
      'no-empty': ['warn', { allowEmptyCatch: true }],
      eqeqeq: ['warn', 'smart'],
      // Downgraded to a warning: flags legitimate defensive `let x = []`
      // fallback initializers (e.g. account.js reassigns inside a try/catch),
      // which we must not rewrite here. Keep it visible, but non-blocking.
      'no-useless-assignment': 'warn',
    },
  },
  {
    // Test files: vitest globals live in imports, but allow the node test env.
    files: ['test/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
