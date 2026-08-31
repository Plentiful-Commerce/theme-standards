/**
 * Inline suppression (pc-lint-disable) — behaviour lock.
 * Run with: node --test test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLiquidFile, parseDisables } from '../rules/liquid-checks.mjs';

const includes = (content, path = 'layout/theme.liquid') =>
  checkLiquidFile(path, content).filter((v) => v.rule === 'liquid-include').length;

test('flags a bare include with no directive', () => {
  assert.equal(includes("{% include 'a' %}"), 1);
});

test('region disable/enable suppresses the named rule', () => {
  assert.equal(
    includes("{%- # pc-lint-disable liquid-include -%}\n{% include 'a' %}\n{%- # pc-lint-enable liquid-include -%}"),
    0,
  );
});

test('disable-next-line suppresses only the following line', () => {
  assert.equal(includes("{%- # pc-lint-disable-next-line liquid-include -%}\n{% include 'a' %}"), 0);
});

test('a directive naming no rule suppresses every rule', () => {
  assert.equal(includes("{%- # pc-lint-disable -%}\n{% include 'a' %}\n{%- # pc-lint-enable -%}"), 0);
});

test('a directive naming a different rule does not suppress', () => {
  assert.equal(
    includes("{%- # pc-lint-disable document-write -%}\n{% include 'a' %}\n{%- # pc-lint-enable document-write -%}"),
    1,
  );
});

test('code after enable is flagged again', () => {
  assert.equal(
    includes(
      "{%- # pc-lint-disable liquid-include -%}\n{% include 'a' %}\n{%- # pc-lint-enable liquid-include -%}\n{% include 'b' %}",
    ),
    1,
  );
});

test('a suppressed occurrence does not mask a later live one', () => {
  assert.equal(includes("{%- # pc-lint-disable-next-line liquid-include -%}\n{% include 'a' %}\n{% include 'b' %}"), 1);
});

test('an unclosed disable runs to end of file', () => {
  assert.equal(includes("{%- # pc-lint-disable liquid-include -%}\n{% include 'a' %}\n{% include 'b' %}"), 0);
});

test('suppressing one rule does not leak into another', () => {
  const out = checkLiquidFile('layout/theme.liquid', "{%- # pc-lint-disable liquid-include -%}\ndocument.write('x')");
  assert.equal(out.filter((v) => v.rule === 'document-write').length, 1);
});

test('parseDisables is exported and reports per rule and line', () => {
  const isDisabled = parseDisables("{%- # pc-lint-disable-next-line liquid-include -%}\n{% include 'a' %}");
  assert.equal(isDisabled('liquid-include', 2), true);
  assert.equal(isDisabled('document-write', 2), false);
  assert.equal(isDisabled('liquid-include', 3), false);
});
