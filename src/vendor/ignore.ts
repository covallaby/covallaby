// Vendored from covallaby/action (core/src/ignore.ts) until packages publish to npm. Do not edit here.
import type { CoverageReport } from "./model.js";

/**
 * Compile a gitignore-style glob into an anchored RegExp that tests a
 * repo-relative POSIX path:
 *   - `**` spans directories (`src/**` → everything under src)
 *   - `*` / `?` match within one path segment (never cross `/`)
 *   - a pattern with **no slash** matches at any depth (`*.test.ts`,
 *     `node_modules`), so bare directory/file names "just work".
 * Directory patterns also match everything beneath them.
 */
export function pathMatcher(pattern: string): RegExp {
  const p = pattern
    .trim()
    .replace(/^\.?\//, "") // drop leading ./ or /
    .replace(/\/+$/, ""); // drop trailing /
  let rx = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === "*" && p[i + 1] === "*") {
      if (p[i + 2] === "/") {
        rx += "(?:.*/)?"; // **/ → zero or more directories
        i += 2;
      } else {
        rx += ".*"; // ** → anything, including /
        i += 1;
      }
    } else if (c === "*") {
      rx += "[^/]*";
    } else if (c === "?") {
      rx += "[^/]";
    } else {
      rx += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  // Anchor: slash-bearing patterns match from the root; bare names at any depth.
  // The trailing `(/.*)?` lets a directory pattern also match its contents.
  const body = p.includes("/") ? `^${rx}(?:/.*)?$` : `(?:^|.*/)${rx}(?:/.*)?$`;
  return new RegExp(body);
}

/**
 * Drop files whose repo-relative path matches ANY ignore pattern (generated
 * code, vendored deps, tests, …). Empty patterns → the report is returned
 * unchanged. Coverage is recomputed downstream from the surviving files.
 */
export function ignorePaths(report: CoverageReport, patterns: string[]): CoverageReport {
  const active = patterns.map((p) => p.trim()).filter(Boolean);
  if (active.length === 0) return report;
  const matchers = active.map(pathMatcher);
  return { files: report.files.filter((f) => !matchers.some((m) => m.test(f.path))) };
}
