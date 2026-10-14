/**
 * Repo-shape checks — files a PC theme repo must or must not contain.
 *
 * Pure: takes the list of tracked paths and a reader, returns violations, so it
 * can be tested without a git checkout. scripts/pc-repo-check.mjs wires it to git.
 */

const IMPORTS = [
  '@../node_modules/@plentiful/theme-standards/REPO-GUIDE.md',
  '@../node_modules/@plentiful/theme-standards/CODING-STANDARDS.md',
];

// GitHub reads a PR template from the repo root, .github/ or docs/, as a single
// file or a PULL_REQUEST_TEMPLATE/ folder, in any letter case.
const PR_TEMPLATE = /^(?:\.github\/|docs\/)?pull_request_template(?:\.md|\/)/i;

export function checkRepo(paths, read) {
  const has = new Set(paths);
  const out = [];
  const add = (rule, path, message) => out.push({ rule, path, message });

  for (const p of paths) {
    if (PR_TEMPLATE.test(p)) {
      add('repo-pr-template', p, 'A repo PR template replaces the org-wide one in Plentiful-Commerce/.github. Delete it.');
    }
  }

  for (const lock of ['yarn.lock', 'pnpm-lock.yaml']) {
    if (has.has(lock)) add('repo-lockfile', lock, 'This repo uses npm. Delete it; package-lock.json is the only lockfile.');
  }
  if (!has.has('package-lock.json')) {
    add('repo-lockfile', 'package-lock.json', 'Missing. Run `npm install` and commit package-lock.json; CI installs with `npm ci`.');
  }

  if (has.has('CLAUDE.md')) {
    add('repo-claude-md', 'CLAUDE.md', 'Agent instructions live in .claude/CLAUDE.md only. Move anything repo-specific there and delete this file.');
  }
  if (!has.has('.claude/CLAUDE.md')) {
    add('repo-claude-md', '.claude/CLAUDE.md', 'Missing. Copy templates/claude-project.md from @plentiful/theme-standards and fill it in.');
  } else {
    const text = read('.claude/CLAUDE.md');
    for (const line of IMPORTS) {
      if (!text.split('\n').some((l) => l.trim() === line)) {
        add('repo-claude-md', '.claude/CLAUDE.md', `Missing the import line \`${line}\`.`);
      }
    }
  }

  return out;
}
