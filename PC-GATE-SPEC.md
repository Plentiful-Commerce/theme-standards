# `pc-gate` + Rendered Verification — Spec

**Status:** draft v0 (2026-07-02)
**Purpose:** Give an autonomous implementation agent a single command it runs *in its own loop, before pushing*, that tells it — deterministically — whether its work is good enough to open a PR. This is the linchpin of autonomy. CI blocking a PR is a gate for humans; `pc-gate` is the gate the agent uses to self-correct with no human in the loop.

Related: `CODING-STANDARDS.md` (the rules), `ROADMAP.md` (sequencing), `ORCHESTRATION.md` (how the agent gets invoked).

---

## The problem this solves

Layers 1–2 (`pc-lint`, Theme Check, ESLint, Prettier) prove the code is *well-formed*. They cannot prove it *works*: that the page renders, the section appears, the cart still functions, the hero still paints. For a Shopify theme that gap is the whole ballgame — it's why the global CLAUDE.md says Shopify features "require manual testing."

`pc-gate` closes as much of that gap as a machine can, and returns a structured verdict the agent can act on.

---

## Command surface

Add a fourth bin to `@plentiful/theme-standards`:

```json
"bin": {
  "pc-lint": "./scripts/pc-lint.mjs",
  "theme-check-changed": "./scripts/theme-check-changed.mjs",
  "pc-design-tokens": "./scripts/pc-design-tokens.mjs",
  "pc-gate": "./scripts/pc-gate.mjs"
}
```

`pc-gate` is an **orchestrator**, not new rules. It runs the existing checks in order, adds the rendered layer, and emits one machine-readable verdict.

```
pc-gate                     # full gate against the current diff vs origin/<base>
pc-gate --base main         # override base branch (default: repo default branch)
pc-gate --no-render         # skip the rendered layer (lint/static only — fast, for tight inner loops)
pc-gate --json              # emit machine-readable verdict to stdout (default when non-TTY)
pc-gate --templates a,b     # override which templates get rendered (default: inferred from diff)
```

### Exit codes
- `0` — all blocking stages passed. Safe to open PR.
- `1` — a blocking stage failed. Agent must fix and re-run. **Do not push.**
- `2` — infra error (couldn't push preview theme, Chrome didn't start, network). Distinct from `1` so the orchestrator can retry/back off instead of asking the agent to "fix" a non-code failure.

---

## Stages (run in order, fail-fast on blocking)

| # | Stage | Tooling | Scope | Blocking? |
|---|-------|---------|-------|-----------|
| 1 | Format | `prettier --check` | changed files | yes |
| 2 | JS lint | `eslint` | changed files | yes |
| 3 | CSS lint | `stylelint` | changed files | yes |
| 4 | Liquid deterministic | `pc-lint --files <diff>` | changed files | yes |
| 5 | Theme Check | `theme-check-changed` | added lines | yes |
| 6 | Design tokens | `pc-design-tokens` | changed files | **warn only** |
| 7 | **Preview push** | `shopify theme push --unpublished --json` | whole theme | yes (infra→exit 2) |
| 8 | **Render load** | headless Chrome | affected templates | yes |
| 9 | **Lighthouse** | Lighthouse CI | affected templates | warn→block (see below) |
| 10 | **In-loop review** | reviewer agent vs A1–A10 | the diff | yes (see ORCHESTRATION) |

