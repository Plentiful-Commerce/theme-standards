#!/usr/bin/env node
/**
 * pc-gate — Plentiful Commerce self-verify gate (stages 1–6).
 *
 * The single command an implementation agent runs, in its own loop, BEFORE
 * pushing: it sequences the existing deterministic checks over the current
 * diff and emits one machine-readable verdict the agent acts on. CI blocking a
 * PR is a gate for humans; pc-gate is the gate the agent uses to self-correct
 * with no human in the loop. See PC-GATE-SPEC.md.
 *
 * Scope: gates COMMITTED changes on the current branch vs the base branch
 * (three-dot, i.e. since the merge-base). The agent's loop is: edit → commit →
 * pc-gate → fix (amend/new commit) → re-run. Uncommitted working-tree edits are
 * NOT gated — commit first. This matches theme-check-changed / the CI model.
 *
 * Stages (fail-fast on blocking):
 *   1 prettier   --check      changed files            block
 *   2 eslint                  changed .js              block
 *   3 stylelint               changed .css/.scss       block
 *   4 pc-lint    --files      changed liquid/css/json  block
 *   5 theme-check-changed     added lines              block  (needs Shopify CLI)
 *   6 pc-design-tokens --warn changed files            warn only
 *   7–9 rendered layer                                 NOT YET IMPLEMENTED (skipped)
 *
 * Usage:
 *   pc-gate                    gate current branch vs its base
 *   pc-gate --base main        override base (bare branch name or full ref)
 *   pc-gate --json             machine-readable verdict to stdout (auto when non-TTY)
 *   pc-gate --no-render        forward-compat no-op (render layer not built yet)
 *   pc-gate --files a b c      override the changed-file set (skip git diff)
 *
 * Exit codes:
 *   0  all blocking stages passed — safe to open PR
 *   1  a blocking stage failed — agent must fix and re-run; DO NOT push
 *   2  infra error (no git / unresolved base / missing required tool) — retry,
 *      don't ask the agent to "fix" code
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, extname, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CWD = process.cwd();
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (f) => (args.indexOf(f) === -1 ? null : args[args.indexOf(f) + 1]);
const JSON_OUT = has('--json') || !process.stdout.isTTY;

const flagIdx = (f) => args.indexOf(f);
const filesOverride = (() => {
  const i = flagIdx('--files');
  return i === -1 ? null : args.slice(i + 1).filter((a) => !a.startsWith('--'));
})();

// ── helpers ────────────────────────────────────────────────────────────────
const log = (...m) => { if (!JSON_OUT) console.error(...m); };

function sh(cmd, cmdArgs, { cwd = CWD, input } = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd, input, encoding: 'utf8', maxBuffer: 1e8 });
  return { code: r.status ?? (r.error ? -1 : 0), out: r.stdout || '', err: r.stderr || '', error: r.error };
}

// Resolve a tool from the consuming repo's node_modules/.bin, else fall back to
// PATH (lets a globally-installed CLI like `shopify` work).
function bin(name) {
  const local = join(CWD, 'node_modules', '.bin', name);
  return existsSync(local) ? local : name;
}
function hasBin(name) {
  if (existsSync(join(CWD, 'node_modules', '.bin', name))) return true;
  const probe = sh(process.platform === 'win32' ? 'where' : 'which', [name]);
  return probe.code === 0;
}
// Sibling package scripts run via node with an absolute path — no dependence on
// the consuming repo's bin symlinks (works when pc-gate is the invoked bin).
const pkgScript = (f) => join(SCRIPT_DIR, f);

const trim = (s, n = 4000) => (s.length > n ? s.slice(0, n) + '\n…(truncated)' : s).trimEnd();

function fail(msg, code = 2) {
  const verdict = { verdict: 'infra_error', error: msg, next_action: 'retry_infra' };
  if (JSON_OUT) console.log(JSON.stringify(verdict, null, 2));
  else console.error(`pc-gate: ✗ infra error — ${msg}`);
  process.exit(code);
}

// ── resolve base + changed files ─────────────────────────────────────────────
if (sh('git', ['rev-parse', '--is-inside-work-tree']).code !== 0) fail('not a git repository');

function resolveBase() {
  const given = opt('--base');
  const candidates = [];
  if (given) candidates.push(given, `origin/${given}`);
  else {
    // origin/HEAD → e.g. "origin/main"; fall back to common names.
    const head = sh('git', ['rev-parse', '--abbrev-ref', 'origin/HEAD']);
    if (head.code === 0 && head.out.trim()) candidates.push(head.out.trim());
    candidates.push('origin/main', 'origin/master', 'main', 'master');
  }
  for (const ref of candidates) {
    if (sh('git', ['rev-parse', '--verify', '--quiet', ref]).code === 0) return ref;
  }
  return null;
}

const BASE = resolveBase();
if (!BASE) fail('could not resolve a base branch (tried origin/HEAD, origin/main, …) — pass --base');

const mergeBase = sh('git', ['merge-base', 'HEAD', BASE]);
if (mergeBase.code !== 0) fail(`could not compute merge-base with ${BASE}`);
const MB = mergeBase.out.trim();

let changed = filesOverride;
if (!changed) {
  const d = sh('git', ['diff', '--name-only', '--diff-filter=d', `${MB}...HEAD`]);
  if (d.code !== 0) fail('git diff failed');
  changed = d.out.split('\n').map((s) => s.trim()).filter(Boolean);
}
const abs = (f) => resolve(CWD, f);
const existing = changed.filter((f) => existsSync(abs(f)));
const byExt = (exts) => existing.filter((f) => exts.has(extname(f).toLowerCase()));

const jsFiles = byExt(new Set(['.js']));
const cssFiles = byExt(new Set(['.css', '.scss']));
const liquidFiles = byExt(new Set(['.liquid']));
const prettierFiles = byExt(new Set(['.js', '.json', '.css', '.scss', '.liquid', '.md']));
const pcLintFiles = byExt(new Set(['.liquid', '.css', '.js', '.json']));

log(`pc-gate: base=${BASE}  ${changed.length} changed file(s)`);

// ── stage runners ─────────────────────────────────────────────────────────
const stages = [];
let blockingFailed = false;
let infra = null;

/** record a stage; `status`: pass | fail | warn | skip | infra */
function record(id, status, { blocking = true, detail = null } = {}) {
  stages.push({ id, status, blocking, detail: detail ? trim(detail) : null });
  if (status === 'fail' && blocking) blockingFailed = true;
  if (status === 'infra') infra = id;
  const mark = { pass: '✓', fail: '✗', warn: '⚠', skip: '·', infra: '✗' }[status];
  log(`  ${mark} ${id}${status === 'skip' ? ' (n/a)' : ''}`);
}

