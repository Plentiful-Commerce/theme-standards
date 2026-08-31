/**
 * liquid-checks — canonical deterministic Liquid/CSS/JS rules for Plentiful
 * Commerce. ONE source of truth, consumed by both:
 *   - pc-lint (the PR gate)            — blocks on introduced violations
 *   - shopify-audit-tool/liquid-best-practices.js (client scoring) — reports
 *
 * Pure, dependency-free. Each detector returns violations as
 * { rule, severity, path, line, detail }. `severity` drives the gate:
 * 'error' blocks, 'warning' is advisory.
 */

export const RULES = {
  'liquid-include': { severity: 'error', title: 'Legacy {% include %}', message: 'Use {% render %} instead of the legacy {% include %}' },
  'document-write': { severity: 'error', title: 'document.write()', message: 'Remove document.write (render-blocking)' },
  'stylesheet-tag-in-section': { severity: 'error', title: 'stylesheet_tag in section', message: 'Use {% stylesheet %} in sections, not stylesheet_tag (CSS subsetting)' },
  'dual-tracking': { severity: 'error', title: 'Dual tracking (gtag + GTM)', message: 'Both inline gtag and GTM present — pick one tracking path' },
  'duplicate-script': { severity: 'error', title: 'Duplicate <script>', message: 'Duplicate <script> tag in theme.liquid' },
  'browserslist-ie': { severity: 'error', title: 'browserslist targets IE', message: 'Remove IE targets from browserslist' },
  'tracking-before-charset': { severity: 'error', title: 'Tracking before <meta charset>', message: 'Move tracking after <meta charset> (HTML spec / parser speed)' },
  'missing-content-for-header': { severity: 'error', title: 'Missing content_for_header', message: 'Add {{ content_for_header }} to <head> in theme.liquid' },
  'hero-lazyloaded': { severity: 'error', title: 'LCP/hero image lazyloaded', message: 'Hero image uses lazysizes — use src + fetchpriority="high" + loading="eager"' },
  'dynamic-style-block': { severity: 'warning', title: 'Dynamic <style> with Liquid', message: 'Scope dynamic values as CSS custom properties on #shopify-section-{{ section.id }}' },
  'inline-js-too-large': { severity: 'warning', title: 'Large inline <script> in section', message: 'Extract section JS to a deferred asset file / web component' },
  'render-blocking-css': { severity: 'warning', title: 'Render-blocking non-critical CSS', message: 'Load non-critical CSS with media="print" onload="this.media=\'all\'"' },
  'monolithic-css': { severity: 'warning', title: 'Monolithic custom CSS', message: 'Move section-specific CSS into {% stylesheet %} blocks' },
  'sale-css-dated': { severity: 'warning', title: 'Dated sale CSS', message: 'Remove date-stamped sale CSS when the sale ends' },
};

/**
 * Inline suppression, mirroring Theme Check's convention so the two gates read
 * the same way. Put the directive in whatever comment syntax the file already
 * uses — Liquid, HTML, JS or CSS — it is matched as plain text:
 *
 *   {%- # pc-lint-disable liquid-include -%}      ... {%- # pc-lint-enable liquid-include -%}
 *   {%- # pc-lint-disable-next-line liquid-include -%}
 *
 * Naming one or more rules scopes the suppression to those rules; naming none
 * suppresses every rule. Always pair a region `disable` with an `enable` and
 * keep it as tight as possible — an unclosed `disable` silences the rest of the
 * file. A suppressed occurrence does NOT mask a later un-suppressed one: each
 * rule keeps scanning and reports the first occurrence that is still live.
 */
const ALL = '*';

function ruleNamesFrom(tail) {
  const names = (tail.match(/[a-z][a-z0-9-]*/g) || []).filter((n) => Object.hasOwn(RULES, n));
  return names.length ? names : [ALL];
}

