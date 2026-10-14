#!/usr/bin/env node
/**
 * pc-repo-check — fail when a theme repo drifts from the PC repo shape.
 *
 * Checks the files git tracks (not the working tree), so ignored local files
 * never fail it: no repo-level PR template, npm's package-lock.json as the only
 * lockfile, and .claude/CLAUDE.md as the only agent-instructions file, importing
 * the repo guide and the coding standards. Rules: rules/repo-checks.mjs.
 *
 * Usage: npx --no-install pc-repo-check      (run from the repo root; exits 1 on any violation)
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { checkRepo } from '../rules/repo-checks.mjs';

const paths = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
const violations = checkRepo(paths, (p) => readFileSync(p, 'utf8'));

if (violations.length === 0) {
  console.log('pc-repo-check: ✓ repo shape OK');
  process.exit(0);
}
for (const v of violations) console.log(`  [error] ${v.rule}  ${v.path}\n      ${v.message}`);
console.log(`\npc-repo-check: ✗ ${violations.length} problem(s)`);
process.exit(1);
