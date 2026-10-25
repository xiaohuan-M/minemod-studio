import globals from 'globals';

// Keep JS contracts gradual, but catch misspelled globals and missing imports everywhere.
const rules = {
  'no-undef': 'error',
  'no-unreachable': 'error',
  'no-dupe-args': 'error',
  'no-dupe-keys': 'error',
  'valid-typeof': 'error',
};
export default [
  { ignores: ['node_modules/**', '.minemod/**', 'dist/**', 'templates/**'] },
  {
    files: ['src/**/*.mjs', 'scripts/**/*.mjs', 'test/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: { globals: globals.node, sourceType: 'module', ecmaVersion: 'latest' },
    rules,
  },
  {
    files: ['web/**/*.js'],
    languageOptions: { globals: globals.browser, sourceType: 'module', ecmaVersion: 'latest' },
    rules,
  },
  {
    // Playwright serializes these callbacks into the actual page context.
    files: [
      'scripts/verify-browser.mjs',
      'scripts/verify-creation-browser.mjs',
      'scripts/verify-hub-browser.mjs',
    ],
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
        innerWidth: 'readonly',
        HTMLCanvasElement: 'readonly',
      },
    },
  },
];
