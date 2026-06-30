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

const HERO = ['slideshow', 'image-banner', 'hero', 'banner'];
const NON_CRITICAL_CSS = ['carousel.css', 'mini-cart', 'swiper.css'];
const lineOf = (content, idx) => (idx < 0 ? 1 : content.slice(0, idx).split('\n').length);
const v = (rule, path, line, detail) => ({ rule, severity: RULES[rule].severity, path, line, detail: detail || RULES[rule].message });

// Per-file Liquid checks (sections, snippets, theme.liquid).
export function checkLiquidFile(path, content) {
  const out = [];
  const isSection = /(^|\/)sections\//.test(path);
  const isTheme = /(^|\/)layout\/theme\.liquid$/.test(path);

  let m = /\{%-?\s*include\s+/.exec(content);
  if (m) out.push(v('liquid-include', path, lineOf(content, m.index)));
  m = /document\.write/.exec(content);
  if (m) out.push(v('document-write', path, lineOf(content, m.index)));

  if (isSection) {
    m = /stylesheet_tag/.exec(content);
    if (m) out.push(v('stylesheet-tag-in-section', path, lineOf(content, m.index)));
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
  return out;
}

// Custom CSS file checks (monolithic size, dated sale blocks).
export function checkCssFile(path, content, anySectionUsesStylesheet) {
  const out = [];
  if (!/custom[\w-]*\.css$/i.test(path)) return out;
  const lines = content.split('\n').length;
  if (lines > 500) out.push(v('monolithic-css', path, 1, `${lines} lines — likely holds section-specific CSS`));
  else if (lines > 300 && !anySectionUsesStylesheet) out.push(v('monolithic-css', path, 1, `${lines} lines and no section uses {% stylesheet %}`));
  const dated = content.match(/\/\*[^*]*\d{1,2}[-/]\d{1,2}[-/]\d{2,4}[^*]*\*\//g) || [];
  if (dated.length) out.push(v('sale-css-dated', path, 1, `${dated.length} date-stamped block(s) — verify still active`));
  return out;
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