export function parseDisables(content) {
  const lines = String(content).split('\n');
  const nextLine = new Map(); // line -> Set(rule)
  const open = new Map(); // rule -> start line
  const regions = []; // {rule, from, to}

  lines.forEach((text, i) => {
    const lineNo = i + 1;
    let m;
    if ((m = /pc-lint-disable-next-line([^\n]*)/.exec(text))) {
      const set = nextLine.get(lineNo + 1) || new Set();
      for (const r of ruleNamesFrom(m[1])) set.add(r);
      nextLine.set(lineNo + 1, set);
      return; // a -next-line directive is never also a region directive
    }
    if ((m = /pc-lint-enable([^\n]*)/.exec(text))) {
      for (const r of ruleNamesFrom(m[1])) {
        if (open.has(r)) {
          regions.push({ rule: r, from: open.get(r), to: lineNo });
          open.delete(r);
        }
      }
      return;
    }
    if ((m = /pc-lint-disable([^\n]*)/.exec(text))) {
      for (const r of ruleNamesFrom(m[1])) if (!open.has(r)) open.set(r, lineNo);
    }
  });
  for (const [rule, from] of open) regions.push({ rule, from, to: lines.length + 1 });

  return function isDisabled(rule, line) {
    const nl = nextLine.get(line);
    if (nl && (nl.has(rule) || nl.has(ALL))) return true;
    return regions.some((r) => (r.rule === rule || r.rule === ALL) && line >= r.from && line <= r.to);
  };
}

// First occurrence of `re` whose line is not suppressed. Keeps the historical
// one-violation-per-rule output shape while honouring inline disables.
function firstLive(re, content, isDisabled, rule) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  for (const m of content.matchAll(g)) {
    const line = lineOf(content, m.index);
    if (!isDisabled(rule, line)) return { index: m.index, line };
  }
  return null;
}

const HERO = ['slideshow', 'image-banner', 'hero', 'banner'];
const NON_CRITICAL_CSS = ['carousel.css', 'mini-cart', 'swiper.css'];
const lineOf = (content, idx) => (idx < 0 ? 1 : content.slice(0, idx).split('\n').length);
const v = (rule, path, line, detail) => ({ rule, severity: RULES[rule].severity, path, line, detail: detail || RULES[rule].message });

