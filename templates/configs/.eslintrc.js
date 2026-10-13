/* eslint-env node */
// Consumes the shared config from @plentiful/theme-standards. require.resolve is
// needed because ESLint's legacy extends resolver doesn't honor package exports.
module.exports = {
  root: true,
  extends: [require.resolve('@plentiful/theme-standards/eslint')],
};
