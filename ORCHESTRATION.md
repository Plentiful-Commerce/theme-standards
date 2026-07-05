# Autonomous Delivery Pipeline — ClickUp → VPS → PR

**Status:** draft v0 (2026-07-02)
**Purpose:** Define the orchestration that turns a ready ClickUp ticket into a reviewed, verified pull request with no human running a terminal. `PC-GATE-SPEC.md` covers *how the agent verifies its own work*; this doc covers *how the agent gets invoked, isolated, supervised, and how the PR gets opened and linked back*.

This is the ~60% of the goal that the standards docs don't touch. The standards make output *good*; this makes delivery *autonomous*.

---

## Design principles

1. **The trigger is a ClickUp status, not a webhook you have to trust.** Poll. It's simpler, survives missed events, and needs no public ingress on the VPS.
2. **One task = one isolated worktree = one branch = one PR.** No shared mutable state between concurrent tasks.
3. **The agent proposes; `pc-gate` and CI dispose.** The agent never merges. It opens a PR and stops.
4. **Fail loud, fail to a human.** Any stuck/looping/errored run posts back to the ClickUp task and stops. Silence is a bug.
5. **Everything reproducible.** Pinned Node, pinned Shopify CLI, pinned package versions, secrets from env only — never interactive auth. (Mirrors `CODING-STANDARDS.md` Part E.)

---

## The pipeline, end to end

```
ClickUp status = "ready for agent"
   │  (poller, every 60s)
   ▼
Claim task ────────────────► set status "agent in progress", add run-id comment
   │
   ▼
Provision worktree ────────► git clone/fetch, git worktree add, branch CU-<id>_<name>_agent
   │
   ▼
Build context ─────────────► pc-investigate-task output + ticket body + repo .claude/CLAUDE.md
   │
   ▼
Builder agent loop ────────► edit → pc-gate --no-render → fix … (fast inner loop)
   │
   ▼
Full pc-gate (with render) ► stages 1–9  (PC-GATE-SPEC)
   │        │
   │        └─ infra_error (exit 2) ─► backoff + retry, cap 3, then escalate
   │
   ▼
In-loop reviewer agent ────► adversarial A1–A10 review of the diff (stage 10)
   │        │
   │        └─ findings ─► back into builder loop
   │
   ▼
Open PR ───────────────────► push branch, gh pr create, attach pc-gate evidence
   │
   ▼
Link back ─────────────────► ClickUp: status "in review", comment with PR link + verdict
   │
   ▼
Teardown ──────────────────► remove worktree, reap preview theme, release slot
```

PC Bot reviews the PR *after* this point, unchanged. This pipeline's job ends at "PR open + linked."

---

## 1. Trigger — polling ClickUp

- A cron/systemd-timer on the VPS runs a poller every ~60s (`clickup_filter_tasks` via the ClickUp MCP or REST).
- **Trigger = the `ai-first-pass 🤖` tag.** Eligible tasks are those carrying that tag. No new statuses needed — the tag is the queue.
- **Atomic claim (tag swap):** on claim, remove `ai-first-pass 🤖`, add `agent-working`, and write a `run-id: <uuid>` comment — *before* any work. The tag swap is the lock: a second poller tick no longer sees `ai-first-pass 🤖`, so it can't double-claim.
- **On finish:** add `agent-in-review` (PR opened) or `agent-needs-human` (any escalation), and remove `agent-working`. These operational tags are cheap to create and give you an at-a-glance board of what the pipeline is doing.
- **Reaper:** a task stuck on `agent-working` with a stale heartbeat (§7) gets `ai-first-pass 🤖` swapped back on so it re-queues.
- **Concurrency cap:** N slots (start N=2). If all slots busy, leave the task queued; next tick picks it up.

