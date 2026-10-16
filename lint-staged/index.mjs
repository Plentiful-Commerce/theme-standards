/**
 * @plentiful/theme-standards — shared lint-staged config.
 *
 * `pc-pre-commit` passes this file to lint-staged with `--config`, so a repo needs
 * no lint-staged block of its own. A repo that runs lint-staged directly can point
 * at it from `lint-staged.config.mjs`:
 *   export { default } from '@plentiful/theme-standards/lint-staged';
 */
export default {
  '*.{js,json,css,scss,liquid}': 'prettier --write',
  'src/**/*.js': 'eslint --fix',
  'src/**/*.{css,scss}': 'stylelint --fix',
};
