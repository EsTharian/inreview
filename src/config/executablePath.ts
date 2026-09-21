import * as path from "node:path";

export function nonEmptyString(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0
    ? fallback
    : normalized;
}

/**
 * The jj executable: a bare command name resolved on PATH, or an absolute path
 * outside every open workspace folder. A relative path or a binary inside a
 * checkout falls back to `jj` — a cloned repository must never pick the program
 * the extension runs at startup (the setting is machine-scoped too; this is the
 * second lock).
 */
export function executablePath(
  value: string | undefined,
  fallback: string,
  roots: readonly string[],
): string {
  const normalized = nonEmptyString(value, fallback);
  const hasSeparator = /[\\/]/u.test(normalized);
  if (!hasSeparator) {
    return normalized;
  }
  if (!path.isAbsolute(normalized)) {
    return fallback;
  }
  const resolved = path.resolve(normalized);
  const insideWorkspace = roots.some((root) => {
    const relative = path.relative(path.resolve(root), resolved);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
  return insideWorkspace ? fallback : resolved;
}
