/**
 * Repo-shape checks — behaviour lock.
 * Run with: node --test test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRepo } from '../rules/repo-checks.mjs';

const GOOD_CLAUDE = [
  '# Client',
  '@../node_modules/@plentiful/theme-standards/REPO-GUIDE.md',
  '',
  '@../node_modules/@plentiful/theme-standards/CODING-STANDARDS.md',
].join('\n');
const base = ['package.json', 'package-lock.json', '.claude/CLAUDE.md', 'sections/a.liquid'];
const run = (paths, claude = GOOD_CLAUDE) => checkRepo(paths, () => claude).map((v) => v.rule);

test('a repo in the standard shape passes', () => {
  assert.deepEqual(run(base), []);
});

test('flags a PR template in every location GitHub reads', () => {
  for (const p of [
    '.github/pull_request_template.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    'pull_request_template.md',
    'docs/pull_request_template.md',
    '.github/PULL_REQUEST_TEMPLATE/feature.md',
  ]) {
    assert.deepEqual(run([...base, p]), ['repo-pr-template'], p);
  }
});

test('does not flag unrelated files with similar names', () => {
  assert.deepEqual(run([...base, 'templates/page.pull-request.json', '.github/CODEOWNERS']), []);
});

test('flags yarn and pnpm lockfiles, and a missing package-lock.json', () => {
  assert.deepEqual(run([...base, 'yarn.lock']), ['repo-lockfile']);
  assert.deepEqual(run([...base, 'pnpm-lock.yaml']), ['repo-lockfile']);
  assert.deepEqual(run(base.filter((p) => p !== 'package-lock.json')), ['repo-lockfile']);
});

test('flags a root CLAUDE.md and a missing .claude/CLAUDE.md', () => {
  assert.deepEqual(run([...base, 'CLAUDE.md']), ['repo-claude-md']);
  assert.deepEqual(run(base.filter((p) => p !== '.claude/CLAUDE.md')), ['repo-claude-md']);
});

test('flags imports that resolve inside .claude/ and so load nothing', () => {
  const wrong = GOOD_CLAUDE.replaceAll('@../node_modules', '@./node_modules');
  assert.deepEqual(run(base, wrong), ['repo-claude-md', 'repo-claude-md']);
});
