#!/usr/bin/env node
/**
 * pc-render — the rendered-verification layer (pc-gate stages 8–9).
 *
 * Lint proves code is well-formed; this proves the theme actually RENDERS. For
 * each affected storefront route it loads the page in a real headless Chrome and
 * blocks on the failure modes a parser can't see — a broken/404 theme asset (the
 * `entry-*.css` class of bug), an uncaught JS exception, a non-200 document, or a
 * blank body — then runs Lighthouse and (given a baseline) blocks on regressions.
 *
 * This runs anywhere with a headless Chrome — it does NOT need the VPS; the VPS
 * is just the eventual unattended host. Verify it locally against any preview URL.
 *
 * Browser deps are LAZY and optional so the base config package stays lean:
 *   npm i -D puppeteer-core lighthouse chrome-launcher
 * Point at Chrome via $PUPPETEER_EXECUTABLE_PATH or the mac default is tried.
 *
 * Usage:
 *   pc-render --base-url <url> --routes /,/products/x,/collections/y
 *   pc-render --base-url <preview> --baseline-url <base-branch-preview> --routes …
 *   pc-render … --out .pc-gate --json
 *
 * Exit: 0 all routes pass · 1 a blocking render/regression finding · 2 infra
 * (deps missing, Chrome missing, page load infra failure).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (f, d = null) => (args.indexOf(f) === -1 ? d : args[args.indexOf(f) + 1]);
const JSON_OUT = args.includes('--json') || !process.stdout.isTTY;
const BASE_URL = opt('--base-url');
const BASELINE_URL = opt('--baseline-url');
const OUT = opt('--out', '.pc-gate');
const ROUTES = (opt('--routes', '/') || '/').split(',').map((s) => s.trim()).filter(Boolean);

// A7 Core Web Vital thresholds — used as the regression reference (a CWV that
// PASSED on base and FAILS on head blocks; below-target-but-no-worse only warns).
const THRESHOLDS = { LCP: 2500, CLS: 0.1, TBT: 200, FCP: 1800, perf: 70 };
// Console/pageerror noise from third parties we don't control — never block on these.
const NOISE = [/gtag|google-analytics|googletagmanager/i, /facebook|fbevents/i, /hotjar|clarity|klaviyo/i, /the server responded with a status of 4\d\d.*(favicon)/i];

const log = (...m) => { if (!JSON_OUT) console.error(...m); };
const isNoise = (s) => NOISE.some((re) => re.test(s));
// chrome-launcher's kill() may return void or a promise depending on version —
// don't assume it's thenable.
const killChrome = async (c) => { try { const r = c?.kill(); if (r && typeof r.then === 'function') await r; } catch { /* best effort */ } };

// Build a per-route URL that PRESERVES the base's query params — critical for
// preview URLs where `?preview_theme_id=…` must ride along on every route, else
// each navigation silently hits the published theme instead of the preview.
function routeUrl(base, route) {
  const b = new URL(base);
  const u = new URL(route, b.origin);
  b.searchParams.forEach((v, k) => { if (!u.searchParams.has(k)) u.searchParams.set(k, v); });
  return u.href;
}

function infra(msg) {
  const v = { verdict: 'infra_error', error: msg };
  if (JSON_OUT) console.log(JSON.stringify(v, null, 2));
  else console.error(`pc-render: ✗ infra — ${msg}`);
  process.exit(2);
}

if (!BASE_URL) infra('--base-url is required');

// ── lazy-load optional browser deps ─────────────────────────────────────────
let puppeteer, lighthouse, chromeLauncher;
try {
  ({ default: puppeteer } = await import('puppeteer-core'));
  ({ default: lighthouse } = await import('lighthouse'));
  chromeLauncher = await import('chrome-launcher');
} catch (e) {
  infra(`render deps missing (npm i -D puppeteer-core lighthouse chrome-launcher): ${e.message}`);
}

