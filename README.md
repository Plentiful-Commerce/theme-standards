# @plentiful/theme-standards

Canonical lint/format/Theme Check configs + the custom `pc-lint` checks for every Plentiful Commerce Shopify theme repo. One source of truth so configs stop drifting repo-to-repo. Implements [CODING-STANDARDS.md](./CODING-STANDARDS.md) (Parts A & B); see Part D for the rollout and Part E for the agent/CI model.

## For developers (start here)

**What runs when you `git commit`** (pre-commit hook, local):
- Prettier / ESLint / Stylelint auto-**fix** your staged files (formatting — doesn't block).
- If you staged `.liquid`: **Theme Check** runs and **blocks the commit** on any offense you *introduced* (e.g. `img_url`, missing `alt`). Needs the Shopify CLI installed (`brew install shopify-cli`) — if it's missing and you staged Liquid, the commit is blocked with a hint.

**What runs when you open/update a PR** (CI — the real gate, can't be skipped):
- ESLint and Stylelint (block on errors), **Prettier `--check`** (blocks on files you changed), **`pc-lint`** (blocks on error-severity rules in files you changed), **Theme Check** (blocks on offenses you introduced), design-token check (advisory).
- It **only blocks on what your PR changes** — pre-existing legacy debt in untouched files stays a warning, so it won't red-wall unrelated work.

**When it fails:** read the message — it names the file, line, and fix. Fix it and push. For a genuine one-off, `git commit --no-verify` skips the *local* hook (CI still enforces). CI must be green to merge.

**Adopting a new repo:** follow [Adopting it in a repo](#adopting-it-in-a-repo) below. **Changing a rule:** edit it once here (in `rules/liquid-checks.mjs` or the config files), tag a new version, bump the dep in each repo — the gate and the audit tool both read from this one place.

## What's in here

| Path | Purpose |
|---|---|
| `prettier.json` | Prettier config (+ `@shopify/prettier-plugin-liquid`) |
| `eslint/index.cjs` | Shared ESLint config (ESLint 8, `@babel/eslint-parser`, prettier-compatible) |
| `stylelint/index.json` | Stylelint config (rem-not-px, `!important` warnings) |
| `theme-check/index.yml` | Shopify Theme Check baseline (PC thresholds + `ValidScopedCSSClass`) |
| `rules/liquid-checks.mjs` | **The single source of truth** for the deterministic Liquid/CSS/JS rules. Imported by both `pc-lint` (the gate) **and** `shopify-audit-tool` (client scoring) so they can't drift |
| `scripts/pc-lint.mjs` | Thin wrapper that runs `rules/liquid-checks.mjs` and blocks on error-severity violations (warnings advise). 13 rules: include, document.write, stylesheet_tag-in-section, dual-tracking, duplicate-script, browserslist-IE, tracking-before-charset, content_for_header, hero-lazyload, dynamic-style-block, monolithic-css, inline-JS, render-blocking-CSS, dated sale CSS |
| `scripts/theme-check-changed.mjs` | Diff-scopes Shopify Theme Check to offenses on **added lines** — the introduced-only Liquid/SEO/a11y gate |
| `scripts/pc-design-tokens.mjs` | Flags a hardcoded value that duplicates a CSS token (`#372305 → var(--color-chocolate)`). Property-aware; colors reliable, lengths advisory. Warn-first |
| `templates/` | Copy-in files: `.editorconfig`, husky `pre-commit`, `lint-staged`, CI `lint.yml` |
| `CODING-STANDARDS.md` | The standards this package enforces (the canonical copy repos `@import` into CLAUDE.md) |

## Enforcement model — when does each check run?

There are **two layers**, at two different moments. They are complementary, not alternatives.

| | Pre-commit hook (lint-staged) | CI (`lint.yml`) |
|---|---|---|
| **Trigger** | `git commit` | PR opened/updated, or push to `main` |
| **Runs where** | Wherever the commit is made — a laptop, a VPS, an agent's sandbox | GitHub Actions (server-side) |
| **Scope** | Staged files only | The repo / the **PR diff** |
| **What it does** | Auto-**formats** + `--fix`es staged files | Lints and **blocks** (fails the PR) |
| **Bypassable?** | **Yes** — `git commit --no-verify`, or simply absent if husky isn't installed | **No** — always runs, can't be skipped |

**The pre-commit hook is best-effort convenience, not a guarantee.** It's local, it only formats, and a coding agent (especially one running in CI or committing programmatically) often skips it entirely. So it is **not** the gate.

**CI is the enforcement.** It runs on every PR, can't be bypassed, and is the wall an agent has to get past. That's where blocking lives.

### Blocking strategy: block on the diff, not the whole repo

A whole-repo *blocking* gate is red on day one of adoption (pre-existing legacy debt). A whole-repo *warn-only* gate never forces anything. Neither is right. Instead CI **blocks on what the PR changes** and only **warns** on untouched legacy:

| CI step | Scope | Behavior |
|---|---|---|
| ESLint | whole `src` | **blocks** on errors |
| Prettier `--check` | changed files | **blocks** (mis-formatted touched files fail) |
| **pc-lint `--files`** | the PR diff (changed **files**) | **blocks** — exit 1 on any violation in a touched file |
| **Theme Check (introduced)** | the PR diff (added **lines**) | **blocks** at `warning`+ — catches `img_url`/deprecated filters, missing `alt`, img width/height, schema errors, etc. |
| pc-lint `--warn` / Theme Check summary | whole repo | report-only — keeps total debt visible |

So: an agent that adds a new `{% include %}`, an `img_url`, a `stylesheet_tag` in a section, a deprecated filter, or re-introduces IE to browserslist **fails CI and is forced to fix it** — while legacy debt the PR didn't touch stays a tracked warning and doesn't red-wall unrelated work. As code is touched, it's ratcheted clean.

**Scope nuance:** `pc-lint` scopes to changed **files** (its checks are file-level patterns), while Theme Check scopes to added **lines** (it has precise rows and lots of legacy warnings, so line-scoping avoids blocking on a pre-existing warning in a file you merely edited). Both share the goal: *fail on what you introduce.*

**This is deterministic enforcement only (tier 1).** Rendered checks (color contrast, real LCP — axe-core/Lighthouse) need a running preview and live in the audit tool; judgment calls ("did you reuse the existing component?", "is this the right token?") belong to an AI reviewer in CI, not this gate.

**Local feedback for Liquid:** the pre-commit hook runs Theme Check on staged Liquid (via the local Shopify CLI), but the best real-time experience is the **Shopify Liquid / Theme Check IDE extension** — inline, instant, nothing to wait for at commit time.

### `pc-lint` modes

```bash
node scripts/pc-lint.mjs            # whole repo, blocking (exit 1 on any violation)
node scripts/pc-lint.mjs --warn     # whole repo, report-only (exit 0) — visibility
node scripts/pc-lint.mjs --files a b c   # only the listed files, blocking — the CI diff gate
```

CI computes the changed files (`git diff --name-only "origin/$BASE...HEAD"`) and passes them to `--files`.

### Tightening over time
Adoption is deliberately lenient on legacy. Once a repo's whole-repo `--warn` pass is clean, flip the gate to strict: run `pc-lint` (no `--warn`) whole-repo as blocking, and raise `theme check` to `--fail-level=error`. Stylelint's `px`/`!important` warnings can likewise be promoted to `error`.

## Adopting it in a repo

> **Prerequisite: Node 22+.** `@babel/eslint-parser@8` requires `node ^22.18.0 || >=24.11.0`.
> Adopting the standard therefore raises the repo's Node floor — **bump every workflow in
> `.github/workflows/`, not just `lint.yml`**, and bump `.nvmrc`. A stale `node-version` in an
> unrelated workflow (e.g. an asset-compile job) will start failing at `yarn install` the moment
> this lands, and re-running it won't help — a re-run replays the *old* workflow file.

**1. Install** (the package is a PUBLIC git dep — no auth — plus peer deps):

```bash
npm i -D "github:Plentiful-Commerce/theme-standards#v0.1.1" \
  eslint@^8.57.0 @babel/eslint-parser eslint-config-prettier \
  prettier @shopify/prettier-plugin-liquid \
  stylelint stylelint-config-standard \
  husky lint-staged
```
(yarn: `yarn add -D "github:Plentiful-Commerce/theme-standards#v0.1.1" …`.)

**2. Add the config files** to the repo root:

```js
// .eslintrc.cjs — require.resolve is REQUIRED: ESLint's legacy resolver
// doesn't honor package "exports", so a bare extends string fails.
module.exports = { root: true, extends: [require.resolve('@plentiful/theme-standards/eslint')] };
```
```json
// .stylelintrc.json
{ "extends": "@plentiful/theme-standards/stylelint" }
```
Point Prettier at the shared config via `package.json`:
```json
"prettier": "@plentiful/theme-standards/prettier"
```
Copy `templates/editorconfig` → `.editorconfig`.

Copy `theme-check/index.yml` → `.theme-check.yml` (Theme Check doesn't reliably resolve npm-package `extends`, so copy it rather than extend). **If the repo already has a `.theme-check.yml`, overwrite it — don't leave the legacy one in place.** Most existing theme repos ship a hand-rolled `extends: :nothing` config with an explicit rule list; keeping it means the gate silently runs against a non-standard ruleset and you lose `theme-check:recommended` plus `ValidScopedCSSClass` (must-run per CODING-STANDARDS A7). Re-add any genuinely repo-specific bits (e.g. an `ignore:` list) at the bottom of the copied file, under a clearly marked overrides heading.

Expect the canonical config to surface **more** offenses than the legacy one. That's the point — they're pre-existing debt, they don't block (the whole-repo pass is warn-only and the gate is diff-scoped), and they belong on a debt ticket.

**3. Add the standardized scripts** (CODING-STANDARDS B7) to `package.json` — scripts run via the package bins (`npx`):

```jsonc
"scripts": {
  "lint": "eslint 'src/**/*.js'",
  "lint:css": "stylelint '**/*.css'",
  "lint:liquid": "shopify theme check",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  // local convenience check — pc-lint in --warn so legacy debt doesn't block.
  // CI does the real diff-scoped blocking (see Enforcement model above).
  "check": "npm run lint && pc-lint --warn"
}
```
`npm run check` is the quick local pass; the **CI gate** in `lint.yml` is what actually blocks (on the PR diff). Once the repo's whole-repo `--warn` pass is clean, drop `--warn` here to make it blocking too.

**4. Wire up hooks + CI:**
- Copy `templates/husky-pre-commit` → `.husky/pre-commit` (run `npx husky init` first on fresh repos), and merge `templates/lint-staged.json` into `package.json` under `"lint-staged"`.
- Copy `templates/github-lint.yml` → `.github/workflows/lint.yml`. The template is npm-based; for the Encore/yarn theme family swap `npm ci` → `yarn install` and `npm run X` → `yarn X`. **Keep every step when you adapt it** — the Prettier `--check` and Stylelint steps are easy to drop in the rewrite, and losing them silently removes two blocking gates.

**5. Point the build agent at the standards** — in the repo's `.claude/CLAUDE.md` (Tier 2 import, CODING-STANDARDS Part E):

```markdown
@./node_modules/@plentiful/theme-standards/CODING-STANDARDS.md
```

## Notes

- **garden-club-plants** is SASS-only (not Encore) — adjust the `lint`/`lint:css` globs to its layout.
- **ESLint 8** on purpose — the themes are on 8.x; the migration is `babel-eslint` → `@babel/eslint-parser`, not an ESLint major bump.
- Stylelint `font-size: px` and `!important` are **warnings**, not errors, so legacy CSS doesn't block the first adoption PR. Tighten to `error` once a repo is clean.
- To publish to the Plentiful-Commerce org: extract this directory to its own repo, `npm publish` to the org's private registry (or consume via a git URL).
