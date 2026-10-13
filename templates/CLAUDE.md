# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Shopify theme based on [THEME_NAME] (version [VERSION]). It uses Webpack Encore for asset compilation with Tailwind CSS, SCSS, and PostCSS.

This repo consumes **@plentiful/theme-standards** for lint / format / Theme Check. See `.claude/CLAUDE.md` for the coding-standards import.

## Development Commands

```bash
npm run dev              # Run watch + Shopify dev server concurrently
npm run watch            # Watch mode for asset compilation only
npm run build            # Production build
npm run shopify:dev      # Shopify theme dev server (store: [STORE_ID])
npm run lint             # ESLint on src/
npm run lint:css         # Stylelint on src/
npm run lint:liquid      # Shopify Theme Check
npm run check            # ESLint + pc-lint (warn)
npm run format           # Prettier
```

<!-- CONDITIONAL: keep this section ONLY if `grep -c 'settings\.' assets/*.css.liquid`
     returns a non-zero count. Delete it entirely for Focal / Dawn / any OS 2.0
     theme — they emit settings as per-request CSS custom properties and cannot
     hit this. See ~/internal-claude/context/agency-work/coding/SHOPIFY-THEME-GOTCHAS.md -->

## ⚠️ Branch-preview themes render the WRONG fonts and colours

**Known platform side effect on this theme. The PR is almost certainly fine — do not debug it.**

A Shopify branch-preview theme (`[STORE_ID]/<branch>`) renders the theme's stock
defaults instead of the real design. This affects **every** new preview theme and
is unrelated to whatever the PR changed.

**Why.** This theme compiles its stylesheet through Liquid, so every colour and
font is baked *into* the CSS. Shopify keys that compiled output to the **source
file's version hash, not `config/settings_data.json`** — a preview theme created
by the GitHub integration compiles before settings finish syncing, bakes in the
defaults, and never recompiles.

**Saving in the theme editor does NOT fix it** — that changes settings, not the
source, so the hash never moves. The editor itself looks correct because it
renders Liquid per request; only the storefront preview serves the stale
artifact. That editor-right / preview-wrong split is the tell.

```bash
npm run preview:fix      # repairs the preview theme for the current branch
```

Appends a throwaway marker to the `.css.liquid`, pushes only that asset, then
restores it — nothing is committed and the PR diff stays clean. Give the CDN
~15s and hard-reload. Refuses to run against the live theme.

For routine visual QA prefer `npm run shopify:dev`, which is unaffected.

<!-- END CONDITIONAL -->

## Architecture

### Directory Structure

- `src/` - Source JavaScript and SCSS (compiled to assets/)
  - `entrypoints/` - Webpack entry points
  - `modules/` - Modular code imported by entry points
- `assets/` - Compiled output + vendor libraries (entry-_.js, entry-_.css)
- `sections/` - Shopify section files with schema definitions
- `snippets/` - Reusable Liquid components
- `templates/` - JSON page templates
- `layout/` - Base layouts (theme.liquid, password.liquid)
- `locales/` - Translation JSON files

### Build Pipeline

- Entry: `src/entrypoints/global/index.js` -> Output: `assets/entry-global.js` + `assets/entry-global.css`
- Webpack alias `@` maps to `./src/`
- Tailwind scans all `.liquid` files and `src/**/*.js` for classes
- CI (`.github/workflows/compile-assets.yml`) force-commits `assets/entry-*` on push to main

### Git Workflow

- Pre-commit: lint-staged + Theme Check on introduced Liquid offenses
- Do not commit locally-rebuilt `assets/entry-*` — CI owns those

## Node Version

Use Node 22 (see `.nvmrc`)

## File Modification Guidelines

### When Working with Liquid Files

**Sections** (`sections/*.liquid`):

- Each section is standalone and can be added via theme editor
- Include schema blocks at the end defining settings
- Use `{% render 'snippet-name' %}` to include snippets
- Reference settings via `section.settings.setting_name`

**Snippets** (`snippets/*.liquid`):

- Small, reusable components meant to be rendered within sections/templates
- Accept parameters passed from the render tag

**Templates**:

- JSON templates (`templates/*.json`) define section composition
- Liquid templates are traditional full-page templates

### When Working with JavaScript

- All JS files are in `src/` compiled to `assets/`
- Use ES6 modules with `@` alias for imports
- Entry points in `src/entrypoints/` auto-generate output files

### When Working with CSS

- Use SCSS files in `src/modules/`
- Use `/* */` comments only — never `//` (stylelint `no-invalid-double-slash-comments`)
- Tailwind CSS classes available in all Liquid files
