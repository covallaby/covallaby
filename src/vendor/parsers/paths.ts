// Vendored from covallaby/covallaby (parsers/src/paths.ts) until packages publish to npm. Do not edit here.
/**
 * Normalize a source path from a coverage file into a repo-relative POSIX path
 * so it can be matched against git paths.
 */
export function normalizePath(raw: string, stripPrefix?: string): string {
  let path = raw.trim().replaceAll("\\", "/");
  if (stripPrefix) {
    const prefix = stripPrefix.replaceAll("\\", "/").replace(/\/$/, "");
    if (path === prefix) return "";
    if (path.startsWith(`${prefix}/`)) {
      path = path.slice(prefix.length + 1);
    }
  }
  return path.replace(/^\.\//, "");
}
