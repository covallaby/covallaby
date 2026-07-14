import type { ReviewState, TestRunRow } from "../store.js";
import type { CommitStatusInput, CommitStatusState } from "./github-app.js";

/**
 * The per-signal commit status the hosted server owns: covallaby/components.
 *
 * The Action reports what it knows at CI time (coverage, journey outcomes,
 * "captures uploaded"), but a visual run's verdict changes *after* CI — a
 * human approves or rejects it on the dashboard. Only the server sees that,
 * so the server keeps the covallaby/components status current: pending while
 * review is open, success on approval (or mainline auto-accept), and failure
 * on rejection — a rejection with no consequence is worse than none.
 *
 * The details URL deep-links to the run's review page on this deployment's
 * configured base URL.
 */
export function componentsStatus(run: TestRunRow, baseUrl: string): CommitStatusInput {
  const byState: Record<ReviewState, { state: CommitStatusState; description: string }> = {
    pending: { state: "pending", description: "Component captures await visual review." },
    approved: { state: "success", description: "Visual changes approved in review." },
    rejected: { state: "failure", description: "Visual changes rejected in review." },
    "auto-accepted": {
      state: "success",
      description: "Auto-accepted as the default-branch baseline.",
    },
  };
  return {
    context: "covallaby/components",
    ...byState[run.reviewState],
    targetUrl: `${baseUrl}/r/${run.repo}/storybook-previews/${run.id}`,
  };
}
