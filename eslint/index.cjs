/**
 * @plentiful/theme-standards — shared ESLint config (ESLint 8, legacy `.eslintrc` style).
 *
 * Consume from a repo's `.eslintrc.cjs`:
 *   module.exports = { root: true, extends: ['@plentiful/theme-standards/eslint'] };
 *
 * Encodes Part B2 of CODING-STANDARDS.md:
 *  - Migrated off the deprecated `babel-eslint` → `@babel/eslint-parser`.
 *  - `eslint-config-prettier` last so formatting is owned by Prettier, not ESLint.
 *  - `no-unused-vars: error` is non-negotiable (no per-repo `off` overrides).
 */
module.exports = {
  parser: '@babel/eslint-parser',
  parserOptions: {
    requireConfigFile: false,
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  env: {
    browser: true,
    es2022: true,
  },
  extends: ['eslint:recommended', 'prettier'],
  // Theme-level globals present across PC client themes.
  globals: {
    Shopify: 'readonly',
    algoliasearch: 'readonly',
    algoliaShopify: 'readonly',
    instantsearch: 'readonly',
    Swiper: 'readonly',
    _swat: 'readonly',
  },
  rules: {
    'no-var': 'error',
    'prefer-const': 'error',
    'no-unused-vars': 'error',
    'no-irregular-whitespace': 'error',
    'no-mixed-spaces-and-tabs': 'error',
    eqeqeq: ['error', 'smart'],
    'no-console': 'off',
  },
};
