import { CheckCircle2, CirclePlay, Images, Info } from "lucide-react";
import type { RepoOverview, ReviewSignals } from "../api.js";

/**
 * The single source of truth for the three confidence signals.
 *
 * Covallaby's stance: Code, Journeys, and Components are three independent
 * signals. They are never averaged, weighted, or rolled into one combined
 * score — every place that names a signal should pull its label, icon, and
 * definition from here so the portfolio tiles and the repo commit card
 * always speak the same language.
 */
export type SignalKey = "code" | "journeys" | "components";

export interface SignalDefinition {
  key: SignalKey;
  label: string;
  icon: typeof CheckCircle2;
  /** Plain-language "what is this?" copy, shown as a tooltip and in the drill-down. */
  definition: string;
  /** Friendly, never-shaming nudge for repos that aren't reporting yet. */
  missingHint: string;
  /** Where to send someone who wants to add this signal to a repo. */
  setupHref: (repo: string) => string;
}

export const SIGNALS: SignalDefinition[] = [
  {
    key: "code",
    label: "Code",
    icon: CheckCircle2,
    definition:
      "Line coverage from your test suite: the share of code lines that actually ran during tests. One signal on its own, never averaged with the others.",
    missingHint:
      "Upload any coverage file (LCOV, JaCoCo, Cobertura, xccov) from CI and it counts right away.",
    setupHref: (repo) => `/r/${repo}/activity`,
  },
  {
    key: "journeys",
    label: "Journeys",
    icon: CirclePlay,
    definition:
      "Real browser test runs (Playwright) that walk through user flows, with recordings you can replay. Its own signal, never blended into a score.",
    missingHint: "Publish Playwright results from CI and journeys will hop right in.",
    setupHref: (repo) => `/r/${repo}/activity`,
  },
  {
    key: "components",
    label: "Components",
    icon: Images,
    definition:
      "Distinct rendered component states captured from Storybook, so you can see every variant at a glance. Its own signal, never mixed into a score.",
    missingHint: "Publish Storybook captures from CI to start counting states.",
    setupHref: (repo) => `/r/${repo}/activity`,
  },
];

export const signalByKey = Object.fromEntries(SIGNALS.map((s) => [s.key, s])) as Record<
  SignalKey,
  SignalDefinition
>;

export function isSignalKey(value: string | null): value is SignalKey {
  return value === "code" || value === "journeys" || value === "components";
}

/** Plain-language definition of a "state" (a Storybook capture). */
export const STATES_HINT =
  "A state is one rendered look of a component (one Storybook story variant), captured as an image.";

export interface SignalBreakdown {
  /** Full repo names that report this signal on their latest activity. */
  reporting: string[];
  /** Full repo names that aren't reporting this signal yet. */
  missing: string[];
}

export interface SignalSummary {
  /** Total journey tests across each repo's latest run. */
  journeyTests: number;
  /** Total captured component states across each repo's latest preview. */
  componentStates: number;
  breakdown: Record<SignalKey, SignalBreakdown>;
}

/**
 * Fold the portfolio's review signals into per-signal reporting/missing lists
 * plus the headline counts the tiles show. Pure so "3/12 report journeys"
 * and "which 9 don't?" always come from the same math.
 */
export function summarizeSignals(repos: RepoOverview[], signals: ReviewSignals[]): SignalSummary {
  const breakdown: Record<SignalKey, SignalBreakdown> = {
    code: { reporting: [], missing: [] },
    journeys: { reporting: [], missing: [] },
    components: { reporting: [], missing: [] },
  };
  let journeyTests = 0;
  let componentStates = 0;
  for (const repo of repos) {
    const state = signals.find((entry) => entry.repo === repo.repo);
    const run = state?.runs[0];
    const preview = state?.previews[0];
    // A repo appears on the dashboard because it uploaded coverage, so code
    // reports whenever the latest upload has a measurable percentage.
    (repo.latest.percent !== null ? breakdown.code.reporting : breakdown.code.missing).push(
      repo.repo,
    );
    if (run) {
      breakdown.journeys.reporting.push(repo.repo);
      journeyTests += run.testsPassed + run.testsFailed + run.testsSkipped;
    } else {
      breakdown.journeys.missing.push(repo.repo);
    }
    if (preview) {
      breakdown.components.reporting.push(repo.repo);
      componentStates += preview.imageCount ?? 0;
    } else {
      breakdown.components.missing.push(repo.repo);
    }
  }
  return { journeyTests, componentStates, breakdown };
}

/** A small "what is this?" affordance: hover/focus tooltip plus screen-reader text. */
export function InfoHint({ text }: { text: string }) {
  return (
    <span title={text} className="inline-flex cursor-help align-middle text-(--muted)">
      <Info size={13} aria-hidden="true" />
      <span className="sr-only">{text}</span>
    </span>
  );
}