**A ticket is only eligible when it's actually buildable.** Enforce a precondition check on claim; if it fails, flip to `needs requirements` + comment, don't attempt:
- Has acceptance criteria / testing criteria (your feature-ticket standard).
- Names the target repo (or it's inferable from the ClickUp list → repo map).
- Is a `feature` or `bug` type, **not** `investigation` (investigations produce proposals, not PRs — different pipeline).

---

## 2. Isolation — worktree per task

```
git -C <cache>/<repo> fetch origin
git -C <cache>/<repo> worktree add <runs>/<run-id> -b CU-<taskId>_<Task-Name>_agent origin/<default>
```

- Branch name follows the org convention (`CU-{taskId}_{Task-Name}_{Assignee-Name}`); assignee = `agent`.
- Each run gets its own worktree dir → concurrent runs never touch each other's files. (This is the same reason `Agent` supports `isolation: "worktree"`.)
- Preview themes are namespaced `pc-agent/CU-<taskId>` (PC-GATE stage 7) so teardown reaps exactly this run's theme.

---

## 3. Context assembly

The builder agent's opening prompt is assembled, not freeform:

- **Ticket:** title, description, acceptance + testing criteria, comments/threads.
- **Investigation output:** run your existing `pc-investigate-task` (Notion + Shopify + code + Slack) first, pass its findings comment in. This is the front half you already built — wire it in rather than duplicating.
- **Repo standards:** the checked-out `.claude/CLAUDE.md` (which imports `@plentiful/theme-standards` — Tier 2 + Tier 3 per CODING-STANDARDS Part E).
- **Explicit contract:** "Produce a diff that passes `pc-gate`. Do not merge. Do not touch files outside the task scope. If blocked after N attempts, stop and report."

---

## 4. Build + verify loop

The inner loop is the pseudocode in `PC-GATE-SPEC.md` §agent inner loop:
- Fast iterations use `pc-gate --no-render` (static, seconds).
- One full `pc-gate` (with render) before declaring done.
- `MAX_ATTEMPTS ~ 4`. Exhausted → escalate (see §7).
- `infra_error` (exit 2) is **not** an attempt — back off and retry, cap 3 infra retries, then escalate as infra (not "agent couldn't do it").

---

## 5. In-loop reviewer (stage 10) — the second agent

Distinct from PC Bot. Runs on the VPS, before the PR exists.

- **Input:** the diff + the A1–A10 checklist from `CODING-STANDARDS.md` Part A (the judgment rules `pc-gate` can't mechanically check — solution hierarchy, reuse-before-building, client-editability, etc.).
- **Prompt posture:** adversarial and *different from the builder's* — "find reasons this diff should not ship." A builder reviewing itself rubber-stamps; a separate skeptic doesn't.
- **Output:** structured findings → fed back into the builder loop, same as `pc-gate` findings. Only when the reviewer returns clean (or only nits) does the run proceed to PR.
- **Why before the PR:** PC Bot reviewing an open PR pulls a human in. The in-loop reviewer is what lets the loop close *without* you — it keeps a PR that would fail review from ever being opened.

> This is the answer to "do you mean another agent within the loop?" — **yes.** PC Bot stays as the post-PR final gate; this one is a pre-PR self-correction step. They're complementary.

---

## 6. Open PR + link back

- `git push -u origin <branch>`; `gh pr create` using the org PR template (from `Plentiful-Commerce/.github`).
- **PR body includes** (this is where autonomy earns trust):
  - What changed + how (extends the commit message, per A10).
  - **Preview link** (`preview_url` from the pc-gate verdict).
  - **`pc-gate` evidence:** pass verdict, before/after screenshots (desktop + mobile), Lighthouse delta table.
  - **Explicit manual-QA checklist** — the things `pc-gate` *can't* verify (theme editor settings, checkout, app blocks, admin state). Never let the PR imply "fully verified" when admin-side testing is still owed.
  - Link to the ClickUp task.
- **ClickUp:** flip status to `in review`, comment the PR URL + one-line verdict summary. Assign back to the PM for QA1.
- CI (`github-lint.yml` → the `check` gate) runs on the PR as the hard server-side gate, unchanged. Branch protection means even a confident agent can't merge red.

---

## 7. Failure handling — fail to a human

Every terminal failure path ends the same way: **post to ClickUp, stop, release the slot, tear down.** Never leave a silently dead run.

| Failure | Detection | Action |
|---------|-----------|--------|
| Agent stuck (MAX_ATTEMPTS) | loop counter | status `needs human`, comment last `pc-gate` findings + reviewer notes |
| Infra error (exit 2) | pc-gate exit code | retry×3 w/ backoff → status `blocked (infra)`, comment logs |
| Precondition unmet | claim-time check | status `needs requirements`, comment what's missing |
| Timeout | wall-clock cap (e.g. 45 min/run) | kill, status `needs human`, comment partial log |
| Token/cost ceiling | per-run budget | stop at cap, status `needs human`, comment spend |
| Crash / VPS died | run-id has no heartbeat > X min | reaper flips stale `agent in progress` back to `ready for agent` (or `needs human` after 2 strikes) |

A **heartbeat** (run-id + last-updated timestamp, written to a runs table/file each stage) is what makes crash recovery possible — without it a dead VPS leaves tasks stuck `in progress` forever.

---

## 8. Secrets & environment (VPS)

Per `CODING-STANDARDS.md` Part E — **no interactive auth, ever.**

| Secret | Use | Source |
|--------|-----|--------|
| `CLICKUP_API_TOKEN` | poll/claim/comment | env |
| `GITHUB_TOKEN` (or app) | clone, push, `gh pr create` | env / GH app |
| `SHOPIFY_CLI_THEME_TOKEN` | `theme push --unpublished` (pc-gate stage 7) | Theme Access app token, **per store** |
| `SHOPIFY_FLAG_STORE` | target store domain | per-repo config map |
| `CLAUDE_CODE_OAUTH_TOKEN` | builder + reviewer agents — **manual phase only** | `claude setup-token` (Max subscription, 1-yr token) |
| `ANTHROPIC_API_KEY` | builder + reviewer agents — **autonomous phase** | Anthropic Console (metered) |

**Auth is phased (see §10):** the hand-run vertical slice uses your **Max subscription** via `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN` — $0 marginal cost, fine for interactive/supervised use. When the poller makes runs **unattended**, switch to `ANTHROPIC_API_KEY` + the Agent SDK: that's both the ToS-correct path (subscription terms cover interactive individual use, not automated pipelines) and the one that won't stall on Max's 5-hour / weekly rate caps. A subscription OAuth token *cannot* be used with the Agent SDK.

- **Per-store Theme Access tokens** (Shopify's Theme Access app) — scoped to theme ops, revocable, no admin login. One per client store, kept in the repo→store→token map.
- Preinstalled + pinned on the VPS: **Node (even LTS) · git · Shopify CLI** — the `pc-gate` render layer needs the CLI present, non-interactively (matches ROADMAP's "critical requirement").
- Never make a client theme repo public; never commit any of these (A9).

---

## 9. Observability

You'll debug the *pipeline* far more than the *code*. Build for it now:

- **Per-run log** (worktree-local + shipped to a central store): each stage, timing, pc-gate verdict JSON, agent token spend, final disposition.
- **Runs table** (even a flat file / small sqlite): run-id, task-id, repo, status, started, heartbeat, cost. This is also the concurrency ledger and crash reaper's source of truth.
- **Morning triage view:** what ran overnight, what opened a PR, what escalated and why. This is what you actually look at when your computer's been closed.

---

## 10. Sequencing — prove the vertical slice first

Do **not** build all of this before touching a real ticket. Prove one thin path end-to-end on **le-fil**, then harden:

1. Manual trigger (you run a script with a task-id) → worktree → builder + `pc-gate` (stages 1–6) → PR + ClickUp link. No render, no reviewer, no poller yet. **Auth via your Max subscription** (`claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`) — $0 marginal cost while proving the chain.
2. Add `pc-gate` render layer (PC-GATE stages 7–9).
3. Add the in-loop reviewer (stage 10).
4. Add the poller + claim/lock + concurrency + heartbeat/reaper (§1, §7).
5. Add observability (§9), then widen to a second repo.

Each step is shippable and each de-risks the *next*. The poller is deliberately near-last — a script you run by hand proves the whole chain works before you let it run while you sleep.

---

## Decisions locked

- **Trigger:** the existing `ai-first-pass 🤖` tag; claim via tag-swap to `agent-working` (§1). No new statuses.
- **Auth:** Max subscription (`setup-token`) for the manual phase; API key + Agent SDK when the poller goes unattended (§8, §10).

## Open questions to resolve before build

- **The list→repo→store map** — which ClickUp lists feed the pipeline, and each task's target repo + Shopify store domain. (Feeds §1 scope + §8 store config. Repo may be inferable from list; store domain must be explicit for the pc-gate preview push.)
- **Cost ceiling per run** — pick a token/$ number (§7) before flipping the poller on. You'll have real per-ticket data from the manual phase to set it sensibly.
