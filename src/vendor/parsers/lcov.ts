// Vendored from covallaby/covallaby (parsers/src/lcov.ts) until packages publish to npm. Do not edit here.
import type {
  BranchCoverage,
  CoverageReport,
  FileCoverage,
  FunctionCoverage,
  LineCoverage,
} from "../model.js";
import { normalizePath } from "./paths.js";

export class ParseError extends Error {
  constructor(
    message: string,
    readonly line?: number,
  ) {
    super(line === undefined ? message : `${message} (line ${line})`);
    this.name = "ParseError";
  }
}

/**
 * Parse LCOV tracefile content into the shared coverage model.
 *
 * Handles the records emitted by geninfo, nyc/istanbul, vitest, jest,
 * cargo-llvm-cov and friends: SF, DA, FN, FNDA, BRDA, end_of_record.
 * Summary records (LF/LH/FNF/FNH/BRF/BRH) are ignored — we recompute.
 */
export function parseLcov(content: string, options: { stripPrefix?: string } = {}): CoverageReport {
  const files: FileCoverage[] = [];

  let current: {
    path: string;
    lines: Map<number, number>;
    functionLines: Map<string, number>;
    functionHits: Map<string, number>;
    branches: Map<number, { taken: number; total: number }>;
  } | null = null;
  let sawRecord = false;

  const finish = () => {
    if (!current) return;
    const lines: LineCoverage[] = [...current.lines.entries()]
      .map(([line, hits]) => ({ line, hits }))
      .sort((a, b) => a.line - b.line);
    const functions: FunctionCoverage[] = [...current.functionLines.entries()]
      .map(([name, line]) => ({ name, line, hits: current!.functionHits.get(name) ?? 0 }))
      .sort((a, b) => a.line - b.line);
    const branches: BranchCoverage[] = [...current.branches.entries()]
      .map(([line, b]) => ({ line, ...b }))
      .sort((a, b) => a.line - b.line);
    files.push({ path: current.path, lines, functions, branches });
    current = null;
  };

  const rows = content.split(/\r?\n/);
  for (let i = 0; i < rows.length; i++) {
    const lineNo = i + 1;
    const row = rows[i]!.trim();
    if (row === "" || row.startsWith("TN:")) continue;

    if (row === "end_of_record") {
      finish();
      continue;
    }

    const colon = row.indexOf(":");
    if (colon === -1) {
      throw new ParseError(`Unrecognized LCOV record "${row}"`, lineNo);
    }
    const kind = row.slice(0, colon);
    const rest = row.slice(colon + 1);

    if (kind === "SF") {
      finish(); // tolerate a missing end_of_record
      sawRecord = true;
      current = {
        path: normalizePath(rest, options.stripPrefix),
        lines: new Map(),
        functionLines: new Map(),
        functionHits: new Map(),
        branches: new Map(),
      };
      continue;
    }

    if (current === null) {
      // Summary-only or stray records outside a file section; skip known ones.
      if (/^(LF|LH|FNF|FNH|BRF|BRH|FN|FNDA|DA|BRDA)$/.test(kind)) continue;
      throw new ParseError(`Unrecognized LCOV record "${row}"`, lineNo);
    }

    switch (kind) {
      case "DA": {
        const [lineStr, hitsStr] = rest.split(",");
        const line = Number(lineStr);
        const hits = Number(hitsStr);
        if (!Number.isInteger(line) || line < 1 || !Number.isFinite(hits)) {
          throw new ParseError(`Invalid DA record "${row}"`, lineNo);
        }
        current.lines.set(line, (current.lines.get(line) ?? 0) + hits);
        break;
      }
      case "FN": {
        // FN:<line>,<name>  (names may contain commas in C++ signatures)
        const comma = rest.indexOf(",");
        if (comma === -1) throw new ParseError(`Invalid FN record "${row}"`, lineNo);
        const line = Number(rest.slice(0, comma));
        const name = rest.slice(comma + 1);
        if (!Number.isInteger(line) || line < 1) {
          throw new ParseError(`Invalid FN record "${row}"`, lineNo);
        }
        current.functionLines.set(name, line);
        break;
      }
      case "FNDA": {
        const comma = rest.indexOf(",");
        if (comma === -1) throw new ParseError(`Invalid FNDA record "${row}"`, lineNo);
        const hits = Number(rest.slice(0, comma));
        const name = rest.slice(comma + 1);
        if (!Number.isFinite(hits)) throw new ParseError(`Invalid FNDA record "${row}"`, lineNo);
        current.functionHits.set(name, (current.functionHits.get(name) ?? 0) + hits);
        break;
      }
      case "BRDA": {
        // BRDA:<line>,<block>,<branch>,<taken|"-">
        const parts = rest.split(",");
        if (parts.length < 4) throw new ParseError(`Invalid BRDA record "${row}"`, lineNo);
        const line = Number(parts[0]);
        const takenStr = parts[parts.length - 1]!;
        if (!Number.isInteger(line) || line < 1) {
          throw new ParseError(`Invalid BRDA record "${row}"`, lineNo);
        }
        const taken = takenStr === "-" ? 0 : Number(takenStr);
        const entry = current.branches.get(line) ?? { taken: 0, total: 0 };
        entry.total += 1;
        if (taken > 0) entry.taken += 1;
        current.branches.set(line, entry);
        break;
      }
      // Per-file summary records — recomputed by core, ignored here.
      case "LF":
      case "LH":
      case "FNF":
      case "FNH":
      case "BRF":
      case "BRH":
        break;
      default:
        throw new ParseError(`Unrecognized LCOV record "${row}"`, lineNo);
    }
  }
  finish();

  if (!sawRecord) {
    throw new ParseError(
      "This doesn't look like an LCOV file — no SF: records found. Expected a tracefile like coverage/lcov.info.",
    );
  }

  return { files: files.sort((a, b) => a.path.localeCompare(b.path)) };
}
