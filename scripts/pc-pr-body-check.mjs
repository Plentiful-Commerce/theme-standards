#!/usr/bin/env node
/**
 * pc-pr-body-check — fail when a PR description doesn't follow the org PR template.
 *
 * Every "## " section of the template must be present and filled in, Related
 * ticket must link the ClickUp task (or say N/A), and Type of change must have a
 * ticked box. Rules: rules/pr-body.mjs.
 *
 * Usage:
 *   npx pc-pr-body-check                 # in GitHub Actions: reads the PR from $GITHUB_EVENT_PATH
 *   npx pc-pr-body-check --file body.md  # locally, before opening the PR
 */
import { readFileSync } from 'node:fs';
import { TEMPLATE_URL, checkPrBody } from '../rules/pr-body.mjs';

const args = process.argv.slice(2);
const fileIdx = args.indexOf('--file');
let body;
if (fileIdx !== -1) {
  body = readFileSync(args[fileIdx + 1], 'utf8');
} else if (process.env.GITHUB_EVENT_PATH) {
  body = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).pull_request?.body ?? '';
} else {
  console.error('pc-pr-body-check: pass --file <body.md>, or run it in a pull_request workflow');
  process.exit(2);
}

const res = await fetch(TEMPLATE_URL);
if (!res.ok) {
  console.error(`pc-pr-body-check: could not fetch ${TEMPLATE_URL} (HTTP ${res.status})`);
  process.exit(2);
}
const violations = checkPrBody(body, await res.text());

if (violations.length === 0) {
  console.log('pc-pr-body-check: ✓ description follows the org PR template');
  process.exit(0);
}
for (const v of violations) console.log(`  [error] ${v.section}: ${v.message}`);
console.log('\npc-pr-body-check: ✗ edit the PR description; this check reruns on every edit.');
console.log('Template: npx pc-pr-template');
process.exit(1);
