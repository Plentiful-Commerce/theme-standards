# [CLIENT_NAME] — Claude & developer instructions

## This repo

| | |
|---|---|
| Theme | [THEME_NAME] [VERSION] |
| Store handle | `[STORE_ID]` |
| Default branch | `[DEFAULT_BRANCH]` |

<!-- CONDITIONAL: keep the next line ONLY if `grep -c 'settings\.' assets/*.css.liquid`
     returns a non-zero count. Delete it, and this comment, for Focal / Dawn / any
     Online Store 2.0 theme. -->

**Branch-preview themes are affected on this theme.** The "Branch-preview themes with the wrong
fonts and colours" section of the repo guide below applies here.

## How to work in this repo

This repo consumes **@plentiful/theme-standards**. The two files below are loaded from the
installed package, so run `npm ci` first.

- **Repo guide**: commands, layout, build pipeline, git workflow.
- **Coding standards**: the rules the lint / format / Theme Check gate enforces. The package
  README's "For developers" section explains what runs on commit and on a pull request:
  https://github.com/Plentiful-Commerce/theme-standards

@../node_modules/@plentiful/theme-standards/REPO-GUIDE.md

@../node_modules/@plentiful/theme-standards/CODING-STANDARDS.md

> If the two imports above are blank, `node_modules` is not installed. Run `npm ci`, or read the
> files at https://github.com/Plentiful-Commerce/theme-standards.

## Notes for this repo only

<!-- Facts that are true for this repo and no other: custom patterns, traps, business rules.
     Leave this section empty rather than repeating anything from the two imported files. -->
