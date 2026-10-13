## Description
- [Describe what changes are included in this pull request]

## Related ticket
- [Link to GitHub issue or ClickUp ticket, or "N/A" if none]

## Type of change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Additional Notes
- [Any additional context, test results, or comments]

---

<!--
⚠️ REVIEWERS: the branch-preview theme shows the WRONG fonts and colours.

Known platform side effect on this theme, NOT a problem with this PR. The theme
compiles its stylesheet through Liquid, and Shopify keys that compiled output to
the source file's version hash rather than to settings_data.json — so a preview
theme bakes in stock defaults and never recompiles. Saving in the theme editor
does not fix it.

To repair the preview theme:  npm run preview:fix
For routine visual QA:        npm run shopify:dev   (unaffected)

Full explanation in CLAUDE.md.

NOTE (setup-repo): this block applies only to themes with a settings-driven
.css.liquid. Delete it for Focal / Dawn / any OS 2.0 theme — and if the repo has
no such asset, prefer the org-level template in Plentiful-Commerce/.github over
adding a repo-level one at all.
-->
