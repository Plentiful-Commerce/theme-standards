#!/usr/bin/env node
/**
 * pc-lint — Plentiful Commerce deterministic theme gate.
 *
 * Runs the canonical rules in ../rules/liquid-checks.mjs (the SAME module the
 * shopify-audit-tool scores against, so the two never drift) and blocks on
 * error-severity violations; warnings are advisory.
 *
 * Modes:
 *   node pc-lint.mjs [root]            whole repo — exit 1 if any error
 *   node pc-lint.mjs --warn [root]     whole repo — report-only (exit 0)
 *   node pc-lint.mjs --files a b c     only the listed files — exit 1 on error
 *
 * --files is the CI diff gate: pass the changed files so a PR is blocked on
 * what it touches, while legacy debt in untouched files doesn't fail the build.
 * Page-builder files (PageFly/Shogun/GemPages) are skipped.
 */
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { runAll } from '../rules/liquid-checks.mjs';

const args = process.argv.slice(2);
const WARN_ONLY = args.includes('--warn');
const filesIdx = args.indexOf('--files');
const FILES = filesIdx === -1 ? null : args.slice(filesIdx + 1).filter((a) => !a.startsWith('--'));
const ROOT = resolve(
  args.find((a, i) => !a.startsWith('--') && (filesIdx === -1 || i < filesIdx)) || process.cwd()
);

const isPageBuilder = (f) => /pf-|pagefly|shogun|gempages|gem-/i.test(f);
const read = async (f) => {
  try {
    return await readFile(f, 'utf8');
  } catch {
    return '';
  }
};

async function walk(dir) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.git')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

// Read all liquid/css files for whole-theme context (cross-file rules need it).
const paths = (await walk(ROOT)).filter((f) => !isPageBuilder(f) && /\.(liquid|css)$/i.test(extname(f)));
const files = await Promise.all(paths.map(async (path) => ({ path, content: await read(path) })));

// browserslist queries from package.json + .browserslistrc
const browserslistQueries = [];
const rc = await read(join(ROOT, '.browserslistrc'));
if (rc) browserslistQueries.push(...rc.split('\n'));
const pkgRaw = await read(join(ROOT, 'package.json'));
if (pkgRaw) {
  try {
    const bl = JSON.parse(pkgRaw).browserslist;
    if (Array.isArray(bl)) browserslistQueries.push(...bl);
    else if (typeof bl === 'string') browserslistQueries.push(bl);
    else if (bl && Array.isArray(bl.production)) browserslistQueries.push(...bl.production);
  } catch {
    /* ignore malformed package.json */
  }
}

let violations = runAll({ files, browserslistQueries });

// Scope to changed files when --files is given.
if (FILES) {
  const scope = new Set(FILES.map((f) => resolve(ROOT, f)));
  const blChanged = [resolve(ROOT, 'package.json'), resolve(ROOT, '.browserslistrc')].some((f) => scope.has(f));
  violations = violations.filter((x) =>
    x.path === 'browserslist' ? blChanged : scope.has(resolve(x.path))
  );
}

const errors = violations.filter((x) => x.severity === 'error');
const scopeLabel = FILES ? `${FILES.length} changed file(s)` : 'whole repo';

if (violations.length === 0) {
  console.log(`pc-lint: ✓ no violations (${scopeLabel})`);
  process.exit(0);
}

const blocking = !WARN_ONLY && errors.length > 0;
const mark = blocking ? '✗' : '⚠';
console.error(
  `pc-lint: ${mark} ${violations.length} violation(s) in ${scopeLabel} — ${errors.length} error, ${violations.length - errors.length} warning${WARN_ONLY ? ' (warn-only)' : ''}\n`
);
for (const x of violations.sort((a, b) => (a.severity > b.severity ? 1 : -1))) {
  console.error(`  [${x.severity}] ${x.rule}  ${String(x.path).replace(ROOT, '.')}:${x.line}`);
  console.error(`      ${x.detail}`);
}
process.exit(blocking ? 1 : 0);
