# Rollout Roadmap & Enforcement

The live plan for the PC code-quality gate. For *how the checks work in detail*, see the README ("For developers" + "Enforcement model"). This file is the **status + what blocks + what's left**.

## When checks run & when they block

| Moment | Checks | Blocks? |
|---|---|---|
| **`git commit`** (local pre-commit hook) | Prettier/ESLint/Stylelint auto-fix staged files | no (auto-fix) |
| | Theme Check on staged `.liquid` | **blocks the commit** on offenses you *introduced*; needs Shopify CLI; bypass with `--no-verify` |
| **PR open/update** (CI) | ESLint, `pc-lint`, Theme Check | **go red** on what the PR *introduces* (not legacy) |
| | design-tokens | advisory (never blocks) |

**Blocks (must fix):** ESLint errors · `pc-lint` error rules (`liquid-include`, `stylesheet-tag-in-section`, `document-write`, `dual-tracking`, `duplicate-script`, `browserslist-ie`, `tracking-before-charset`, `missing-content-for-header`, `hero-lazyloaded`) · Theme Check introduced offenses (warning+).

**Warns (advisory):** `pc-lint` warning rules (`dynamic-style-block`, `inline-js-too-large`, `monolithic-css`, `sale-css-dated`) · design-token duplicates · all whole-repo legacy debt.

### Two things that gate "actually blocked"
1. **Adopted repos only** — the gate runs only where the package is installed (see status below).
2. **Branch protection makes CI a true merge-blocker** — a red check does *not* prevent merge on its own. Each repo needs a branch-protection rule on `main` requiring the **Lint** and **Shopify Theme Check** status checks. Until then the gate is informational at merge time.

## Status

### ✅ Done
- `@plentiful/theme-standards` — **public repo**, `v0.1.1`. Shared rule module (`rules/liquid-checks.mjs`), `pc-lint`, `theme-check-changed`, `pc-design-tokens`, configs, CI template, husky hook.
- **le-fil** fully adopted (PR #67 merged) — consumes the package, CI green, `.claude/CLAUDE.md` pointer (PR #69).
- **shopify-audit-tool** reads the same shared rule module — gate and audit can't drift.
- Docs: README "For developers", `CODING-STANDARDS.md`, this file.
- le-fil tracked debt logged (ClickUp backlog ticket).

### ▶ Remaining (in order)
| Step | Owner | Notes |
|---|---|---|
| **Branch protection on le-fil `main`** requiring Lint + Theme Check | you | makes the gate a real merge-blocker (currently none) |
| **Phase 3 — adopt in the other 5 repos** | me → you review/merge | casalina, farmer-bailey, mr-riegillio, bea-colette, garden-club-plants. One PR each: install package, `extends` configs, npx bin scripts, CI, hook, `.claude/CLAUDE.md`. Adjust per-repo (yarn/npm, `src/` layout). + branch protection each. garden-club needs extra setup (SASS-only). |
| **Phase 4 — agent Tier-2 self-check** | me | `.claude/CLAUDE.md` pattern (done for le-fil); optionally wire the cloud/CI agent to run `npm run check` |
| **Phase 5 — rendered checks (Tier 2)** | me | turn the audit tool into a PR check against a deploy preview (axe contrast, Lighthouse LCP) — catches what a static gate can't |
| **Phase 6 — tighten & maintain** | me | once a repo's warn pass is clean, promote design-token colors + Theme Check (`--fail-level=error`) + Stylelint to blocking. Rule change = edit here → tag version → bump the dep in each repo (manual, no automation for 6 repos). |

### Decisions only you make
Create org repos/settings · set branch protection · merge each PR.
