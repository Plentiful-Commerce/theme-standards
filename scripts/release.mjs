#!/usr/bin/env node
/**
 * release — tag a release of this package, so the tag always matches package.json.
 *
 * Release tags are protected (no deletion, no moving), so a wrong tag cannot be
 * fixed afterwards. This script refuses to tag unless it is safe:
 *   - the working tree is clean
 *   - HEAD is main and matches origin/main
 *   - the tag v<package.json version> does not exist yet
 * Then it creates the tag and pushes it.
 *
 * Usage:
 *   npm run release                         # tag + push v<version>
 *   node scripts/release.mjs --check v0.1.5 # exit 1 if the tag ≠ v<version> (CI)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tag = `v${version}`;

const fail = (msg) => {
  console.error(`release: ${msg}`);
  process.exit(1);
};

const args = process.argv.slice(2);
if (args[0] === '--check') {
  if (args[1] !== tag)
    fail(`tag ${args[1]} does not match package.json version ${version} (expected ${tag}).`);
  console.log(`release: tag ${tag} matches package.json version.`);
  process.exit(0);
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();

if (git('status', '--porcelain')) fail('the working tree has uncommitted changes.');
if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') fail('check out main first.');
git('fetch', 'origin', 'main', '--tags');
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main'))
  fail('main is not in step with origin/main. Pull or push first.');
if (git('tag', '--list', tag)) {
  fail(
    `${tag} already exists. Bump "version" in package.json in a PR, merge it, then run this again.`
  );
}

git('tag', tag);
git('push', 'origin', tag);
console.log(`release: pushed ${tag}.`);
