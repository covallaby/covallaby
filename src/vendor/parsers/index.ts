// Vendored from covallaby/covallaby (parsers/src/index.ts) until packages publish to npm. Do not edit here.
import type { CoverageReport } from "../model.js";
import { parseCobertura } from "./cobertura.js";
import { parseJacoco } from "./jacoco.js";
import { ParseError, parseLcov } from "./lcov.js";
import { parseXccov } from "./xccov.js";

export { parseCobertura } from "./cobertura.js";
export { parseJacoco } from "./jacoco.js";
export { ParseError, parseLcov } from "./lcov.js";
export { normalizePath } from "./paths.js";
export { parseXccov } from "./xccov.js";

export const COVERAGE_FORMATS = ["lcov", "jacoco", "cobertura", "xccov"] as const;
export type CoverageFormat = (typeof COVERAGE_FORMATS)[number];

export interface ParseOptions {
  /** Force a format instead of detecting from content. */
  format?: CoverageFormat;
  /** Path prefix to strip so paths become repo-relative. */
  stripPrefix?: string;
}

/** Best-effort format detection from content (never from the file name). */
export function detectFormat(content: string): CoverageFormat | null {
  if (/^(TN:|SF:)/m.test(content)) return "lcov";
  if (
    /<report[\s>]/.test(content) &&
    (/jacoco/i.test(content) || /<sourcefile[\s>]/.test(content))
  ) {
    return "jacoco";
  }
  if (/<coverage[\s>]/.test(content) && /line-rate/.test(content)) return "cobertura";
  const trimmed = content.trimStart();
  if (trimmed.startsWith("{")) return "xccov";
  return null;
}

const parsers: Record<
  CoverageFormat,
  (content: string, options: { stripPrefix?: string }) => CoverageReport
> = {
  lcov: parseLcov,
  jacoco: parseJacoco,
  cobertura: parseCobertura,
  xccov: parseXccov,
};

export function parseCoverage(content: string, options: ParseOptions = {}): CoverageReport {
  const format = options.format ?? detectFormat(content);
  if (format === null) {
    throw new ParseError(
      `Couldn't detect the coverage format. Covallaby understands ${COVERAGE_FORMATS.join(", ")} — pass --format to force one.`,
    );
  }
  const stripPrefix = options.stripPrefix;
  return parsers[format](content, stripPrefix === undefined ? {} : { stripPrefix });
}
