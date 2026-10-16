/**
 * @plentiful/theme-standards — shared ESLint config (ESLint 10, flat config).
 *
 * Consume from a repo's `eslint.config.mjs`:
 *   export { default } from '@plentiful/theme-standards/eslint';
 *
 * A repo that needs its own ignores or overrides spreads it instead:
 *   import standards from '@plentiful/theme-standards/eslint';
 *   export default [...standards, { ignores: ['src/vendor/**'] }];
 *
 * The parser, `@eslint/js` and `eslint-config-prettier` are imported here, so they
 * resolve from this package, not from the repo.
 *
 * Encodes Part B2 of CODING-STANDARDS.md:
 *  - `@babel/eslint-parser`, not the deprecated `babel-eslint`.
 *  - `eslint-config-prettier` after the recommended rules, so Prettier owns formatting.
 *  - `no-unused-vars: error` is non-negotiable (no per-repo `off` overrides).
 */
import babelParser from '@babel/eslint-parser';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  js.configs.recommended,
  prettier,
  {
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
      },
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // ES2022 built-ins come from `ecmaVersion`; `globals` adds the browser.
        ...globals.browser,
        // Theme-level globals present across PC client themes.
        Shopify: 'readonly',
        algoliasearch: 'readonly',
        algoliaShopify: 'readonly',
        instantsearch: 'readonly',
        Swiper: 'readonly',
        _swat: 'readonly',
      },
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      // ESLint 9 started reporting unused `catch (e)` bindings; keep the ESLint 8 behaviour.
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
      'no-irregular-whitespace': 'error',
      'no-mixed-spaces-and-tabs': 'error',
      eqeqeq: ['error', 'smart'],
      'no-console': 'off',
    },
  },
  {
    // Build config at the repo root runs in Node as CommonJS. Replaces the
    // `/* eslint-env node */` comments, which flat config does not support.
    files: ['*.config.js', '*.config.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
];
