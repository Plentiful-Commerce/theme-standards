/**
 * PR description checks against the org PR template (Plentiful-Commerce/.github).
 *
 * Pure: takes the PR body and the template text, returns violations. The template
 * is the only source of the section names, so renaming a section in the org repo
 * changes what this checks without a release here.
 */

export const TEMPLATE_URL =
  'https://raw.githubusercontent.com/Plentiful-Commerce/.github/main/pull_request_template.md';

// Split markdown into { heading: body } on "## " headings, ignoring HTML comments.
export function sections(md) {
  const out = new Map();
  let current = null;
  for (const line of md.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      current = h[1];
      out.set(current, []);
    } else if (current) {
      out.get(current).push(line);
    }
  }
  for (const [k, v] of out) out.set(k, v.join('\n').trim());
  return out;
}

export function checkPrBody(body, template) {
  const want = sections(template);
  const got = sections(body || '');
  const out = [];
  const add = (section, message) => out.push({ section, message });

  for (const [name, placeholder] of want) {
    if (!got.has(name)) {
      add(name, `Missing the "## ${name}" section.`);
      continue;
    }
    const text = got.get(name);
    if (!text) add(name, 'Section is empty.');
    else if (text === placeholder && !/\[[ x]\]/.test(placeholder)) add(name, 'Still the template placeholder text.');
  }

  const ticket = got.get('Related ticket');
  if (want.has('Related ticket') && ticket && !/app\.clickup\.com\/t\/|\bN\/A\b/i.test(ticket)) {
    add('Related ticket', 'Link the ClickUp task (https://app.clickup.com/t/…) or write "N/A".');
  }
  const type = got.get('Type of change');
  if (want.has('Type of change') && type && !/\[x\]/i.test(type)) {
    add('Type of change', 'Tick at least one box.');
  }
  return out;
}
