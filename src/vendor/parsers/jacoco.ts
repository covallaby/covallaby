// Vendored from covallaby/covallaby (parsers/src/jacoco.ts) until packages publish to npm. Do not edit here.
import type {
  BranchCoverage,
  CoverageReport,
  FileCoverage,
  FunctionCoverage,
  LineCoverage,
} from "../model.js";
import { ParseError } from "./lcov.js";
import { normalizePath } from "./paths.js";
import { attr, intAttr, parseXml, toArray } from "./xml.js";

/**
 * JaCoCo XML report parser.
 *
 * Paths are `package name / sourcefile name`. JaCoCo reports covered
 * instructions per line, not execution counts, so line hits are 0/1.
 */
export function parseJacoco(
  content: string,
  options: { stripPrefix?: string } = {},
): CoverageReport {
  const doc = parseXml(content, "JaCoCo");
  const report = doc.report as Record<string, unknown> | undefined;
  if (!report) {
    throw new ParseError(
      "This doesn't look like a JaCoCo report — no <report> root element found.",
    );
  }

  const files: FileCoverage[] = [];
  for (const pkg of toArray(report.package)) {
    const pkgName = attr(pkg, "name") ?? "";
    const pkgObj = pkg as Record<string, unknown>;

    // Functions live on <class> elements, keyed by their sourcefilename.
    const functionsByFile = new Map<string, FunctionCoverage[]>();
    for (const cls of toArray(pkgObj.class)) {
      const sourceFile = attr(cls, "sourcefilename");
      if (!sourceFile) continue;
      const list = functionsByFile.get(sourceFile) ?? [];
      for (const method of toArray((cls as Record<string, unknown>).method)) {
        const name = attr(method, "name");
        const line = Number(attr(method, "line"));
        if (!name || !Number.isInteger(line)) continue;
        const methodCounter = toArray((method as Record<string, unknown>).counter).find(
          (c) => attr(c, "type") === "METHOD",
        );
        list.push({ name, line, hits: intAttr(methodCounter, "covered") > 0 ? 1 : 0 });
      }
      functionsByFile.set(sourceFile, list);
    }

    for (const source of toArray(pkgObj.sourcefile)) {
      const name = attr(source, "name");
      if (!name) continue;
      const lines: LineCoverage[] = [];
      const branches: BranchCoverage[] = [];
      for (const line of toArray((source as Record<string, unknown>).line)) {
        const nr = Number(attr(line, "nr"));
        if (!Number.isInteger(nr) || nr < 1) continue;
        const coveredInstructions = intAttr(line, "ci");
        lines.push({ line: nr, hits: coveredInstructions > 0 ? 1 : 0 });
        const coveredBranches = intAttr(line, "cb");
        const missedBranches = intAttr(line, "mb");
        if (coveredBranches + missedBranches > 0) {
          branches.push({
            line: nr,
            taken: coveredBranches,
            total: coveredBranches + missedBranches,
          });
        }
      }
      const path = normalizePath(pkgName === "" ? name : `${pkgName}/${name}`, options.stripPrefix);
      files.push({
        path,
        lines: lines.sort((a, b) => a.line - b.line),
        functions: (functionsByFile.get(name) ?? []).sort((a, b) => a.line - b.line),
        branches: branches.sort((a, b) => a.line - b.line),
      });
    }
  }

  if (files.length === 0) {
    throw new ParseError(
      "This JaCoCo report contains no <sourcefile> data. Generate the XML report with line details enabled.",
    );
  }
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)) };
}
