#!/usr/bin/env node
/**
 * run-task — vertical-slice orchestrator (PROTOTYPE, manual phase).
 *
 * The hand-run version of the ClickUp→VPS→PR pipeline (see ../ORCHESTRATION.md):
 * you invoke it with a task id, it isolates a worktree + branch, you (or a
 * headless `claude -p`) build in it, then `finish` runs pc-gate and — only if it
 * passes — opens the PR and swaps the ClickUp tag. The poller comes later; this
 * proves the chain with a human pressing go.
 *
 * NOT part of the published @plentiful/theme-standards package (excluded from
 * package.json "files"). Prototype orchestration lives here alongside the spec.
 *
 * Stateful actions (ClickUp tag swap, gh pr create) are DRY-RUN by default and
 * only fire with --execute, so nothing touches a real task/PR by accident.
 *
 * Commands:
 *   run-task provision <taskId> --repo <path> [--task-name <slug>] [--base origin/main]
 *       → git worktree add + branch CU-<taskId>_<Task-Name>_agent; prints the path
 *   run-task finish --worktree <path> --task <taskId> [--store <s>] [--render] [--execute]
 *       → pc-gate (JSON); on pass, build PR body + (—execute) gh pr create + tag swap
 *
 * Env for --execute: CLICKUP_API_TOKEN (tag swap), gh auth (PR). Manual-phase
 * builder auth is the Max subscription (claude setup-token); the autonomous
 * poller phase swaps to ANTHROPIC_API_KEY + Agent SDK — see ORCHESTRATION §8.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PC_GATE = resolve(SCRIPT_DIR, '../scripts/pc-gate.mjs');
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (f, d = null) => (argv.indexOf(f) === -1 ? d : argv[argv.indexOf(f) + 1]);
const has = (f) => argv.includes(f);
const EXECUTE = has('--execute');

const die = (m) => { console.error(`run-task: ✗ ${m}`); process.exit(1); };
function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) die(`git ${args.join(' ')} failed:\n${r.stderr || r.stdout}`);
  return (r.stdout || '').trim();
}
// Branch/theme-safe slug of a task name (feedback_git_branch_naming: CU-<id>_<Name>_<assignee>).
const slug = (s) => (s || 'task').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'task';

function provision() {
  const taskId = argv[1];
  const repo = opt('--repo');
  if (!taskId || !repo) die('usage: provision <taskId> --repo <path> [--task-name <slug>]');
  const repoPath = resolve(repo);
  if (!existsSync(join(repoPath, '.git'))) die(`not a git repo: ${repoPath}`);
  const base = opt('--base', 'origin/main');
  const name = slug(opt('--task-name', ''));
  const branch = `CU-${taskId}_${name}_agent`;
  const runsDir = process.env.PC_RUNS_DIR || '/tmp/pc-runs';
  const wt = join(runsDir, `${taskId}-${name}`);

  git(['fetch', 'origin'], repoPath);
  if (existsSync(wt)) die(`worktree already exists: ${wt} (remove it or pick another run)`);
  git(['worktree', 'add', wt, '-b', branch, base], repoPath);
  console.log(JSON.stringify({ ok: true, taskId, branch, worktree: wt, base }, null, 2));
}

function prBody({ taskId, verdict }) {
  const preview = verdict.stages?.find((s) => s.id === 'render')?.detail;
  const lh = (() => { try { return JSON.parse(preview); } catch { return null; } })();
  const lines = [
    '## Description', '- Implemented by the AI first-pass agent; verified by `pc-gate`.', '',
    '## Related ticket', `- ClickUp task \`${taskId}\``, '',
    '## Type of change', '- [x] New feature / Bug fix (see commits)', '',
    '## pc-gate verdict', `- **${verdict.verdict}** (base \`${verdict.base}\`)`,
    ...(verdict.stages || []).map((s) => `  - ${s.status === 'pass' ? '✓' : s.status === 'skip' ? '·' : '✗'} ${s.id}`),
    '',
    '## Manual QA still owed (pc-gate can\'t verify these)',
    '- [ ] Theme editor settings / section presets', '- [ ] Checkout & app blocks', '- [ ] Admin-side data', '',
  ];
  if (lh?.routes) {
    lines.push('## Rendered checks');
    for (const r of lh.routes) lines.push(`- \`${r.route}\` — perf ${r.lighthouse?.perf ?? '?'}, LCP ${r.lighthouse?.LCP ? Math.round(r.lighthouse.LCP) + 'ms' : '?'}`);
    lines.push('');
  }
  lines.push('🤖 Generated with [Claude Code](https://claude.com/claude-code)');
  return lines.join('\n');
}

function finish() {
  const wt = opt('--worktree');
  const taskId = opt('--task');
  if (!wt || !taskId) die('usage: finish --worktree <path> --task <taskId> [--render] [--execute]');
  const worktree = resolve(wt);
  if (!existsSync(worktree)) die(`worktree not found: ${worktree}`);

  const gateArgs = [PC_GATE, '--json'];
  if (has('--render')) { gateArgs.push('--render'); const store = opt('--store'); if (store) gateArgs.push('--store', store); }
  const g = spawnSync('node', gateArgs, { cwd: worktree, encoding: 'utf8', maxBuffer: 1e8 });
  let verdict;
  try { verdict = JSON.parse(g.stdout); } catch { die(`pc-gate produced no JSON:\n${g.stdout}${g.stderr}`); }

  console.error(`pc-gate: ${verdict.verdict} → ${verdict.next_action}`);
  if (verdict.verdict !== 'pass') {
    console.log(JSON.stringify({ ok: false, verdict: verdict.verdict, next_action: verdict.next_action, stages: verdict.stages }, null, 2));
    process.exit(1); // agent loop keeps fixing; do NOT open a PR
  }

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], worktree);
  const body = prBody({ taskId, verdict });
  if (!EXECUTE) {
    console.error('\n[dry-run] would: git push, gh pr create, ClickUp tag swap ai-first-pass→agent-in-review');
    console.error('           re-run with --execute (needs CLICKUP_API_TOKEN + gh auth)\n');
    console.log(JSON.stringify({ ok: true, dryRun: true, branch, prBody: body }, null, 2));
    return;
  }
  // --- EXECUTE path (stateful) ---
  git(['push', '-u', 'origin', branch], worktree);
  const pr = spawnSync('gh', ['pr', 'create', '--title', `[AI] ${branch}`, '--body', body], { cwd: worktree, encoding: 'utf8' });
  if (pr.status !== 0) die(`gh pr create failed:\n${pr.stderr}`);
  const prUrl = (pr.stdout || '').trim();
  console.error(`PR: ${prUrl}`);
  clickupTagSwap(taskId, prUrl);
  console.log(JSON.stringify({ ok: true, branch, pr: prUrl }, null, 2));
}

// ClickUp tag swap ai-first-pass 🤖 → agent-in-review + PR comment. REST, not MCP
// (this is a standalone script). Guarded — only runs on the --execute path.
function clickupTagSwap(taskId, prUrl) {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) { console.error('run-task: ⚠ CLICKUP_API_TOKEN unset — skipping tag swap'); return; }
  const api = (method, path, body) => spawnSync('curl', ['-sS', '-X', method,
    `https://api.clickup.com/api/v2${path}`, '-H', `Authorization: ${token}`,
    '-H', 'Content-Type: application/json', ...(body ? ['-d', JSON.stringify(body)] : [])], { encoding: 'utf8' });
  api('DELETE', `/task/${taskId}/tag/${encodeURIComponent('ai-first-pass 🤖')}`);
  api('POST', `/task/${taskId}/tag/agent-in-review`);
  api('POST', `/task/${taskId}/comment`, { comment_text: `AI first-pass PR opened: ${prUrl}` });
  console.error('run-task: ✓ ClickUp tag swapped + PR comment posted');
}

if (cmd === 'provision') provision();
else if (cmd === 'finish') finish();
else die('usage: run-task <provision|finish> …  (see header)');