// Per-file Liquid checks (sections, snippets, theme.liquid).
export function checkLiquidFile(path, content) {
  const out = [];
  const isDisabled = parseDisables(content);
  const isSection = /(^|\/)sections\//.test(path);
  const isTheme = /(^|\/)layout\/theme\.liquid$/.test(path);

  let m = firstLive(/\{%-?\s*include\s+/, content, isDisabled, 'liquid-include');
  if (m) out.push(v('liquid-include', path, m.line));
  m = firstLive(/document\.write/, content, isDisabled, 'document-write');
  if (m) out.push(v('document-write', path, m.line));

  if (isSection) {
    m = firstLive(/stylesheet_tag/, content, isDisabled, 'stylesheet-tag-in-section');
    if (m) out.push(v('stylesheet-tag-in-section', path, m.line));
    for (const block of content.match(/<style[\s\S]*?<\/style>/gi) || []) {
      if (block.includes('{%') || block.includes('{{')) {
        out.push(v('dynamic-style-block', path, lineOf(content, content.indexOf(block))));
        break;
      }
    }
    const scripts = content.match(/<script(?![^>]*src)[^>]*>[\s\S]*?<\/script>/gi) || [];
    const inlineChars = scripts.reduce((s, b) => s + b.length, 0);
    if (inlineChars > 500) {
      out.push(v('inline-js-too-large', path, lineOf(content, content.indexOf(scripts[0])), `~${inlineChars} chars of inline <script> — extract to a deferred file`));
    }
    if (HERO.some((h) => path.toLowerCase().includes(h)) && content.includes('lazyload') && content.includes('data-src')) {
      out.push(v('hero-lazyloaded', path, 1));
    }
  }

  if (isTheme) {
    if (content.includes('googletagmanager.com/gtag/js') && content.includes('googletagmanager.com/gtm.js')) {
      out.push(v('dual-tracking', path, lineOf(content, content.indexOf('googletagmanager.com/gtag/js'))));
    }
    // Only count real <script> tags — a preload <link> for the same asset is the
    // correct defer pattern, not a duplicate.
    const names = [...content.matchAll(/<script[^>]*?['"]([\w./-]+\.js)['"]\s*\|\s*asset_url/g)].map((x) => x[1]);
    const seen = new Set();
    const dupes = new Set();
    for (const n of names) (seen.has(n) ? dupes : seen).add(n);
    for (const d of dupes) out.push(v('duplicate-script', path, 1, `Duplicate <script> tag: ${d}`));

    const cs = content.indexOf('<meta charset');
    const g1 = content.indexOf('googletagmanager.com/gtag/js');
    const g2 = content.indexOf('googletagmanager.com/gtm.js');
    const before = [];
    if (g1 > -1 && cs > -1 && g1 < cs) before.push('gtag');
    if (g2 > -1 && cs > -1 && g2 < cs) before.push('GTM');
    if (before.length) out.push(v('tracking-before-charset', path, 1, `Before <meta charset>: ${before.join(', ')}`));

    if (!content.includes('content_for_header')) out.push(v('missing-content-for-header', path, 1));

    for (const f of NON_CRITICAL_CSS) {
      const idx = content.indexOf(f);
      if (idx === -1) continue;
      const around = content.slice(Math.max(0, idx - 200), idx + 200);
      const sync = /stylesheet_tag/.test(around) || /rel=["']stylesheet["']/.test(around);
      if (sync && !/media=["']print["']/.test(around)) {
        out.push(v('render-blocking-css', path, lineOf(content, idx), `${f} loaded render-blocking`));
      }
    }
  }
  return out.filter((x) => !isDisabled(x.rule, x.line));
}

// Custom CSS file checks (monolithic size, dated sale blocks).
export function checkCssFile(path, content, anySectionUsesStylesheet) {
  const out = [];
  if (!/custom[\w-]*\.css$/i.test(path)) return out;
  const isDisabled = parseDisables(content);
  const lines = content.split('\n').length;
  if (lines > 500) out.push(v('monolithic-css', path, 1, `${lines} lines — likely holds section-specific CSS`));
  else if (lines > 300 && !anySectionUsesStylesheet) out.push(v('monolithic-css', path, 1, `${lines} lines and no section uses {% stylesheet %}`));
  const dated = content.match(/\/\*[^*]*\d{1,2}[-/]\d{1,2}[-/]\d{2,4}[^*]*\*\//g) || [];
  if (dated.length) out.push(v('sale-css-dated', path, 1, `${dated.length} date-stamped block(s) — verify still active`));
  return out.filter((x) => !isDisabled(x.rule, x.line));
}

// browserslist must exclude IE. Flag only IE *inclusions* — `not ie <= 11` is fine.
export function checkBrowserslist(queries) {
  const hasIE = (queries || [])
    .map((q) => String(q).trim())
    .some((q) => /^(ie|internet explorer)\b/i.test(q) && !/^not\b/i.test(q));
  return hasIE ? [v('browserslist-ie', 'browserslist', 1)] : [];
}

/**
 * Run every deterministic rule over a theme.
 * @param {{files: {path,content}[], browserslistQueries?: string[]}} input
 * @returns {{rule,severity,path,line,detail}[]}
 */
export function runAll({ files = [], browserslistQueries = [] }) {
  const sections = files.filter((f) => /(^|\/)sections\//.test(f.path));
  const anySectionUsesStylesheet = sections.some((f) => f.content.includes('{% stylesheet'));
  const out = [];
  for (const f of files) {
    if (/\.css$/i.test(f.path)) out.push(...checkCssFile(f.path, f.content, anySectionUsesStylesheet));
    else if (/\.liquid$/i.test(f.path)) out.push(...checkLiquidFile(f.path, f.content));
  }
  out.push(...checkBrowserslist(browserslistQueries));
  return out;
}
