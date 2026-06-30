#!/usr/bin/env node
/**
 * pc-design-tokens — flag hardcoded values that duplicate an existing CSS token.
 *
 * Deterministic answer to "you hardcoded a value when a CSS variable already
 * holds it" — for colors AND lengths/sizes (px/rem/em/%/vh…). Builds a map of
 * `--token: <value>` definitions across the theme's CSS, then flags any literal
 * whose normalized value equals a token's, and names the `var(--token)` to use.
 *
 * Modes:
 *   node pc-design-tokens.mjs [root]         whole repo
 *   node pc-design-tokens.mjs --files a b     only the listed files
 *   --warn   report-only (exit 0)  [default] — advisory; a value match isn't
 *            always a *semantic* match (16px border != 16px spacing token)
 *   --strict block (exit 1)
 *
 * Exact-match only. Handles hex (#rgb/#rrggbb), rgb()/rgba(α=1), and
 * number+unit lengths. Ubiquitous values (0, 1px, 100%…) are ignored as noise.
 * The "should this specific spot use the token?" judgment is left to review.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';

const args = process.argv.slice(2);
const STRICT = args.includes('--strict');
// Colors are a reliable semantic match; lengths are advisory (a value match
// isn't a meaning match). --colors-only is the safe set to ever block on.
const COLORS_ONLY = args.includes('--colors-only');
const filesIdx = args.indexOf('--files');
const FILES = filesIdx === -1 ? null : args.slice(filesIdx + 1).filter((a) => !a.startsWith('--'));
const ROOT = resolve(
  args.find((a, i) => !a.startsWith('--') && (filesIdx === -1 || i < filesIdx)) || process.cwd()
);

const CSS_EXT = new Set(['.css', '.scss', '.liquid']);
const IGNORE = new Set(['0', '0px', '1px', '2px', '100%', '50%', '100vh', '100vw', 'auto']);
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;
const LENGTH_RE = /-?\d*\.?\d+(?:px|rem|em|%|vh|vw|vmin|vmax|pt|ch|ex)\b/gi;

const read = async (f) => {
  try {
    return await readFile(f, 'utf8');
  } catch {
    return '';
  }
};
const isPageBuilder = (f) => /pf-|pagefly|shogun|gempages|gem-/i.test(f);

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

// Normalize a literal to a canonical key (lowercase #rrggbb for colors, trimmed
// lowercase string for lengths), or null if it's not a value we match on.
function normalize(raw) {
  const s = raw.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) return '#' + [...m[1]].map((c) => c + c).join('');
  m = s.match(/^#([0-9a-f]{6})$/);
  if (m) return '#' + m[1];
  m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) !== 1) return null;
    return '#' + [m[1], m[2], m[3]].map((n) => Math.min(255, +n).toString(16).padStart(2, '0')).join('');
  }
  if (/^-?\d*\.?\d+(?:px|rem|em|%|vh|vw|vmin|vmax|pt|ch|ex)$/.test(s)) return s;
  return null;
}

// Property -> token-name keywords. A length literal is only flagged when the
// matched token's NAME is relevant to the property it's used in, so a 20px
// margin isn't "fixed" with a font-size token. Colors skip this (a hex value
// is a reliable semantic match on its own).
const PROP_KEYWORDS = {
  'font-size': ['font-size', 'font', 'text'],
  'line-height': ['line-height', 'leading'],
  'letter-spacing': ['letter', 'tracking'],
  margin: ['spacing', 'space', 'margin', 'gap'],
  'margin-top': ['spacing', 'space', 'margin'],
  'margin-bottom': ['spacing', 'space', 'margin'],
  'margin-left': ['spacing', 'space', 'margin'],
  'margin-right': ['spacing', 'space', 'margin'],
  padding: ['spacing', 'space', 'padding', 'gap'],
  gap: ['gap', 'spacing', 'space'],
  'column-gap': ['gap', 'spacing', 'column'],
  'row-gap': ['gap', 'spacing', 'row'],
  width: ['width', 'size', 'container'],
  'max-width': ['max-width', 'container', 'width'],
  'min-width': ['min-width', 'width'],
  height: ['height', 'size'],
  'max-height': ['max-height', 'height'],
  'min-height': ['min-height', 'height'],
  'border-radius': ['radius', 'corner'],
  'border-width': ['border-width', 'border'],
};

const isColor = (lit) => /^#|^rgb/i.test(lit.trim());
// Among tokens sharing a value, pick the one whose name fits the property.
function pickToken(property, lit, candidates) {
  if (isColor(lit)) return candidates[0]; // hex/rgb value match is reliable
  const kws = PROP_KEYWORDS[property] || [property];
  return candidates.find((t) => kws.some((k) => t.includes(k))) || null;
}

const allFiles = (await walk(ROOT)).filter((f) => CSS_EXT.has(extname(f)) && !isPageBuilder(f));

// 1) Token vocabulary from the whole theme (even in --files mode).
const tokenByValue = new Map(); // norm -> [token names]
for (const f of allFiles) {
  const src = await read(f);
  for (const m of src.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
    const norm = normalize(m[2]);
    if (!norm || IGNORE.has(norm)) continue;
    if (!tokenByValue.has(norm)) tokenByValue.set(norm, []);
    const arr = tokenByValue.get(norm);
    if (!arr.includes(m[1])) arr.push(m[1]);
  }
}

// 2) Flag literals (outside token definitions) that match a token.
const scope = FILES ? FILES.map((f) => resolve(ROOT, f)) : allFiles;
const violations = [];
for (const f of scope) {
  if (!CSS_EXT.has(extname(f)) || isPageBuilder(f)) continue;
  (await read(f)).split('\n').forEach((line, i) => {
    if (/^\s*--[\w-]+\s*:/.test(line)) return; // token definition line
    // Parse declarations so we know which property each literal belongs to.
    for (const decl of line.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/gi)) {
      const property = decl[1].toLowerCase();
      const value = decl[2];
      const found = COLORS_ONLY
        ? value.match(COLOR_RE) || []
        : [...(value.match(COLOR_RE) || []), ...(value.match(LENGTH_RE) || [])];
      for (const lit of found) {
        const norm = normalize(lit);
        if (!norm || IGNORE.has(norm) || !tokenByValue.has(norm)) continue;
        const token = pickToken(property, lit, tokenByValue.get(norm));
        if (token) violations.push({ file: f, line: i + 1, property, lit, token });
      }
    }
  });
}

if (violations.length === 0) {
  console.log('pc-design-tokens: ✓ no hardcoded values that duplicate a token');
  process.exit(0);
}
const label = STRICT ? '✗' : '⚠';
console.error(
  `pc-design-tokens: ${label} ${violations.length} hardcoded value(s) duplicating a token${STRICT ? '' : ' (warn-only)'}\n`
);
for (const v of violations) {
  console.error(`  ${v.file.replace(ROOT, '.')}:${v.line}`);
  console.error(`      ${v.property}: ${v.lit} → use var(${v.token})`);
}
process.exit(STRICT ? 1 : 0);
