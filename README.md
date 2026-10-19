# @plentiful/theme-standards

Canonical lint/format/Theme Check configs + the custom `pc-lint` checks for every Plentiful Commerce Shopify theme repo. One source of truth so configs stop drifting repo-to-repo. Implements [CODING-STANDARDS.md](./CODING-STANDARDS.md) (Parts A & B); see Part C for the agent/CI model.

## For developers (start here)

**What runs when you `git commit`** (pre-commit hook, local):
- Prettier / ESLint / Stylelint auto-**fix** your staged files (formatting — doesn't block).
- If you staged `.liquid`: **Theme Check** runs and **blocks the commit** on any offense you *introduced* (e.g. `img_url`, missing `alt`). Needs the Shopify CLI installed (`brew install shopify-cli`) — if it's missing and you staged Liquid, the commit is blocked with a hint.

**What runs when you open/update a PR** (CI — the real gate, can't be skipped):
- ESLint and Stylelint (block on errors), **Prettier `--check`** (blocks on files you changed), **`pc-lint`** (blocks on error-severity rules in files you changed), **Theme Check** (blocks on offenses you introduced), design-token check (advisory).
- It **only blocks on what your PR changes** — pre-existing legacy debt in untouched files stays a warning, so it won't red-wall unrelated work.

**When it fails:** read the message — it names the file, line, and fix. Fix it and push. For a genuine one-off, `git commit --no-verify` skips the *local* hook (CI still enforces). CI must be green to merge.

**Adopting a new repo:** follow [Adopting it in a repo](#adopting-it-in-a-repo) below. **Changing a rule or a tool version:** edit it once here (in `rules/liquid-checks.mjs`, the config files or the `dependencies` pins), [release a new version](#releasing), and run the bump script — the gate and the audit tool both read from this one place. **Changing a CI step, an action version or the Node version:** edit the workflow in `.github/workflows/` here; every repo picks it up on its next run, with no release (see [Shared workflows](#shared-workflows)).

## What's in here

| Path | Purpose |
|---|---|
| `prettier.json` | Prettier config (+ `@shopify/prettier-plugin-liquid`) |
| `eslint/index.mjs` | Shared ESLint flat config (ESLint 10, `@babel/eslint-parser`, prettier-compatible, Node globals for root `*.config.js`) |
| `stylelint/index.json` | Stylelint config (rem-not-px, `!important` warnings) |
| `lint-staged/index.mjs` | The lint-staged config the pre-commit hook runs (Prettier, ESLint `--fix`, Stylelint `--fix` on staged files) |
| `theme-check/index.yml` | Shopify Theme Check baseline (PC thresholds + `ValidScopedCSSClass`) |
| `rules/liquid-checks.mjs` | **The single source of truth** for the deterministic Liquid/CSS/JS rules. Imported by both `pc-lint` (the gate) **and** `shopify-audit-tool` (client scoring) so they can't drift |
| `scripts/pc-lint.mjs` | Thin wrapper that runs `rules/liquid-checks.mjs` and blocks on error-severity violations (warnings advise). 13 rules: include, document.write, stylesheet_tag-in-section, dual-tracking, duplicate-script, browserslist-IE, tracking-before-charset, content_for_header, hero-lazyload, dynamic-style-block, monolithic-css, inline-JS, render-blocking-CSS, dated sale CSS |
| `scripts/pc-pre-commit.sh` | The pre-commit hook body: lint-staged with the shared config, then line-scoped Theme Check on staged Liquid. A repo's `.husky/pre-commit` is one line that runs it |
| `.github/workflows/lint.yml`, `compile-assets.yml`, `pr-body.yml` | The shared workflows (`workflow_call`): the lint gate, the asset build that commits `assets/entry-*`, and the PR-description check. A repo's own copies are short callers at `main`. See [Shared workflows](#shared-workflows) |
| `scripts/theme-check-changed.mjs` | Diff-scopes Shopify Theme Check to offenses on **added lines** — the introduced-only Liquid/SEO/a11y gate |
| `scripts/pc-design-tokens.mjs` | Flags a hardcoded value that duplicates a CSS token (`#372305 → var(--color-chocolate)`). Property-aware; colors reliable, lengths advisory. Warn-first |
| `scripts/pc-repo-check.mjs` | Fails CI when the repo drifts from the PC shape: a repo-level PR template, a `yarn.lock` / `pnpm-lock.yaml` or no `package-lock.json`, a root `CLAUDE.md`, or a `.claude/CLAUDE.md` without the two imports. Checks tracked files only. Blocking |
| `scripts/pc-pr-template.mjs` | Prints the org PR template from `Plentiful-Commerce/.github`, for agents opening PRs with `gh pr create --body-file` |
| `scripts/pc-pr-body-check.mjs` | Fails a PR whose description doesn't follow the org template: every section filled in, a ClickUp link or N/A, a ticked Type of change. Reads the template live, so section changes in the org repo need no release here. Blocking |
| `templates/` | Every file `/setup-repo` copies into a new theme repo: build config, `package.json`, the three CI workflows, husky `pre-commit`, ignore files, `.claude/CLAUDE.md`. See [Repo templates](#repo-templates). |
| `CODING-STANDARDS.md` | The standards this package enforces (the canonical copy repos `@import` into `.claude/CLAUDE.md`) |
| `REPO-GUIDE.md` | How every theme repo is laid out and worked in: commands, build pipeline, git workflow. Imported next to the standards, so no repo holds its own copy |

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

### Suppressing a `pc-lint` rule inline

Some rules are right in general and wrong in one specific place — usually where an
app or vendor snippet forces our hand. Suppress those in the file, the same way
Theme Check does, so the exemption sits next to the code and carries its reason:

```liquid
{%- comment -%}
  MUST stay `include`: this snippet resolves a DYNAMIC snippet name, which only
  works under `include`. Switching to `render` silently drops the CSS.
{%- endcomment -%}
{%- # pc-lint-disable liquid-include -%}
{% include 'pagefly-app-header' %}
{%- # pc-lint-enable liquid-include -%}
```

- `pc-lint-disable <rule>` … `pc-lint-enable <rule>` suppresses a region.
- `pc-lint-disable-next-line <rule>` suppresses the next line only.
- Naming several rules (comma or space separated) scopes to those rules; naming
  **none** suppresses every rule — avoid that.
- The directive is matched as plain text, so use whatever comment syntax the file
  already uses (Liquid, HTML, JS or CSS).

Two deliberate properties: an **unclosed `disable` runs to end of file**, so always
pair it and keep the region tight; and a suppressed occurrence **does not mask a
later one** — each rule keeps scanning and reports the first violation still live.

Always write *why* next to the directive. A suppression without a reason is
indistinguishable from someone silencing a rule they did not want to fix.

### Tightening over time
Adoption is deliberately lenient on legacy. Once a repo's whole-repo `--warn` pass is clean, flip the gate to strict: run `pc-lint` (no `--warn`) whole-repo as blocking, and raise `theme check` to `--fail-level=error`. Stylelint's `px`/`!important` warnings can likewise be promoted to `error`.

## Repo templates

`templates/` is the single source for the files a PC theme repo starts with. The `/setup-repo`
command copies them from a local checkout of this repo; nothing else holds a copy. To change
what new repos get, change the file here.

| Path | Copied to | What it is |
|---|---|---|
| `configs/package.json` | `package.json` | Scripts, build dependencies, `packageManager` and `engines`. No lint tools: they come with this package |
| `configs/webpack.config.js`, `postcss.config.js`, `tailwind.config.js` | repo root | The Webpack Encore build |
| `configs/.nvmrc` | `.nvmrc` | Node 24, matching CI |
| `configs/eslint.config.mjs`, `.stylelintrc.json`, `.theme-check.yml`, `.editorconfig` | repo root | One-line files that point at the shared configs in this package |
| `configs/.gitignore`, `.shopifyignore` | repo root | Ignore lists; `package-lock.json` is tracked, other lockfiles are ignored |
| `configs/github-lint.yml` | `.github/workflows/lint.yml` | A short caller of the shared gate in `.github/workflows/lint.yml` here |
| `configs/github-compile-assets.yml` | `.github/workflows/compile-assets.yml` | A short caller of the shared asset build, which commits `assets/entry-*` on the default branch |
| `configs/github-monthly-audit.yml` | `.github/workflows/monthly-audit.yml` | Scheduled audit |
| `configs/github-pr-body.yml` | `.github/workflows/pr-body.yml` | A short caller of the shared `pc-pr-body-check` job, run on every PR and again when its description is edited |
| `configs/CODEOWNERS` | `.github/CODEOWNERS` | Review ownership |
| `configs/pre-commit` | `.husky/pre-commit` | One line: `npx --no-install pc-pre-commit` |
| `configs/preview-fix.mjs` | `scripts/preview-fix.mjs` | Repairs a branch-preview theme's CSS (themes with a settings-driven `.css.liquid` only) |
| `claude-project.md`, `settings.json` | `.claude/CLAUDE.md`, `.claude/settings.json` | The repo's own facts plus the two imports, and agent permissions. There is no root `CLAUDE.md` |

Two pieces apply only to themes with a settings-driven `.css.liquid` stylesheet (Turbo and other
vintage-era themes), and `/setup-repo` leaves them out for everything else:
`configs/preview-fix.mjs` and the line of `claude-project.md` marked `CONDITIONAL`.

There is no PR template here. Repos use the org-wide one in `Plentiful-Commerce/.github`; a
repo-level `pull_request_template.md` would replace it entirely.

Every repo uses npm: `npm ci` in CI against a committed `package-lock.json`.

## Adopting it in a repo

> **Node 24.** CI runs Node 24 LTS and the npm it ships (set in the shared workflows here).
> A repo sets the same in `.nvmrc` and `packageManager`, and regenerates `package-lock.json`
> with that npm. (`@babel/eslint-parser@8` needs at least `node ^22.18.0 || >=24.11.0`.)

**1. Install** (the package is a PUBLIC git dep — no auth). It brings the lint tools with it, so the repo lists only this package and husky:

```bash
npm i -D "github:Plentiful-Commerce/theme-standards#v0.2.0" husky
```
Commit the resulting `package-lock.json`. Every PC repo uses npm; do not add a `yarn.lock`, and do not add an `.npmrc` — the install resolves without `legacy-peer-deps`. Remove any lint tool the repo lists itself (`eslint`, `@babel/eslint-parser`, `eslint-config-prettier`, `prettier`, `@shopify/prettier-plugin-liquid`, `stylelint`, `stylelint-config-standard`, `lint-staged`, and the dead `babel-eslint` / `eslint-loader`): a second copy at another version wins over this package's pin. A repo with the Encore build keeps `eslint-webpack-plugin`, at `^6` (v3 supports only ESLint 7/8).

**2. Add the config files** to the repo root:

```js
// eslint.config.mjs
export { default } from '@plentiful/theme-standards/eslint';
```
A repo that needs its own ignores or overrides spreads the shared config instead: `export default [...standards, { ignores: ['src/vendor/**'] }]`. ESLint 10 reads only `eslint.config.*`: delete `.eslintrc.*` and `.eslintignore`, and remove `/* eslint-env */` comments (flat config does not support them; the shared config gives root `*.config.js` files Node globals).
```json
// .stylelintrc.json
{ "extends": "@plentiful/theme-standards/stylelint" }
```
Point Prettier at the shared config via `package.json`:
```json
"prettier": "@plentiful/theme-standards/prettier"
```
Copy `templates/configs/.editorconfig` → `.editorconfig`.

Copy `templates/configs/.theme-check.yml` → `.theme-check.yml`. It is a three-line file that extends `theme-check/index.yml` by filesystem path (`./node_modules/@plentiful/theme-standards/theme-check/index.yml`), because Theme Check does not resolve package-name `extends`. Two consequences: dependencies must be installed before Theme Check runs, locally and in CI (the shared workflow runs `npm ci` in the Theme Check job for this reason), and the ruleset updates with the package version. **If the repo already has a `.theme-check.yml`, overwrite it — don't leave the legacy one in place.** Most existing theme repos ship a hand-rolled `extends: :nothing` config with an explicit rule list; keeping it means the gate silently runs against a non-standard ruleset and you lose `theme-check:recommended` plus `ValidScopedCSSClass` (must-run per CODING-STANDARDS A7). Add any genuinely repo-specific bits (e.g. an `ignore:` list) below the `extends` line, under a clearly marked overrides heading, each with a written reason.

Expect the canonical config to surface **more** offenses than the legacy one. That's the point — they're pre-existing debt, they don't block (the whole-repo pass is warn-only and the gate is diff-scoped), and they belong on a debt ticket.

**3. Add the standardized scripts** (CODING-STANDARDS B7) to `package.json` — scripts run via the package bins (`npx`):

```jsonc
"scripts": {
  "lint": "eslint 'src/**/*.js'",
  "lint:css": "stylelint 'src/**/*.{css,scss}' --allow-empty-input",
  "lint:liquid": "shopify theme check",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  // local convenience check — pc-lint in --warn so legacy debt doesn't block.
  // CI does the real diff-scoped blocking (see Enforcement model above).
  "check": "npm run lint && pc-lint --warn"
}
```
`npm run check` is the quick local pass; the **CI gate** is what actually blocks (on the PR diff). Once the repo's whole-repo `--warn` pass is clean, drop `--warn` here to make it blocking too.

**4. Wire up hooks + CI:**
- Copy `templates/configs/pre-commit` → `.husky/pre-commit` (run `npx husky init` first on fresh repos). It is one line, `npx --no-install pc-pre-commit`. The repo needs no `lint-staged` block: the hook passes the shared `lint-staged/index.mjs` to lint-staged. Delete any `lint-staged` block left in `package.json`.
- Copy `templates/configs/github-lint.yml` → `.github/workflows/lint.yml`, `github-compile-assets.yml` → `.github/workflows/compile-assets.yml` and `github-pr-body.yml` → `.github/workflows/pr-body.yml`. Set `push.branches` to the repo's default branch in the first two. Change nothing else, unless the repo declares a lint input (see [Shared workflows](#shared-workflows)).
- `compile-assets` pushes with the repo's `COMPILE_ASSETS_DEPLOY_KEY`, an environment secret in a `compile-assets` environment limited to the default branch. The repo's branch ruleset lets that deploy key through. The caller passes it by name (the template does): a reusable workflow gets an empty string for any secret its caller doesn't pass, with no error, so the shared publish job checks it is set.

**5. Point the build agent at the standards** — copy `templates/claude-project.md` → `.claude/CLAUDE.md` and fill in the placeholders (Tier 2 import, CODING-STANDARDS Part C). It imports both shared files:

```markdown
@../node_modules/@plentiful/theme-standards/REPO-GUIDE.md
@../node_modules/@plentiful/theme-standards/CODING-STANDARDS.md
```

The paths start with `../` because an import resolves relative to the file that contains it, and that file is inside `.claude/`. `@./node_modules/...` points at `.claude/node_modules` and loads nothing. Do not add a root `CLAUDE.md`: anything generic belongs in `REPO-GUIDE.md` here, and anything specific to the repo goes under "Notes for this repo only".

## Tool versions

This package owns the lint toolchain. Its `dependencies` pin exact versions (no `^`) of ESLint, `@eslint/js`, `@babel/eslint-parser` with `@babel/core`, `globals`, `eslint-config-prettier`, Prettier with `@shopify/prettier-plugin-liquid`, Stylelint with `stylelint-config-standard`, and lint-staged. npm hoists them to the repo's `node_modules`, so `eslint`, `stylelint`, `prettier` and `lint-staged` are on the repo's path and `eslint-webpack-plugin` finds `eslint`. A release decides the toolchain for every repo; to upgrade a tool, change its pin here and release.

`@babel/core` 8 sits next to the parser inside this package's own `node_modules`, so it does not clash with the Babel 7 that Webpack Encore installs at the top level.

Version changes that move findings (v0.2.0, from ESLint 8 / Stylelint 16):
- ESLint 10's recommended set adds `no-unused-private-class-members`, `no-empty-static-block` and others, and `no-constant-condition` no longer reports `while (true)`. `no-unused-vars` keeps ESLint 8's `caughtErrors: 'none'`.
- `stylelint-config-standard` 40 adds rules over 36. A repo that moves from 36 gets new CSS findings.

## Shared workflows

Every repo runs three workflows from here, each called at `main` by a short caller in the repo:

| Here | Caller in the repo | What it does |
|---|---|---|
| `.github/workflows/lint.yml` | `lint.yml` | The lint gate, below |
| `.github/workflows/compile-assets.yml` | `compile-assets.yml` | On a push to the default branch, builds `assets/entry-*` and commits them with the repo's deploy key |
| `.github/workflows/pr-body.yml` | `pr-body.yml` | Fails a PR whose description doesn't follow the org template, using the repo's pinned version of `pc-pr-body-check` |

The action versions and the Node version (24) are set only here, so bumping them is one PR in this repo. `main` here is protected: a change needs a PR and Jocelyn's approval, because `compile-assets` runs with every client repo's deploy key.

### Lint

A repo's `lint.yml` only sets the triggers and calls the gate at `main`:

```yaml
jobs:
  lint:
    uses: Plentiful-Commerce/theme-standards/.github/workflows/lint.yml@main
```

So a change to the steps reaches every repo on its next PR, with no release and no bump PR. The lint tools those steps run still come from the repo's pinned package version; the Shopify CLI that runs Theme Check is pinned in the workflow itself.

**Inputs.** Both default to `true`. Set one to `false` in a repo only while that debt has a ticket.

| Input | What it turns off |
|---|---|
| `stylelint` | `npm run lint:css` |
| `prettier` | `prettier --check` on the files a PR changes |

**Status check names** are `lint / Format + ESLint + Stylelint + pc-lint` and `lint / Shopify Theme Check` (the caller's job id, then the job name here). Rulesets require them by name, so do not rename the jobs or the caller's `lint` job, and never make a job name depend on an input.

**Changing a shared workflow.** A bad change breaks CI in every repo at once. Before merging a change to `main`, test it from one repo's PR: point that repo's caller at your branch (`…/lint.yml@<branch>`), push, check the jobs, then put it back to `@main`. `compile-assets` only runs on a push to the default branch, so a PR can't exercise its publish job: check the first run after merging, in one repo, before the next push elsewhere.

## Releasing

Client repos pin a release tag (`github:Plentiful-Commerce/theme-standards#v0.2.0`), and the tag must match `version` in `package.json`.

1. In the PR that changes the package, bump `version` in `package.json`.
2. Once it merges, check out `main`, pull, and run `npm run release`. It tags `v<version>` and pushes the tag. It refuses on a dirty tree, a `main` that differs from `origin/main`, or a tag that already exists.

3. Bump the client repos with `ops/tools-and-software/theme-standards/bump.sh <tag>` in `internal-claude`. It opens one PR per repo (as PC Builder), regenerates each lockfile, and skips repos already on the tag. A release that changes config file shapes, as v0.2.0 did, needs hand-made PRs instead.

Release tags are protected by a tag ruleset (`v*`): they cannot be deleted or moved, so a released version always points at the same code. A wrong tag cannot be fixed, only superseded by the next version. The `Release check` workflow fails when a pushed tag doesn't match `package.json`, which catches a tag made by hand.

## Notes

- A **SASS-only repo** (not Encore) needs the `lint`/`lint:css` globs adjusted to its layout.
- Stylelint `font-size: px` and `!important` are **warnings**, not errors, so legacy CSS doesn't block the first adoption PR. Tighten to `error` once a repo is clean.
