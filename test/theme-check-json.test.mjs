/**
 * Theme Check JSON reader — behaviour lock for both Shopify CLI output formats.
 * Run with: node --test test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readThemeCheckJson } from '../rules/theme-check-json.mjs';

// Shopify CLI 4: one entry per file, rows 0-based.
const CLI4 = [
  {
    path: '/theme/snippets/css-variables.liquid',
    offenses: [
      { check: 'MissingAsset', severity: 'error', start_row: 226, message: "'assets/zoom-cursor.svg' does not exist" },
    ],
  },
  { path: '/theme/layout/theme.liquid', offenses: [] },
];

// Shopify CLI 5: one flat list, rows 1-based. Shape taken from CLI 5.0.1 on le-fil.
const CLI5 = {
  valid: true,
  issues: [
    {
      filePath: '/theme/snippets/css-variables.liquid',
      check: 'MissingAsset',
      severity: 'error',
      startRow: 227,
      startColumn: 35,
      endRow: 227,
      endColumn: 52,
      message: "'assets/zoom-cursor.svg' does not exist",
    },
  ],
};

const EXPECTED = [
  {
    path: '/theme/snippets/css-variables.liquid',
    check: 'MissingAsset',
    severity: 'error',
    line: 227,
    message: "'assets/zoom-cursor.svg' does not exist",
  },
];

test('reads CLI 4 output and converts rows to 1-based lines', () => {
  assert.deepEqual(readThemeCheckJson(CLI4), EXPECTED);
});

test('reads CLI 5 output, whose rows are already 1-based', () => {
  assert.deepEqual(readThemeCheckJson(CLI5), EXPECTED);
});

test('both formats give the same line for the same offense', () => {
  assert.equal(readThemeCheckJson(CLI4)[0].line, readThemeCheckJson(CLI5)[0].line);
});

test('no offenses in either format is an empty list', () => {
  assert.deepEqual(readThemeCheckJson([]), []);
  assert.deepEqual(readThemeCheckJson({ valid: true, issues: [] }), []);
});

test('a Theme Check error is reported, not read as a clean run', () => {
  assert.throws(
    () => readThemeCheckJson({ error: { type: 'bug', message: 'ENOENT: theme-check/index.yml' } }),
    /Theme Check failed: ENOENT/
  );
});

test('an unknown shape is reported', () => {
  assert.throws(() => readThemeCheckJson({ something: 'else' }), /format this script does not know/);
});
