#!/usr/bin/env node
/**
 * theme-check-changed — diff-scope Shopify Theme Check to INTRODUCED problems.
 *
 * Theme Check has no native "only fail on what changed" mode, and a whole-repo
 * blocking run red-walls a legacy theme. This reads `shopify theme check
 * --output json` and fails only on offenses at/above a severity that land on
 * lines THIS change added — so introducing `img_url` fails, but a pre-existing
 * warning on an untouched line of a file you happened to edit does not.
 *
 * Usage:
 *   shopify theme check --output json > tc.json
 *   node theme-check-changed.mjs tc.json --diff-base origin/main   # PR / CI
 *   node theme-check-changed.mjs tc.json --staged                  # pre-commit
 *   node theme-check-changed.mjs tc.json --files a.liquid          # whole-file fallback
 *
 * --fail-level: error | warning | info  (default: warning — catches deprecations
 * like img_url, which Theme Check rates as a warning).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
// The theme-check JSON file is always the first positional arg (any name — the
// pre-commit hook passes an extension-less mktemp file).
const jsonPath = args[0] && !args[0].startsWith('--') ? args[0] : undefined;
const failLevel = args[args.indexOf('--fail-level') + 1] || 'warning';
const diffBase = args.includes('--diff-base') ? args[args.indexOf('--diff-base') + 1] : null;
const staged = args.includes('--staged');
const filesIdx = args.indexOf('--files');
const files = filesIdx === -1 ? [] : args.slice(filesIdx + 1).filter((a) => !a.startsWith('--'));

if (!jsonPath) {
  console.error('theme-check-changed: pass the theme-check JSON file as the first arg');
  process.exit(2);
}

const order = { error: 0, warning: 1, info: 2, suggestion: 2, style: 3 };
const threshold = order[failLevel] ?? 1;

// Build a map of absolute path -> Set of added line numbers (1-based) from the
// unified diff. In --files mode there are no line ranges; we match the whole file.
function addedLineMap(diffCmd) {
  const map = new Map();
  let cur = null;
  let out = '';
  try {
    out = execSync(diffCmd, { encoding: 'utf8', maxBuffer: 1e8 });
  } catch {
    return map;
  }
  for (const line of out.split('\n')) {
    const f = line.match(/^\+\+\+ b\/(.+)$/);
    if (f) {
      cur = resolve(process.cwd(), f[1]);
      map.set(cur, new Set());
      continue;
    }
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (h && cur) {
      const start = parseInt(h[1], 10);
      const count = h[2] === undefined ? 1 : parseInt(h[2], 10);
      for (let i = 0; i < count; i++) map.get(cur).add(start + i);
    }
  }
  return map;
}

let lineMode = true;
let lineMap;
if (diffBase) {
  lineMap = addedLineMap(`git diff --unified=0 --diff-filter=d ${diffBase}...HEAD`);
} else if (staged) {
  lineMap = addedLineMap('git diff --cached --unified=0 --diff-filter=d');
} else {
  // Whole-file fallback: every line of the listed files counts.
  lineMode = false;
  lineMap = new Set(files.map((f) => resolve(process.cwd(), f)));
}

let data;
try {
  data = JSON.parse(readFileSync(jsonPath, 'utf8'));
} catch {
  console.error(`theme-check-changed: could not read/parse ${jsonPath}`);
  process.exit(2);
}

const hits = [];
for (const file of data) {
  const abs = resolve(file.path);
  const added = lineMode ? lineMap.get(abs) : lineMap.has(abs) ? true : null;
  if (!added) continue;
  for (const o of file.offenses || []) {
    if ((order[o.severity] ?? 9) > threshold) continue;
    const lineNo = o.start_row + 1; // theme-check rows are 0-based
    if (lineMode && !added.has(lineNo)) continue; // only offenses on added lines
    hits.push({ path: file.path, ...o });
  }
}

if (hits.length === 0) {
  console.log(`theme-check: ✓ no introduced offenses at/above '${failLevel}'`);
  process.exit(0);
}
console.error(`theme-check: ✗ ${hits.length} introduced offense(s) at/above '${failLevel}'\n`);
for (const h of hits) {
  console.error(
    `  [${h.severity}] ${h.check}  ${h.path.replace(process.cwd(), '.')}:${h.start_row + 1}`
  );
  console.error(`      ${h.message}`);
}
process.exit(1);
