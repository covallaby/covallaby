// Vendored from covallaby/covallaby (parsers/src/xccov.ts) until packages publish to npm. Do not edit here.
import type { CoverageReport, FileCoverage, LineCoverage } from "../model.js";
import { ParseError } from "./lcov.js";
import { normalizePath } from "./paths.js";

interface XccovLine {
  line: number;
  isExecutable: boolean;
  executionCount: number | null;
  subranges?: Array<{ executionCount: number }>;
}

/**
 * xccov per-line JSON parser — the shape produced by
 * `xcrun xccov view --archive --json Result.xcresult`:
 * a map of file path -> array of line records.
 *
 * A partially covered line reports `executionCount: null` plus subranges;
 * we take the max subrange count so the line reads as hit.
 */
export function parseXccov(
  content: string,
  options: { stripPrefix?: string } = {},
): CoverageReport {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    throw new ParseError("This doesn't look like xccov JSON — the file isn't valid JSON.");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ParseError("This doesn't look like xccov per-line JSON.");
  }

  if ("targets" in data) {
    throw new ParseError(
      "This is the xccov summary report, which has no per-line data. " +
        "Export the per-line shape instead: xcrun xccov view --archive --json Result.xcresult",
    );
  }

  const files: FileCoverage[] = [];
  for (const [rawPath, records] of Object.entries(data)) {
    if (!Array.isArray(records)) {
      throw new ParseError(`Unexpected xccov entry for "${rawPath}" — expected an array of lines.`);
    }
    const lines: LineCoverage[] = [];
    for (const record of records as XccovLine[]) {
      if (typeof record?.line !== "number" || !record.isExecutable) continue;
      const hits =
        record.executionCount ??
        Math.max(0, ...(record.subranges ?? []).map((s) => s.executionCount));
      lines.push({ line: record.line, hits });
    }
    files.push({
      path: normalizePath(rawPath, options.stripPrefix),
      lines: lines.sort((a, b) => a.line - b.line),
      functions: [],
      branches: [],
    });
  }

  if (files.length === 0) {
    throw new ParseError("This xccov JSON contains no files.");
  }
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)) };
}
