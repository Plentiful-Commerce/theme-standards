#!/usr/bin/env sh
# pc-pre-commit — the PC pre-commit hook. A repo's `.husky/pre-commit` is one line:
#   npx --no-install pc-pre-commit
# Husky 9: do NOT source _/husky.sh (removed / deprecated).

# npm links this file into node_modules/.bin; resolve the link to find the package.
self=$(node -e 'console.log(require("fs").realpathSync(process.argv[1]))' "$0")
pkg=$(dirname "$(dirname "$self")")

npx --no-install lint-staged --config "$pkg/lint-staged/index.mjs" || exit 1

# Theme Check on staged Liquid — fails the commit on any offense (warning+) you
# INTRODUCE (line-scoped). Requires the Shopify CLI.
if git diff --cached --name-only --diff-filter=d | grep -qE '\.liquid$'; then
  if ! command -v shopify >/dev/null 2>&1; then
    echo "✗ This commit changes Liquid but the Shopify CLI is not installed."
    echo "  Install it (brew install shopify-cli) so Theme Check can run, then retry."
    echo "  Or bypass this once with: git commit --no-verify"
    exit 1
  fi
  TCJSON=$(mktemp)
  shopify theme check --output json > "$TCJSON" 2>/dev/null || true
  if ! node "$pkg/scripts/theme-check-changed.mjs" "$TCJSON" --staged --fail-level warning; then
    rm -f "$TCJSON"
    echo "Commit blocked by Theme Check. Fix the above, or bypass with: git commit --no-verify"
    exit 1
  fi
  rm -f "$TCJSON"
fi

# PC convention: never commit locally-rebuilt bundles — CI owns entry-*.
git checkout -- 'assets/entry-*' >/dev/null 2>&1 || true
