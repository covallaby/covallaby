/**
 * Server-side coverage policy: the "can I merge?" gate for uploads that reach
 * the server instead of the Action. The server only ever sees uploaded
 * reports — never the PR's git diff — so it can honestly enforce three things:
 *
 *   - `minProject`  — a floor on whole-report line coverage
 *   - `maxDrop`     — how far project coverage may fall vs. the base branch
 *   - `minNewFile`  — a floor on each file that appears in head but not base
 *
 * True git-diff patch coverage stays the Action's job; we don't pretend to it.
 */
import { badgeColor } from "./vendor/badge.js";
import { formatPercent } from "./vendor/format.js";

/** Escape untrusted label text before it enters SVG markup. */
function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export interface RepoPolicy {
  /** Minimum whole-report line coverage percent (0–100). */
  minProject?: number;
  /** Largest allowed drop in project coverage vs. the base branch, in points. */
  maxDrop?: number;
  /** Minimum coverage percent for each file added vs. the base branch. */
  minNewFile?: number;
}

export interface PolicyViolation {
  kind: "project" | "drop" | "new-file";
  actual: number | null;
  required: number;
  /** A friendly, factual explanation — never just "coverage failed". */
  message: string;
}

export interface PolicyResult {
  /** False when no policy is set — the gate is open and always passes. */
  configured: boolean;
  passed: boolean;
  violations: PolicyViolation[];
}

/** What the store/compare layer feeds the evaluator. */
export interface PolicyInput {
  /** Head (or single-upload) project line coverage. */
  projectPercent: number | null;
  /**
   * Base-branch project coverage, when a comparison exists. `undefined` means
   * there is nothing to compare against, so the `maxDrop` rule is skipped.
   */
  basePercent?: number | null;
  /** Files present in head but not base, with their line coverage. */
  addedFiles?: Array<{ path: string; percent: number | null }>;
}

const isPercent = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100;

/**
 * Parse and clamp an untrusted policy object (PUT body or stored JSON). Returns
 * `null` when nothing valid is present, so callers treat "no keys" as "no
 * policy" rather than an empty always-passing gate.
 */
export function parsePolicy(raw: unknown): RepoPolicy | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const policy: RepoPolicy = {};
  if (isPercent(source.minProject)) policy.minProject = source.minProject;
  if (isPercent(source.minNewFile)) policy.minNewFile = source.minNewFile;
  // A drop is a span of percentage points; 0–100 is the sensible range.
  if (isPercent(source.maxDrop)) policy.maxDrop = source.maxDrop;
  return Object.keys(policy).length > 0 ? policy : null;
}

// Coverage compares are floored to one decimal for display; gate on the same
// grain so a 84.97% report never fails an 85.0% floor it visually meets.
export const floor1 = (n: number): number => Math.floor(n * 10 + 1e-9) / 10;

/** Evaluate a repo's policy against one upload (and its base, when present). */
export function evaluatePolicy(policy: RepoPolicy | null, input: PolicyInput): PolicyResult {
  if (!policy) return { configured: false, passed: true, violations: [] };
  const violations: PolicyViolation[] = [];
  const { projectPercent, basePercent, addedFiles = [] } = input;

  if (policy.minProject !== undefined) {
    const actual = projectPercent;
    if (actual === null || floor1(actual) < policy.minProject) {
      violations.push({
        kind: "project",
        actual,
        required: policy.minProject,
        message:
          actual === null
            ? `Project coverage is required to be ${formatPercent(policy.minProject)}, but the report has no coverable lines.`
            : `Project coverage is ${formatPercent(actual)}, but ${formatPercent(policy.minProject)} is required.`,
      });
    }
  }

  if (
    policy.maxDrop !== undefined &&
    basePercent !== undefined &&
    basePercent !== null &&
    projectPercent !== null
  ) {
    const drop = basePercent - projectPercent;
    if (floor1(drop) > policy.maxDrop) {
      violations.push({
        kind: "drop",
        actual: drop,
        required: policy.maxDrop,
        message: `Project coverage fell ${formatPercent(drop)} (from ${formatPercent(basePercent)} to ${formatPercent(projectPercent)}); at most ${formatPercent(policy.maxDrop)} is allowed.`,
      });
    }
  }

  if (policy.minNewFile !== undefined) {
    // Only files with coverable lines can fail; a 0-line new file is a pass.
    const failing = addedFiles
      .filter((f) => f.percent !== null && floor1(f.percent) < policy.minNewFile!)
      .sort((a, b) => (a.percent ?? 0) - (b.percent ?? 0));
    if (failing.length > 0) {
      const worst = failing.slice(0, 3).map((f) => `${f.path} (${formatPercent(f.percent)})`);
      const more = failing.length > 3 ? `, +${failing.length - 3} more` : "";
      violations.push({
        kind: "new-file",
        actual: failing[0]!.percent,
        required: policy.minNewFile,
        message: `${failing.length} new ${failing.length === 1 ? "file is" : "files are"} below the ${formatPercent(policy.minNewFile)} floor for added files: ${worst.join(", ")}${more}.`,
      });
    }
  }

  return { configured: true, passed: violations.length === 0, violations };
}

/**
 * A pass/fail status badge in the same flat shields style as the coverage
 * badge. `passed === null` renders a neutral "no policy" pill. Reuses the
 * coverage color scale's green/red endpoints so the two badges sit together.
 */
export function renderStatusBadge(passed: boolean | null, rawLabel = "covallaby"): string {
  const label = escapeXml(rawLabel.slice(0, 64));
  const value = passed === null ? "no policy" : passed ? "passing" : "failing";
  const color = passed === null ? badgeColor(null) : passed ? badgeColor(100) : badgeColor(0);
  const labelWidth = Math.round(label.length * 6.1) + 12;
  const valueWidth = Math.round(value.length * 6.1) + 12;
  const width = labelWidth + valueWidth;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <clipPath id="r"><rect width="${width}" height="20" rx="4" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="14">${label}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${value}</text>
  </g>
</svg>
`;
}
