#!/usr/bin/env node
/**
 * preview-fix — force a Shopify branch-preview theme to recompile its CSS.
 *
 * Why this exists (legacy `.css.liquid` themes — Turbo and other Vintage-era
 * themes; Focal/Dawn emit settings as per-request CSS custom properties and are
 * immune):
 *
 * These themes build their stylesheet through Liquid, so every colour and font
 * is compiled INTO the CSS rather than applied at runtime. Shopify keys that
 * compiled output to the SOURCE FILE's version hash, not to settings_data.json.
 * A branch-preview theme created by the GitHub integration compiles the
 * stylesheet before settings finish syncing, bakes in the theme's stock
 * defaults, and then never recompiles.
 *
 * Saving in the theme editor does NOT fix it — that changes settings, not the
 * source, so the version hash never moves. The theme editor still looks correct
 * because it renders Liquid per request; only the storefront preview serves the
 * stale cached artifact. That editor-right / preview-wrong split is the tell.
 *
 * Full write-up: ~/internal-claude/context/agency-work/coding/SHOPIFY-THEME-GOTCHAS.md
 *
 * Editing the source file is the only thing that busts the hash. This script
 * does that against the theme directly, so nothing is committed and the PR diff
 * stays clean: append a throwaway marker, push just that asset, restore the
 * local file.
 *
 * Usage:
 *   npm run preview:fix                 # auto-detect theme from current branch
 *   npm run preview:fix --theme 12345   # explicit theme id
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const STORE = '[STORE_ID]';

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1e9 });

// Only a .css.liquid that READS settings can go stale — that is the whole bug.
// Detect rather than hardcode, so this works on any exposed theme (Turbo's
// styles.css.liquid, Focal's font-settings.css.liquid, …).
function staleAssets() {
  const hits = readdirSync('assets')
    .filter((f) => f.endsWith('.css.liquid'))
    .map((f) => `assets/${f}`)
    .filter((p) => /settings\./.test(readFileSync(p, 'utf8')));
  if (!hits.length) {
    console.log('No settings-driven .css.liquid in assets/ — this theme cannot hit the');
    console.log('branch-preview staleness bug. Nothing to do.');
    process.exit(0);
  }
  return hits;
}

// `--json` avoids parsing the CLI's box-drawing table, which wraps long names
// and even splits theme ids across lines.
const themes = () => JSON.parse(sh('shopify', ['theme', 'list', '--store', STORE, '--json']));

function themeIdFromBranch() {
  const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (['main', 'master'].includes(branch)) {
    console.error(`Refusing to run on "${branch}" — that resolves to the LIVE theme.`);
    console.error('This script only targets branch-preview themes. Check out a feature branch.');
    process.exit(1);
  }
  const wanted = `${STORE}/${branch}`;
  console.log(`Looking for preview theme "${wanted}" …`);
  const hit = themes().find((t) => t.name === wanted);
  if (!hit) {
    console.error(`\nNo theme named "${wanted}" on ${STORE}.`);
    console.error('Shopify creates preview themes for branches with an open PR against main.');
    console.error('Push the branch first, or pass --theme <id> explicitly.');
    process.exit(1);
  }
  return String(hit.id);
}

const argIdx = process.argv.indexOf('--theme');
const themeId = argIdx !== -1 ? process.argv[argIdx + 1] : themeIdFromBranch();

// `--theme` with no value (or followed by another flag) leaves this undefined,
// which sails past the live-theme guard below and then dies inside execFileSync
// with an unreadable ERR_INVALID_ARG_TYPE. Fail clearly instead.
if (!themeId || !/^\d+$/.test(String(themeId))) {
  console.error(`--theme requires a numeric theme id (got: ${themeId ?? 'nothing'}).`);
  console.error('Run `shopify theme list --store [STORE_ID] --json` to find it.');
  process.exit(1);
}

// Belt and braces: never touch the published theme, even via an explicit
// --theme id. A bad push here would rewrite the live storefront's stylesheet.
{
  const live = themes().find((t) => t.role === 'live');
  if (live && String(live.id) === String(themeId)) {
    console.error(`Refusing: #${themeId} ("${live.name}") is the LIVE theme.`);
    process.exit(1);
  }
}

const assets = staleAssets();
const originals = new Map(assets.map((p) => [p, readFileSync(p, 'utf8')]));
const marker = `\n{% comment %}preview-fix ${new Date().toISOString()}{% endcomment %}\n`;
const push = (p) =>
  sh('shopify', ['theme', 'push', '--store', STORE, '--theme', themeId, '--only', p, '--force']);

console.log(`Busting version hash on theme #${themeId}: ${assets.join(', ')} …`);
try {
  for (const p of assets) {
    // Marker is a Liquid comment: it emits nothing, so the compiled CSS is
    // unchanged. Appended at EOF so no line numbers shift.
    writeFileSync(p, originals.get(p) + marker);
    push(p);
    // Restore the real source and push again, so the theme ends up identical to
    // the branch — but now with a correctly compiled stylesheet.
    writeFileSync(p, originals.get(p));
    push(p);
  }
} finally {
  // Never leave a marker behind, even if a push throws.
  for (const p of assets) writeFileSync(p, originals.get(p));
}

console.log(`\n✓ Done. ${assets.join(', ')} unchanged locally and in git.`);
console.log(`  Preview: https://${STORE}.myshopify.com/?preview_theme_id=${themeId}`);
console.log('  Give the CDN ~15s, then hard-reload.');
