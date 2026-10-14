/**
 * PR description checks — behaviour lock.
 * Run with: node --test test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPrBody } from '../rules/pr-body.mjs';

const TEMPLATE = `## Description
- What changes are included in this pull request?

## Related ticket
- Link to the ClickUp task, or "N/A" if none

## Type of change
- [ ] Bug fix
- [ ] New feature

## Additional Notes
- Any additional context or comments.
`;
const GOOD = `## Description
- Fixes the cart drawer thumbnails.

## Related ticket
- https://app.clickup.com/t/86c81pb52

## Type of change
- [x] Bug fix
- [ ] New feature

## Additional Notes
- Checked on mobile and desktop.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
`;
const sections = (body) => checkPrBody(body, TEMPLATE).map((v) => v.section);

test('a filled-in description passes', () => {
  assert.deepEqual(sections(GOOD), []);
});

test('flags a missing section', () => {
  assert.deepEqual(sections(GOOD.replace(/## Additional Notes[\s\S]*?\n\n/, '')), ['Additional Notes']);
});

test('flags a section left as the template placeholder', () => {
  assert.deepEqual(
    sections(GOOD.replace('- Fixes the cart drawer thumbnails.', '- What changes are included in this pull request?')),
    ['Description'],
  );
});

test('Related ticket needs a ClickUp link or N/A', () => {
  assert.deepEqual(sections(GOOD.replace('https://app.clickup.com/t/86c81pb52', 'see Slack')), ['Related ticket']);
  assert.deepEqual(sections(GOOD.replace('https://app.clickup.com/t/86c81pb52', 'N/A')), []);
});

test('Type of change needs a ticked box', () => {
  assert.deepEqual(sections(GOOD.replace('[x] Bug fix', '[ ] Bug fix')), ['Type of change']);
});

test('an empty body fails every section', () => {
  assert.equal(checkPrBody('', TEMPLATE).length, 4);
});

test('headings inside HTML comments do not count', () => {
  assert.deepEqual(sections(`<!--\n${GOOD}\n-->`).length, 4);
});
