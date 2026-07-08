// Vendored from covallaby/covallaby (parsers/src/cobertura.ts) until packages publish to npm. Do not edit here.
import type {
  BranchCoverage,
  CoverageReport,
  FileCoverage,
  FunctionCoverage,
} from "../model.js";
import { ParseError } from "./lcov.js";
import { normalizePath } from "./paths.js";
import { attr, parseXml, toArray } from "./xml.js";

/**
 * Cobertura XML parser (also emitted by coverage.py, coverlet, gcovr, …).
 *
 * Several <class> elements can share one filename (nested/inner classes);
 * their data is merged into a single file entry.
 */
export function parseCobertura(
  content: string,
  options: { stripPrefix?: string } = {},
): CoverageReport {
  const doc = parseXml(content, "Cobertura");
  const coverage = doc.coverage as Record<string, unknown> | undefined;
  if (!coverage) {
    throw new ParseError(
      "This doesn't look like a Cobertura report — no <coverage> root element found.",
    );
  }

  interface FileEntry {
    lines: Map<number, number>;
    branches: Map<number, BranchCoverage>;
    functions: FunctionCoverage[];
  }
  const byPath = new Map<string, FileEntry>();

  const classes = toArray(coverage.packages).flatMap((pkgs) =>
    toArray((pkgs as Record<string, unknown>).package).flatMap((pkg) =>
      toArray((pkg as Record<string, unknown>).classes).flatMap((clss) =>
        toArray((clss as Record<string, unknown>).class),
      ),
    ),
  );

  for (const cls of classes) {
    const filename = attr(cls, "filename");
    if (!filename) continue;
    const path = normalizePath(filename, options.stripPrefix);
    const entry: FileEntry = byPath.get(path) ?? {
      lines: new Map(),
      branches: new Map(),
      functions: [],
    };
    byPath.set(path, entry);
    const clsObj = cls as Record<string, unknown>;

    const collectLine = (line: unknown) => {
      const number = Number(attr(line, "number"));
      const hits = Number(attr(line, "hits"));
      if (!Number.isInteger(number) || number < 1 || !Number.isFinite(hits)) return;
      entry.lines.set(number, Math.max(entry.lines.get(number) ?? 0, hits));
      const condition = attr(line, "condition-coverage");
      const match = condition ? /\((\d+)\/(\d+)\)/.exec(condition) : null;
      if (match) {
        entry.branches.set(number, {
          line: number,
          taken: Number(match[1]),
          total: Number(match[2]),
        });
      }
    };

    for (const line of toArray((clsObj.lines as Record<string, unknown> | undefined)?.line)) {
      collectLine(line);
    }

    for (const method of toArray((clsObj.methods as Record<string, unknown> | undefined)?.method)) {
      const name = attr(method, "name");
      const methodLines = toArray(
        ((method as Record<string, unknown>).lines as Record<string, unknown> | undefined)?.line,
      );
      for (const line of methodLines) collectLine(line);
      const first = methodLines[0];
      if (name && first) {
        const line = Number(attr(first, "number"));
        const hits = Number(attr(first, "hits"));
        if (Number.isInteger(line)) {
          entry.functions.push({ name, line, hits: Number.isFinite(hits) ? hits : 0 });
        }
      }
    }
  }

  if (byPath.size === 0) {
    throw new ParseError(
      "This Cobertura report contains no <class> line data — was it generated with line details?",
    );
  }

  const files: FileCoverage[] = [...byPath.entries()]
    .map(([path, entry]) => ({
      path,
      lines: [...entry.lines.entries()]
        .map(([line, hits]) => ({ line, hits }))
        .sort((a, b) => a.line - b.line),
      functions: entry.functions.sort((a, b) => a.line - b.line),
      branches: [...entry.branches.values()].sort((a, b) => a.line - b.line),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { files };
}
