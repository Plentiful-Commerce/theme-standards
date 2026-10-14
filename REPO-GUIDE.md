# Plentiful Commerce — theme repo guide

How every Plentiful Commerce Shopify theme repo is laid out and worked in. Each repo imports
this file from its `.claude/CLAUDE.md`, next to `CODING-STANDARDS.md`. Facts that are true for
one repo only (theme, version, store handle, default branch) are in that repo's
`.claude/CLAUDE.md`, not here.

## Commands

The repo uses npm. `package-lock.json` is committed, and CI installs with `npm ci`.

```bash
npm ci                   # Install exactly what package-lock.json pins
npm run dev              # Asset watch + Shopify theme dev server together
npm run watch            # Asset watch only
npm run build            # Production build
npm run shopify:dev      # Shopify theme dev server for this repo's store
npm run lint             # ESLint on src/
npm run lint:css         # Stylelint on src/
npm run lint:liquid      # Shopify Theme Check
npm run check            # ESLint + pc-lint (warn)
npm run format           # Prettier
```

Use Node 22 (see `.nvmrc`). Do not use yarn or pnpm, and do not add another lockfile.

## Directory structure

- `src/` - Source JavaScript and SCSS, compiled to `assets/`
  - `entrypoints/` - Webpack entry points
  - `modules/` - Code imported by the entry points
- `assets/` - Compiled output (`entry-*.js`, `entry-*.css`) plus the theme's own assets
- `sections/` - Section files with schema definitions
- `snippets/` - Reusable Liquid components
- `templates/` - JSON page templates
- `layout/` - Base layouts (`theme.liquid`, `password.liquid`)
- `locales/` - Translation JSON files

## Build pipeline

- Assets compile with Webpack Encore: Sass, PostCSS and Tailwind for CSS, Babel for JS.
- Entry `src/entrypoints/global/index.js` compiles to `assets/entry-global.js` and
  `assets/entry-global.css`. Each further entry compiles to its own `assets/entry-<name>.*`.
- The Webpack alias `@` maps to `./src/`.
- Tailwind scans every `.liquid` file and `src/**/*.js` for class names.
- CI (`.github/workflows/compile-assets.yml`) builds and commits `assets/entry-*` on the default
  branch.

## Git workflow

- Never commit a locally rebuilt `assets/entry-*` file. CI owns those files, and the pre-commit
  hook discards local changes to them.
- The pre-commit hook runs lint-staged (Prettier, ESLint, Stylelint) and then Theme Check on
  staged Liquid. It fails only on offenses the commit introduces.
- CI (`.github/workflows/lint.yml`) is the blocking gate on every pull request.
- The Shopify GitHub integration pushes theme-editor saves to the default branch as
  `Update from Shopify` commits. Expect to pull before pushing.

## Opening a pull request

- Branch name: `CU-{taskId}_{Task-Name}_{Assignee-Name}`. Title: the exact ClickUp task name.
- Body: the org PR template from `Plentiful-Commerce/.github`. GitHub fills it in only in the web
  form; `gh pr create --body` and the API skip it. Print it, fill in every section, and pass
  the result as the body:

  ```bash
  npx pc-pr-template > pr-body.md        # the template, to fill in
  npx pc-pr-body-check --file pr-body.md # optional: the same check CI runs
  gh pr create --title "<ClickUp task name>" --body-file pr-body.md
  ```

- Two CI checks enforce this. `pc-pr-body-check` (the "PR description" workflow) fails until the
  description has every template section filled in, a ClickUp link or "N/A" under Related
  ticket, and a ticked Type of change; editing the description reruns it. `pc-repo-check` fails
  if the repo contains its own PR template, because that would replace the org one. The same
  check enforces `package-lock.json` as the only lockfile and `.claude/CLAUDE.md` as the only
  agent-instructions file.

## Working with Liquid

**Sections** (`sections/*.liquid`):

- Each section stands alone and can be added in the theme editor.
- The schema block at the end of the file defines its settings.
- Include snippets with `{% render 'snippet-name' %}`.
- Read settings as `section.settings.setting_name`.

**Snippets** (`snippets/*.liquid`):

- Small, reusable components rendered inside sections and templates.
- They receive their values as parameters on the `render` tag.

**Templates**:

- JSON templates (`templates/*.json`) define which sections a page is made of.
- Liquid templates are the older full-page form.

**Translations**:

- Storefront text goes in `locales/en.default.json` and is read with `{{ 'key.path' | t }}`.
- Theme-editor labels go in `locales/en.default.schema.json` and are read with
  `"name": "t:key.path"`.

## Working with JavaScript

- Source files are in `src/` and compile to `assets/`.
- Use ES modules, with the `@` alias for imports.
- A new file in `src/entrypoints/` needs an entry in `webpack.config.js`.

## Working with CSS

- Write SCSS in `src/modules/`.
- Use `/* */` comments only, never `//` (Stylelint `no-invalid-double-slash-comments`).
- Tailwind classes are available in every Liquid file.

## Branch-preview themes with the wrong fonts and colours

**This section applies only when the repo's `.claude/CLAUDE.md` says the theme is affected.**
Affected themes compile their stylesheet through Liquid (a `.css.liquid` asset that reads
`settings.`), as Turbo and other vintage-era themes do. Focal, Dawn and other Online Store 2.0
themes output settings as CSS custom properties on each request and cannot hit this.

On an affected theme, a Shopify branch-preview theme renders the theme's stock defaults in place
of the real design. This happens to every new preview theme and has nothing to do with what the
pull request changed. Do not debug the pull request for it.

**Why.** Every colour and font is compiled into the CSS. Shopify keys that compiled output to
the source file's version hash, not to `config/settings_data.json`. A preview theme created by
the GitHub integration compiles before the settings finish syncing, bakes in the defaults, and
never recompiles.

**Saving in the theme editor does not fix it.** That changes settings, not the source file, so
the hash never moves. The editor looks correct because it renders Liquid on each request; only
the storefront preview serves the stale file. Editor right and preview wrong is the sign.

```bash
npm run preview:fix      # Repairs the preview theme for the current branch
```

The script appends a throwaway marker to the `.css.liquid` file, pushes only that asset, then
restores it. Nothing is committed and the pull request diff stays clean. Wait about 15 seconds
for the CDN, then hard-reload. It refuses to run against the live theme.

For routine visual checks use `npm run shopify:dev`, which is not affected.
