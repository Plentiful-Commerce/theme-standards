#!/usr/bin/env node
/**
 * pc-pr-template — print the org PR template, to fill in as the PR description.
 *
 * GitHub applies the org template (Plentiful-Commerce/.github) only in its web
 * form; `gh pr create --body` and the API skip it. The pc-pr-body CI check fails
 * a PR whose description doesn't follow it.
 *
 * Usage: npx pc-pr-template > pr-body.md
 */
import { TEMPLATE_URL } from '../rules/pr-body.mjs';

const res = await fetch(TEMPLATE_URL);
if (!res.ok) {
  console.error(`pc-pr-template: could not fetch ${TEMPLATE_URL} (HTTP ${res.status})`);
  process.exit(2);
}
process.stdout.write(await res.text());
