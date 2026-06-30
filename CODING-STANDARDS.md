# Plentiful Commerce — Coding Standards

The single source of truth for code quality across all PC client repos. Written so a coding **agent can follow it while building and verify its own output against it** — and so the same rules are enforced automatically by Prettier, ESLint, Stylelint, and Shopify Theme Check in CI.

> **Status:** v1 (2026-06-26). Compiled from the shopify-audit-tool rule engine, the existing repo configs, Notion (Developer guidelines / Coding standards for full site builds / Engineering Wiki), and the PC second brain. Most repos do **not** yet enforce these — see [Part D: Rollout Plan](#part-d--rollout-plan).

---

## How enforcement works — three layers

| Layer | What it covers | Tool | When it runs |
|---|---|---|---|
| **1. Formatting** | Whitespace, quotes, indent — non-debatable style | Prettier (+ `@shopify/prettier-plugin-liquid`) | on save / pre-commit / CI |
| **2. Linting** | Mechanical correctness rules a parser can prove | ESLint, Stylelint, `shopify theme check` | pre-commit (staged) + CI gate |
| **3. Agent-verified standards** | Judgment rules a parser can't prove — architecture, reuse, performance intent, a11y semantics | This doc + `.claude/CLAUDE.md`; the agent self-checks before opening a PR; human code review (QA2) confirms | during build + PR review |

The goal: **anything a machine can check should be a Layer 1/2 rule so humans never review it.** Layer 3 is where the real engineering judgment lives — those are the rules an agent must internalize.

---

## Part A — Agent-verifiable standards (Layer 3)

These are the rules that make PC work "ours." An agent must build to them and **self-review against each one before opening a PR.** Each rule states the standard, why it exists, and how to verify.

### A1. Solution hierarchy — code is the last resort
Evaluate every task in this order and stop at the first that works:
1. **Shopify backend / native setting only** (no code), or an existing **App Store app**.
2. **Metafields / metaobjects** connected to the theme.
3. **Theme code.**
4. **Custom app.**
- **Why:** simplest solution = least to maintain, fewest regressions, most client-editable.
- **Verify:** before writing Liquid/JS, the agent states which tier was chosen and why lower tiers don't suffice.

### A2. Reuse before you build — adapt to the theme's patterns
- Use the theme's **existing components** first. Look at how a similar component is built; prefer adding a setting to it or copying its pattern over writing net-new.
- Match the theme's existing **coding style, global variables, CSS classes, and conventions**. No copy-pasted code from other themes that "all mixed together."
- Do **not** import a foreign component when the theme already has an equivalent (e.g. don't bring in another theme's responsive-image or button-component pattern — use the theme's, or a plain `<button>` if the theme doesn't use that pattern).
- **Why:** consistency, maintainability, client handoff.
- **Verify:** every new class/variable/component either already existed or follows the file's surrounding idiom. Grep for an existing equivalent before adding one.

### A3. Make it client-editable — always add theme settings
- Any **major custom code** must expose **theme settings** so the client can edit content/visuals after launch.
- New sections must include a **`presets`** block (so the section has example content when added) and **default values for every setting**.
- Provide **placeholder images** via `placeholder_svg_tag` when no image is set.
- Build for variable content length — "the theme can be adapted for more or less text than the design."
- **Why:** clients should edit as much as possible without us. Empty sections look broken in the editor.
- **Verify:** new section has presets + every `setting` has a `default`; image blocks have an `{% if … size > 0 %} … {% else %}placeholder{% endif %}` fallback.

### A4. Document metafields & metaobjects
- If a feature uses metafields/metaobjects, **always** document (in the PR and/or theme docs): how to set it up in the **admin** and **where it connects** in the theme.
- **Why:** QA and client handoff are impossible otherwise.
- **Verify:** PR contains the setup doc.

### A5. Full-build CSS architecture (when building a site from scratch)
- **Code the core design patterns first** — set font-family/size/letter-spacing/line-height on the core `h1/h2/h3` classes and default link/button styling **before** building sections. Change the original class (e.g. the button class) directly; don't re-style the button in every component.
- **CSS variables early** — define font and common spacing variables in `custom.css` as soon as possible (sites are usually symmetrical; reuse them).
- **Scope repeatable sections** — if a section can appear more than once on a page, prefix its CSS with `#shopify-section-{{ section.id }}` to prevent overrides.
- **One-off differences** — if only one property differs and a variable exists, make a small dedicated class (e.g. `.p-tag-16 { font-size: var(--p-tag-16); }`), not an inline override. Bundle related one-offs into one class.
- **Section naming:** name sections **generically by feature**, not by the Figma label — `image gallery with text`, not `meet our new artists`.
- **Figma gotcha:** `letter-spacing` in `%` is not valid CSS — convert to px.

### A6. Liquid best practices (machine-checkable subset is in Part B)
- Use `{% render %}` — never legacy `{% include %}`.
- `{{ content_for_header }}` must be present in `theme.liquid` (apps inject through it).
- No `document.write` (render-blocking).
- Nested snippets ≤ 3 deep; templates ≤ 600 lines (excluding schema/style/JS).

### A7. Performance — don't make it worse, ever
Even when speed isn't in scope:
- **LCP/hero:** the first/hero image uses `src` + `fetchpriority="high"` + `loading="eager"`. Never lazyload (`data-src`/lazysizes) the LCP image.
- **Render-blocking CSS:** non-critical CSS (carousel/swiper/mini-cart/drawer) loads async via `media="print" onload="this.media='all'"` with a `<noscript>` fallback — not synchronously.
- **Single tracking path:** never ship inline `gtag/js` *and* GTM. Pick one. Dual tracking double-counts conversions and inflates ad spend.
- **No duplicate scripts** in `theme.liquid` (same `asset_url` twice).
- **CSS subsetting (effective 2026-04-20):** put section CSS in `{% stylesheet %}`, not `stylesheet_tag` — only `{% stylesheet %}` is subsetted/deduped. Avoid monolithic `custom.css` (>500 lines is a smell).
- **browserslist** must exclude IE: `["> 0.5%", "last 2 versions", "not dead", "not ie <= 11"]`.
- **Targets:** LCP < 2.5s, CLS < 0.1, TBT < 200ms, FCP < 1.8s, mobile Lighthouse perf ≥ 70.

### A8. Accessibility & SEO (semantics)
- **Font sizes in `rem`/`em`/`%`, never `px`.**
- Exactly **one `<h1>`**, then `<h2>`/`<h3>` in order. Headings are heading tags, subheadings are `<p>` — **not `<div>`s**.
- **Semantic HTML** with `<main>` and `<nav>` landmarks — not "a bunch of divs."
- **Alt text on all images**, `aria-label`s where needed, menus/interactive elements keyboard-tabbable.
- **Structured data:** Product schema complete (`name, description, image, brand, offers, price, availability, reviewAggregate, sku`); Organization schema (`name, url, logo, description, sameAs`).
- **SEO meta:** `<title>` 50–60 chars, meta description 140–160 chars, canonical + viewport + `og:image` present.
- **AI discoverability:** don't `Disallow` AI bots (GPTBot, ClaudeBot, PerplexityBot, Googlebot-Extended) in robots.txt; ship `/llms.txt`.
- Full WCAG 2.0–2.2 expectations: see `shopify-audit-tool/src/data/wcag-manual-checklist.js` (49 criteria).

### A9. Safety rules — non-negotiable (each traces to a real incident)
- **Never commit or expose API keys/secrets.** Never make a custom-app repo public. *(Contractor exposed keys via a public repo.)*
- **Never test on a live site** when the change can have side effects. Test in the **PC production store (`813fbc-3f`)** or the client's **staging theme** first. *(Live cookie-banner test disabled tracking across regions; a product made live without staging fired back-in-stock emails + refunds.)*
- **Copy the live theme before editing it.** Shopify has no version history for pages/admin changes — back up HTML, communicate admin-side changes explicitly.
- **Notification emails:** inline CSS only (classes don't work); send a real test email (Shopify preview is inaccurate).
- **Never assume Dawn.** All PC client themes are custom — discover sections by scanning, don't hardcode Dawn filenames.

### A10. Git / PR workflow
- One repo per client in the **Plentiful-Commerce** org, **private**, default branch **`main`**, connected to Shopify via GitHub sync (repo is source of truth — read live state from `origin/main`).
- **Branch naming:** `CU-{taskId}_{Task-Name}_{Assignee-Name}` (per PC convention — this supersedes the older `firstname/feature` template in the Engineering Wiki).
- **PRs:** use the org PR template. Description extends the commit messages — *what* changed and *how* it was implemented. Include a preview link + explicit test steps.
- **Two-tier QA gate before merge:** QA1 (PM — visual + functional) → QA2 (Jocelyn/Ile/Jordan — code review for side effects, code quality, regressions). Merge only after both pass.

---

## Part B — Machine-enforced rules (Layers 1 & 2)

The standardized config every theme repo should carry. These encode the parser-checkable subset of Part A so they're auto-fixed or fail CI — no human review needed.

### B1. Prettier (formatting — auto-fix)
`.prettierrc` (shared):
```json
{
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "trailingComma": "es5",
  "plugins": ["@shopify/prettier-plugin-liquid"]
}
```
- Add `@shopify/prettier-plugin-liquid` so `.liquid` files format too.
- `.editorconfig` for cross-editor consistency (utf-8, lf, 2-space, trim trailing whitespace, final newline).

### B2. ESLint (JS correctness — CI gate)
Standardize the existing baseline and **fix the drift**:
- Migrate `babel-eslint@^8` → `@babel/eslint-parser` (the old package is deprecated/abandoned).
- Keep: `no-var: error`, `no-unused-vars: error`, `no-irregular-whitespace: error`, `prefer-const`, `eqeqeq`.
- **Remove the `casalina` override** that sets `no-unused-vars: off` — it's the only repo that loosened it.
- Add `eslint-config-prettier` so ESLint and Prettier don't fight; wire up the dead prettier deps in the React repos with an actual config.

### B3. Stylelint (CSS — new)
`stylelint-config-standard` plus PC custom rules that encode Part A:
- `unit-disallowed-list: ["px"]` for `font-size` (warn) — enforces A8 rem/em rule.
- Flag `!important` overuse.
- Optional custom rule / CI grep: warn when `custom.css` exceeds 500 lines (A7 monolith smell).

### B4. Shopify Theme Check (Liquid — CI gate)
The repos already share a good `.theme-check.yml` but **nothing runs it.** Keep the existing rules and:
- Enable `ValidScopedCSSClass` (the audit tool flags this as a must-run for CSS subsetting).
- Add a `theme-check` npm script and run it in CI.
- Custom checks / CI greps to cover audit-tool rules Theme Check doesn't have natively: no `{% include %}`, no `document.write`, no `stylesheet_tag` inside sections, no dual gtag+GTM, no IE in browserslist, hero image not lazyloaded.

### B5. Git hooks (husky + lint-staged — standardize)
Only 4 of 7 themes have husky, and it only un-stages bundles. Standardize a real pre-commit:
```jsonc
// lint-staged
{
  "*.{js,json,css,liquid}": "prettier --write",
  "*.js": "eslint --fix",
  "*.css": "stylelint --fix",
  "*.liquid": "shopify theme check"
}
```
Keep the existing "un-stage compiled `assets/entry-*`" step.

### B6. CI gate (`.github/workflows/lint.yml` — new)
Today CI only compiles+commits assets. Add a PR-blocking job that runs: `prettier --check`, `eslint`, `stylelint`, `shopify theme check`. Pin Node to an **even LTS** (currently 20/22, not the `21.5.0` in use) and bump `actions/checkout`/`setup-node` off the EOL `@v2`.

### B7. Standardized npm scripts (every repo)
```jsonc
{
  "lint": "eslint 'src/**/*.js'",
  "lint:css": "stylelint '**/*.css'",
  "lint:liquid": "shopify theme check",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "check": "npm run format:check && npm run lint && npm run lint:css && npm run lint:liquid"
}
```
`npm run check` becomes the one command the agent and CI both run.

---

## Part C — Repo-by-repo gaps (as of 2026-06-26)

**In scope (6 repos):** bea-colette, le-fil, casalina, mr-riegillio, farmer-bailey, garden-club-plants. All other repos (bea-colette-gift-note, wood-finishers-depot, the 3-porch themes, the React/cardsmith repos, shipstation) are **out of scope** for this rollout.

| Repo | Has husky? | Gap to close |
|---|---|---|
| **bea-colette** | yes | Add Prettier/Stylelint/EditorConfig; wire `theme-check` + lint into scripts & CI. |
| **le-fil** | yes | Same as bea-colette — closest to baseline. |
| **casalina** | yes | Remove the `no-unused-vars: off` override; align `swiper` (on 11, others on 8); plus add Prettier/Stylelint/EditorConfig + scripts & CI. |
| **mr-riegillio** | **no** | Add husky pre-commit; plus full baseline (Prettier/Stylelint/EditorConfig + scripts & CI). |
| **farmer-bailey** | **no** | Add husky pre-commit; plus full baseline. |
| **garden-club-plants** | **no** | No ESLint, no Theme Check, no husky — adopt full baseline. (SASS-only, not Encore — adapt scripts accordingly.) |
| **All 6** | — | Migrate `babel-eslint`→`@babel/eslint-parser`; bump husky 7→9 where present; Node→even LTS; `checkout/setup-node` `@v2`→`@v4`. (garden-club-plants has no babel-eslint/husky to migrate.) |

---

## Part D — Rollout Plan

**Phase 0 — Ratify (this doc).** Review/edit, then commit as the canonical reference. Drop a pointer in each repo's `.claude/CLAUDE.md` so the agent loads it.

**Phase 1 — Build the shared config package.** Create `@plentiful/theme-standards` (or a `pc-theme-config` template repo) holding the canonical `.prettierrc`, `.eslintrc`, `.stylelintrc`, `.theme-check.yml`, `.editorconfig`, husky/lint-staged, and `lint.yml` CI. One source to copy/extend, so configs stop drifting repo-to-repo.

**Phase 2 — Pilot on one active repo** (suggest **casalina** or **le-fil** — both active, both have husky). Wire in the full toolchain, run `npm run check`, fix the surfaced violations in a dedicated PR, confirm CI gates work. This calibrates how noisy the rules are before fanning out.

**Phase 3 — Roll out to the rest of the in-scope set** (the other 5 of the 6 Part C repos) one PR each (a workflow/loop can fan this out). Each PR: add config + scripts + CI + hooks, run `format`, fix lint failures, green CI.

**Phase 4 — Encode Layer 3 into the agent.** Add the Part A rules to `.claude/CLAUDE.md` (or a referenced standards file) in each repo so the build agent self-checks before every PR, and the code-review step (QA2) verifies against the same list. Convert the audit-tool's `check()` rules that Theme Check can't express into a small custom theme-check plugin or a `scripts/pc-lint.mjs` the CI runs.

**Phase 5 — Close the loop with the audit tool.** The monthly audit already scores these dimensions. Treat a regression in the audit (e.g. LCP slips, dual tracking reappears) as a signal that a Layer 2 rule is missing — promote recurring audit findings into lint rules.

### Recommended immediate next steps
1. **Review this doc** and correct anything (esp. branch-naming and the `master`/`main` reconciliation already handled here).
2. **Approve Phase 1** — I can scaffold the shared config package + the six canonical config files.
3. **Pick the pilot repo** and I'll wire it end-to-end in one PR so you can see the violation surface before committing to a fleet-wide rollout.

---

## Part E — Agent & CI architecture

How a **code-implementation agent** (running in GitHub Actions or a VPS, headless) relates to these standards. Principle: **layered, not either/or.** The agent carries the universal rules, each repo carries its own deltas, and CI is the hard gate that doesn't trust the agent at all.

### Three tiers, deduplicated by import

| Tier | Lives where | Contains | Why there |
|---|---|---|---|
| **1. Agent operating rules** | Agent system prompt (travels with the agent) | *How it works*: solution-hierarchy gate (A1), safety rules (A9), the pre-PR self-review checklist | Workflow/judgment, stable across every repo — not codebase facts |
| **2. Org coding standards** | One versioned source (`@plentiful/theme-standards` / this doc), **imported** into every repo | Part A + B — universal PC rules (a11y, perf, Liquid, section authoring) | Single source of truth; update once, every repo + every cloud run picks it up |
| **3. Repo-specific standards** | Each repo's `.claude/CLAUDE.md` | The *deltas* only: this theme's CSS variables, component patterns, store handle, business logic, naming | A2 (reuse the theme's patterns) is repo-specific — the agent can't know it globally; themes diverge |

**Mechanism — import, don't copy.** Each repo's `.claude/CLAUDE.md`:
```markdown
@./node_modules/@plentiful/theme-standards/CODING-STANDARDS.md
# Repo-specific notes below (Tier 3)…
```
The merged result the agent reads is **assembled from the checked-out repo** — never from a laptop's `~/.claude` or local memory.

**Why both, not one:**
- *Agent-carries-everything, ignores repo* → fails: A2 reuse requires reading **this** theme's variables/components, which only exist in the checkout.
- *Only repo CLAUDE.md, agent carries nothing* → fails: duplicates the universal rules across 14 repos and they drift (exactly today's copy-pasted-ESLint problem).

### Cloud execution — consequences

1. **The agent only sees the checkout.** A fresh cloud clone has none of your local config or memory. Whatever you want enforced **must be in the repo** (or pulled by it via the package). This is the decisive reason standards are repo-anchored.
2. **CI is the hard gate — don't trust the agent for Layers 1/2.** Run `npm run check` (`prettier --check && eslint && stylelint && shopify theme check`) as a **PR-blocking** job regardless of what the agent did. Agent self-check is best-effort; CI is the deterministic backstop. The agent proposes, CI disposes.
3. **Headless = no interactive prompts.** Pre-configure a permission allowlist in `settings.json`; provide auth via **secrets/env**, not interactive login. Interactively-authenticated MCP servers (Notion OAuth, claude.ai) **won't be available** headless — anything the agent needs (Shopify CLI auth, Anthropic key) must be token-based from Actions secrets / VPS env.
4. **Secrets become mechanical, not aspirational.** A9 ("never expose keys") stops being a rule the agent must remember and becomes how the runner is built: keys in Actions secrets / VPS env, never in the repo.
5. **Pin everything for reproducibility.** Cloud must match local: pin Node (even LTS), pin tool versions via the config package, install + auth Shopify CLI in the runner (needed for `theme check`). Today's version skew (babel-eslint, swiper 8 vs 11, husky 7) bites harder in non-interactive runs.

### GitHub Actions vs VPS
Start on **GitHub Actions** — already proven via `claude-code-action` in the audit tool, per-PR, ephemeral, secrets built in, zero infra. Move a specific workload to a **VPS** only when you need long-running/persistent sessions, persistent auth, or work that outlives a single PR (e.g. a multi-repo sweep). Don't stand up a VPS preemptively.

### Net
- Agent = Tier 1 (operating + safety) in its system prompt.
- Tier 2 = `@plentiful/theme-standards`, **imported** into every repo's CLAUDE.md.
- Tier 3 = each repo's own CLAUDE.md delta.
- **CI runs the deterministic checks as the real gate** — never rely on the agent for what a linter can prove.

> Phase 1 of the rollout (build the shared config + standards package) is also what makes a cloud agent viable — it's the same work.