// 1 — prettier --check
if (prettierFiles.length === 0) record('prettier', 'skip');
else if (!hasBin('prettier')) record('prettier', 'infra', { detail: 'prettier not installed' });
else {
  const r = sh(bin('prettier'), ['--check', ...prettierFiles]);
  record('prettier', r.code === 0 ? 'pass' : 'fail', { detail: r.code === 0 ? null : r.out + r.err });
}

// 2 — eslint (only if not already in infra/blocking short-circuit; we run all
//     deterministic stages so the agent sees every failure at once, except we
//     stop the moment infra breaks — infra means the env is wrong, not the code)
if (!infra) {
  if (jsFiles.length === 0) record('eslint', 'skip');
  else if (!hasBin('eslint')) record('eslint', 'infra', { detail: 'eslint not installed' });
  else {
    const r = sh(bin('eslint'), jsFiles);
    record('eslint', r.code === 0 ? 'pass' : 'fail', { detail: r.code === 0 ? null : r.out + r.err });
  }
}

// 3 — stylelint
if (!infra) {
  if (cssFiles.length === 0) record('stylelint', 'skip');
  else if (!hasBin('stylelint')) record('stylelint', 'infra', { detail: 'stylelint not installed' });
  else {
    const r = sh(bin('stylelint'), cssFiles);
    record('stylelint', r.code === 0 ? 'pass' : 'fail', { detail: r.code === 0 ? null : r.out + r.err });
  }
}