const CHROME =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(CHROME)) infra(`Chrome not found at ${CHROME} — set $PUPPETEER_EXECUTABLE_PATH`);

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// ── launch one Chrome, share it between puppeteer (load) + lighthouse (audit) ─
let chrome, browser;
try {
  chrome = await chromeLauncher.launch({
    chromePath: CHROME,
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
  });
  browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${chrome.port}` });
} catch (e) {
  await killChrome(chrome);
  infra(`could not launch Chrome: ${e.message}`);
}

// ── stage 8: render-load ─────────────────────────────────────────────────
const slug = (r) => (r === '/' ? 'home' : r.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'root');
// A *theme* asset is served from Shopify's theme asset path: /cdn/shop/t/<n>/assets/….
// This deliberately excludes storefront runtime endpoints that merely end in .js
// (cart.js, /api/*, monorail/collect) — those 401/abort in preview/password
// contexts and are not "the theme is broken" signals. This is the entry-* class.
const isThemeAsset = (u) => /\/cdn\/shop\/t\/\d+\/assets\/[^?]+\.(css|js)(\?|$)/i.test(u);

async function renderLoad(route) {
  const url = routeUrl(BASE_URL, route);
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true }); // mobile-first, matches Lighthouse
  const findings = [];
  page.on('pageerror', (err) => { if (!isNoise(String(err))) findings.push({ type: 'js_error', route, message: String(err) }); });
  page.on('requestfailed', (req) => {
    const u = req.url();
    if (isThemeAsset(u) && !isNoise(u)) findings.push({ type: 'asset_failed', route, url: u, error: req.failure()?.errorText });
  });
  page.on('response', (resp) => {
    const u = resp.url();
    if (resp.status() >= 400 && isThemeAsset(u) && !isNoise(u)) findings.push({ type: 'asset_4xx_5xx', route, url: u, status: resp.status() });
  });

  let docStatus = null, bodyLen = 0, loadError = null;
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    docStatus = resp?.status() ?? null;
    if (docStatus && docStatus >= 400) findings.push({ type: 'document_error', route, status: docStatus });
    bodyLen = await page.evaluate(() => (document.body?.innerText || '').trim().length);
    if (bodyLen === 0) findings.push({ type: 'blank_body', route });
    const shot = join(OUT, `${slug(route)}-mobile.png`);
    await page.screenshot({ path: shot, fullPage: true });
    var screenshot = shot;
  } catch (e) {
    loadError = e.message;
    findings.push({ type: 'load_failed', route, message: e.message });
  }
  await page.close().catch(() => {});
  // A 404'd asset also fires requestfailed (ERR_ABORTED) — collapse the pair to
  // one finding per asset URL, preferring the one carrying an HTTP status.
  const assetSeen = new Map();
  const deduped = [];
  for (const f of findings) {
    if (f.type === 'asset_4xx_5xx' || f.type === 'asset_failed') {
      const prev = assetSeen.get(f.url);
      if (!prev) { assetSeen.set(f.url, f); deduped.push(f); }
      else if (f.type === 'asset_4xx_5xx' && prev.type === 'asset_failed') Object.assign(prev, f);
    } else deduped.push(f);
  }
  return { route, url, docStatus, bodyLen, screenshot: typeof screenshot !== 'undefined' ? screenshot : null, findings: deduped, loadError };
}

// ── stage 9: lighthouse ────────────────────────────────────────────────────
async function audit(route) {
  const url = routeUrl(BASE_URL, route);
  try {
    const res = await lighthouse(url, { port: chrome.port, output: 'json', logLevel: 'silent', formFactor: 'mobile', screenEmulation: { mobile: true } }, {
      extends: 'lighthouse:default', settings: { onlyCategories: ['performance'] },
    });
    const a = res.lhr.audits;
    return {
      route,
      perf: Math.round((res.lhr.categories.performance.score ?? 0) * 100),
      LCP: a['largest-contentful-paint']?.numericValue ?? null,
      CLS: a['cumulative-layout-shift']?.numericValue ?? null,
      TBT: a['total-blocking-time']?.numericValue ?? null,
      FCP: a['first-contentful-paint']?.numericValue ?? null,
    };
  } catch (e) {
    return { route, error: e.message };
  }
}

// ── run ──────────────────────────────────────────────────────────────────
const results = [];
let blocking = false;
try {
  for (const route of ROUTES) {
    log(`  rendering ${route} …`);
    const load = await renderLoad(route);
    const head = await audit(route);
    let base = null;
    if (BASELINE_URL) {
      const burl = routeUrl(BASELINE_URL, route);
      try {
        const res = await lighthouse(burl, { port: chrome.port, output: 'json', logLevel: 'silent', formFactor: 'mobile', screenEmulation: { mobile: true } }, { extends: 'lighthouse:default', settings: { onlyCategories: ['performance'] } });
        const a = res.lhr.audits;
        base = { perf: Math.round((res.lhr.categories.performance.score ?? 0) * 100), LCP: a['largest-contentful-paint']?.numericValue, CLS: a['cumulative-layout-shift']?.numericValue, TBT: a['total-blocking-time']?.numericValue, FCP: a['first-contentful-paint']?.numericValue };
      } catch { /* baseline optional */ }
    }

    // regression evaluation (only blocks when we have a baseline to regress against)
    const perfFindings = [];
    if (base) {
      if (head.perf != null && head.perf < base.perf - 5) perfFindings.push({ type: 'perf_regression', route, metric: 'score', base: base.perf, head: head.perf });
      for (const m of ['LCP', 'CLS', 'TBT', 'FCP']) {
        const t = THRESHOLDS[m];
        if (base[m] != null && head[m] != null && base[m] <= t && head[m] > t) perfFindings.push({ type: 'cwv_regression', route, metric: m, base: base[m], head: head[m], threshold: t });
      }
    }
    const loadBlocking = load.findings.some((f) => ['js_error', 'asset_failed', 'asset_4xx_5xx', 'document_error', 'blank_body', 'load_failed'].includes(f.type));
    if (loadBlocking || perfFindings.length) blocking = true;
    results.push({ route, load, lighthouse: head, baseline: base, perfFindings });
  }
} finally {
  await browser.disconnect().catch(() => {});
  await killChrome(chrome);
}

const verdict = blocking ? 'fail' : 'pass';
const out = { verdict, base_url: BASE_URL, baseline_url: BASELINE_URL, routes: results };
if (JSON_OUT) console.log(JSON.stringify(out, null, 2));
else {
  console.error(`\npc-render: ${blocking ? '✗ FAIL' : '✓ PASS'}`);
  for (const r of results) {
    const marks = [...r.load.findings, ...r.perfFindings];
    console.error(`  ${marks.length ? '✗' : '✓'} ${r.route}  perf=${r.lighthouse.perf ?? '?'}  LCP=${r.lighthouse.LCP ? Math.round(r.lighthouse.LCP) + 'ms' : '?'}`);
    for (const f of marks) console.error(`      [${f.type}] ${f.url || f.metric || f.message || ''} ${f.status || ''}`);
  }
}
process.exit(blocking ? 1 : 0);
