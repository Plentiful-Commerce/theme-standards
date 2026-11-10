/**
 * Reads `shopify theme check --output json` from any Shopify CLI version into one
 * flat list of offenses, so callers don't depend on the CLI's output format.
 *
 *   CLI 4: [{ path, offenses: [{ check, severity, start_row, message }] }]       rows 0-based
 *   CLI 5: { valid, issues: [{ filePath, check, severity, startRow, message }] } rows 1-based
 *   Either, when Theme Check itself fails: { error: { message } }
 *
 * Returns [{ path, check, severity, line, message }] with `line` 1-based. Throws with
 * a readable message when the JSON is a Theme Check error or a shape it doesn't know.
 */
export function readThemeCheckJson(data) {
  if (Array.isArray(data)) {
    return data.flatMap((file) =>
      (file.offenses || []).map((o) => ({
        path: file.path,
        check: o.check,
        severity: o.severity,
        line: o.start_row + 1,
        message: o.message,
      }))
    );
  }
  if (data && Array.isArray(data.issues)) {
    return data.issues.map((i) => ({
      path: i.filePath,
      check: i.check,
      severity: i.severity,
      line: i.startRow,
      message: i.message,
    }));
  }
  if (data && data.error) {
    throw new Error(`Theme Check failed: ${data.error.message || JSON.stringify(data.error)}`);
  }
  throw new Error('Theme Check output is in a format this script does not know.');
}