// 4 — pc-lint --files (this package's own bin; block on error severity)
if (!infra) {
  if (pcLintFiles.length === 0) record('pc-lint', 'skip');
  else {
    const r = sh('node', [pkgScript('pc-lint.mjs'), '--files', ...pcLintFiles]);
    record('pc-lint', r.code === 0 ? 'pass' : 'fail', { detail: r.code === 0 ? null : r.out + r.err });
  }
}

// 5 — theme-check-changed (needs Shopify CLI). Missing CLI = infra, not fail:
//     the code isn't wrong, the environment can't verify it.
if (!infra) {
  if (liquidFiles.length === 0) record('theme-check', 'skip');
  else if (!hasBin('shopify')) {
    record('theme-check', 'infra', { detail: 'Shopify CLI not installed — cannot run Theme Check' });
  } else {
    const tmp = join(mkdtempSync(join(tmpdir(), 'pc-gate-')), 'tc.json');
    const tc = sh(bin('shopify'), ['theme', 'check', '--output', 'json']);
    // shopify exits non-zero when offenses exist; we still get JSON on stdout.
    if (!tc.out.trim()) {
      record('theme-check', 'infra', { detail: `theme check produced no JSON\n${tc.err}` });
    } else {
      writeFileSync(tmp, tc.out);
      const r = sh('node', [pkgScript('theme-check-changed.mjs'), tmp, '--diff-base', BASE]);
      record('theme-check', r.code === 0 ? 'pass' : r.code === 2 ? 'infra' : 'fail', {
        detail: r.code === 0 ? null : r.out + r.err,
      });
    }
    try { rmSync(dirname(tmp), { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

// 6 — pc-design-tokens (advisory / warn-only, never blocks)
if (!infra) {
  if (pcLintFiles.length === 0) record('design-tokens', 'skip', { blocking: false });
  else {
    const r = sh('node', [pkgScript('pc-design-tokens.mjs'), '--files', ...pcLintFiles, '--warn']);
    // --warn always exits 0; the tool prints ✗ only when it has findings (its
    // clean message is "✓ no hardcoded values…", so match the ✗ marker, not the
    // word "hardcoded" which appears in the success line too).
    const hasFindings = /✗/.test(r.out + r.err);
    record('design-tokens', hasFindings ? 'warn' : 'pass', {
      blocking: false,
      detail: hasFindings ? r.out + r.err : null,
    });
  }
}

// 7–9 — rendered layer: not implemented yet (see PC-GATE-SPEC.md §7–9).
record('render', 'skip', { blocking: false, detail: 'rendered layer (stages 7–9) not yet implemented' });

// ── verdict ─────────────────────────────────────────────────────────────
let verdict, nextAction, exitCode;
if (infra) { verdict = 'infra_error'; nextAction = 'retry_infra'; exitCode = 2; }
else if (blockingFailed) { verdict = 'fail'; nextAction = 'fix_findings'; exitCode = 1; }
else { verdict = 'pass'; nextAction = 'open_pr'; exitCode = 0; }

const result = {
  verdict,
  base: BASE,
  head_sha: sh('git', ['rev-parse', 'HEAD']).out.trim(),
  changed_files: changed,
  stages,
  next_action: nextAction,
};

if (JSON_OUT) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const icon = { pass: '✓', fail: '✗', infra_error: '✗' }[verdict];
  console.error(`\npc-gate: ${icon} ${verdict.toUpperCase()} — next: ${nextAction}`);
  if (verdict !== 'pass') {
    for (const s of stages.filter((x) => x.status === 'fail' || x.status === 'infra')) {
      console.error(`\n── ${s.id} (${s.status}) ──\n${s.detail || ''}`);
    }
  }
}
process.exit(exitCode);
