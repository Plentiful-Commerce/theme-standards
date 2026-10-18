# Enforcement

How the PC code-quality gate is enforced. For *how the checks work in detail*, see the README ("For developers" + "Enforcement model"). This file is **what runs when, and what blocks**.

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
1. **Adopted repos only** — the gate runs only where the package is installed.
2. **Branch protection makes CI a true merge-blocker** — a red check does *not* prevent merge on its own. Each repo needs a branch-protection rule on `main` requiring the **Lint** and **Shopify Theme Check** status checks. Until then the gate is informational at merge time.

## Running the gate in an implementation agent (VPS / CI / local)

The same gate runs in **any headless environment** — it's just Node + the Shopify CLI, with **no browser and no Shopify auth** (Theme Check is static analysis; only `theme dev`/`push` need a login). GitHub Actions already proves this end-to-end.

**A VPS implementation agent needs:** Node 24 · git · network to `npm/yarn install` the (public) package · the **Shopify CLI preinstalled** (`npm i -g @shopify/cli`, or the lighter `@shopify/theme-check-node`) so it isn't re-downloaded per run.

**One-command self-check (`pc-gate`, planned):** so an agent can verify its own diff exactly like CI — compute changed files vs a base ref, then run ESLint + `pc-lint --files` + Theme Check introduced + design-tokens, exiting non-zero on anything blocking. Until it exists, the agent runs the CI steps in sequence.
