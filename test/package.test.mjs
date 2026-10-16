import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const exists = (rel) => existsSync(new URL(`../${rel}`, import.meta.url));

test('every export and bin points at a file', () => {
  for (const target of [...Object.values(pkg.exports), ...Object.values(pkg.bin)]) {
    assert.ok(exists(target), `${target} is missing`);
  }
});

test('lint tool versions are exact pins', () => {
  for (const [name, version] of Object.entries(pkg.dependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name}@${version} is not an exact version`);
  }
});