Stages 1–6 already exist — `pc-gate` just sequences them. Stages 7–10 are new. Stage 10 is documented here but *driven* by the orchestrator (it's an agent call, not a subprocess); `pc-gate --no-render` and CI run stages 1–9 only.

---

## The rendered layer (stages 7–9) — detail

This is the part worth building carefully. Everything keys off **"affected templates"**: the set of storefront routes a diff can plausibly change.

### Inferring affected templates from a diff
- `sections/*.liquid` changed → every template JSON that references that section (grep `templates/**/*.json` + `templates/**/*.liquid` for the section name).
- `templates/<x>.json` or `templates/<x>.liquid` changed → that route.
- `snippets/*.liquid` changed → templates whose sections render that snippet (one hop; cap at the section level, don't chase infinitely).
- `layout/theme.liquid`, global CSS/JS, or `config/*` changed → the **canonical route set** (see below), because the blast radius is the whole store.
- Nothing storefront-facing changed (only `.github/`, docs, `.claude/`) → skip stages 7–9 entirely, log why.

**Canonical route set** (the always-check baseline when blast radius is global), resolved per-store in orchestration config:
`/` (home) · a representative PDP · a representative collection (PLP) · cart · search · a standard page · 404.

### Stage 7 — Preview push
```
shopify theme push --unpublished --json --path .
```
- Auth via `SHOPIFY_CLI_THEME_TOKEN` (Theme Access app token) + `SHOPIFY_FLAG_STORE` — **never** interactive login. See ORCHESTRATION §Secrets.
- Parse the JSON for the `preview_url` and theme id. Store both in the verdict.
- Push failure = **exit 2** (infra), not exit 1. The agent didn't write bad code; the environment failed.
- Tag the pushed theme name with the task id (`pc-agent/CU-<taskId>`) so orphaned preview themes are easy to reap. Orchestration cleans these up on completion.

### Stage 8 — Render load
For each affected template, against `preview_url` + the route:
- Load headless (reuse the Chrome MCP tooling already wired in this environment).
- **Block on:** any uncaught JS error in console · any failed network request for a first-party asset (theme JS/CSS returning 4xx/5xx — this is exactly the `entry-*.css` 404 class of bug) · HTTP non-200 for the document · page emits zero rendered content (blank body).
- **Capture (non-blocking, attached to verdict):** full-page screenshot desktop + mobile viewport. These become PR evidence.
- Ignore third-party/app console noise via an allowlist (analytics, chat widgets) so the gate isn't flaky. Maintain the allowlist in package config, not per-repo.

### Stage 9 — Lighthouse
- Run Lighthouse (mobile emulation) on each affected template against the A7 targets: **LCP < 2.5s, CLS < 0.1, TBT < 200ms, FCP < 1.8s, mobile Lighthouse ≥ 70.**
- **Regression-based blocking, not absolute.** Absolute thresholds go red on legacy themes day one — same mistake diff-scoping already avoids elsewhere. Compare the preview against a baseline render of the **base branch** for the same route:
  - Score drop > 5 points, or any Core Web Vital crossing its A7 threshold *that was passing on base* → **block**.
  - Below target but no worse than base → **warn** (pre-existing debt, don't punish this PR).
- Cache the base-branch baseline per (repo, route, base-sha) so you don't re-render base every run.

---

## Verdict shape (`--json`)

The agent and the orchestrator both consume this. One object, stable schema:

```json
{
  "verdict": "pass | fail | infra_error",
  "base": "main",
  "head_sha": "abc123",
  "preview_url": "https://…?preview_theme_id=123",
  "affected_templates": ["index", "product", "collection"],
  "stages": [
    { "id": "prettier",      "status": "pass",  "blocking": true,  "detail": null },
    { "id": "pc-lint",       "status": "fail",  "blocking": true,
      "findings": [ { "rule": "no-stylesheet-tag-in-section", "file": "sections/hero.liquid", "line": 42, "message": "…" } ] },
    { "id": "render:product","status": "fail",  "blocking": true,
      "findings": [ { "type": "console_error", "route": "/products/x", "message": "Uncaught TypeError…" } ] },
    { "id": "lighthouse:product","status": "warn", "blocking": false,
      "findings": [ { "metric": "LCP", "base": 2.1, "head": 2.4, "threshold": 2.5 } ] }
  ],
  "screenshots": [ { "route": "/products/x", "viewport": "mobile", "path": ".pc-gate/product-mobile.png" } ],
  "next_action": "fix_findings | open_pr | retry_infra"
}
```

`next_action` is the agent's instruction. The whole point: the agent reads `stages[].findings`, fixes, re-runs `pc-gate`, and only when `verdict: pass` does it hand off to PR creation.

---

## The agent's inner loop (pseudocode)

```
for attempt in 1..MAX_ATTEMPTS:      # MAX_ATTEMPTS ~ 4, then escalate to human
    make_changes()
    v = run("pc-gate --json")
    if v.verdict == "pass":      break
    if v.verdict == "infra_error":  backoff(); continue   # exit 2 — don't "fix", retry
    feed v.stages[].findings back to the builder agent as the next prompt
else:
    escalate_to_human(v)         # stuck — post findings to ClickUp, stop
```

`--no-render` for the fast inner iterations (stages 1–6, seconds), then one full `pc-gate` with render before declaring done. Keeps the loop cheap.

---

## What stays out of `pc-gate`

- **Anything requiring Shopify admin state** (theme editor settings, checkout, app blocks, real customer data). The gate can't see these; they stay on the human QA1 checklist and get called out explicitly in the PR body (see ORCHESTRATION §PR body).
- **Subjective design fidelity** (does it match the Figma). That's the in-loop reviewer (stage 10) + human QA1, not a metric.

---

## Build order (fits ROADMAP re-sequencing)

1. `pc-gate.mjs` orchestrating existing stages 1–6 + emitting the verdict schema. (Half a day — it's glue.)
2. Stage 7 preview push + Theme Access token plumbing.
3. Stage 8 render-load on affected templates. **This is where most of the real bug-catching value is** — build it before Lighthouse.
4. Stage 9 Lighthouse with regression baselining.
5. Wire stage 10 (in-loop reviewer) via the orchestrator.

Ship 1–3 on **le-fil only**, run it against a few real diffs, then generalize.
