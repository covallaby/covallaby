import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { type PolicyStatus, type RepoPolicy, api, formatPercent } from "../api.js";
import { PageSkeleton } from "../components/skeleton.js";
import { Card, CardFooter, CardHeader } from "../components/ui.js";

function StatusPill({ passed }: { passed: boolean | null }) {
  const [label, cls] =
    passed === null
      ? ["No policy", "bg-(--surface-2) text-(--muted)"]
      : passed
        ? ["Passing", "bg-(--chip-up-bg) text-(--chip-up)"]
        : ["Failing", "bg-(--chip-down-bg) text-(--chip-down)"];
  return (
    <span className={`rounded-full px-3 py-1 text-[13px] font-semibold ${cls}`}>
      {passed === true ? "✓ " : passed === false ? "✕ " : ""}
      {label}
    </span>
  );
}

function Rule({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-(--hairline) px-5 py-3 first:border-t-0">
      <div>
        <div className="text-[13.5px] font-medium">{label}</div>
        <div className="mt-0.5 text-xs text-(--muted)">{note}</div>
      </div>
      <div className="font-mono text-[15px] font-semibold tabular-nums whitespace-nowrap">
        {value}
      </div>
    </div>
  );
}

export function Policy() {
  const { owner, name } = useParams();
  const repo = `${owner}/${name}`;
  const [policy, setPolicy] = useState<RepoPolicy | null | undefined>(undefined);
  const [status, setStatus] = useState<PolicyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPolicy(undefined);
    setStatus(null);
    api
      .policy(repo)
      .then((d) => setPolicy(d.policy))
      .catch((e) => setError(String(e)));
    api
      .status(repo)
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [repo]);

  if (error) return <p className="text-sm text-(--bad)">{error}</p>;
  if (policy === undefined) return <PageSkeleton />;

  const passed = status?.configured ? status.passed : null;
  const rules: Array<{ label: string; value: string; note: string }> = [];
  if (policy?.minProject !== undefined)
    rules.push({
      label: "Project coverage floor",
      value: `≥ ${formatPercent(policy.minProject)}`,
      note: "The whole report can't drop below this.",
    });
  if (policy?.maxDrop !== undefined)
    rules.push({
      label: "Max drop vs. base",
      value: `≤ ${formatPercent(policy.maxDrop)}`,
      note: "How far coverage may fall against the base branch.",
    });
  if (policy?.minNewFile !== undefined)
    rules.push({
      label: "New-file floor",
      value: `≥ ${formatPercent(policy.minNewFile)}`,
      note: "Every file added vs. base must clear this.",
    });

  const setCmd = `curl -X PUT "$SERVER/api/v1/repos/${repo}/policy" \\
  -H "Authorization: Bearer $COVALLABY_TOKEN" \\
  -H "content-type: application/json" \\
  -d '{"minProject":85,"maxDrop":0}'`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg font-semibold tracking-tight">{repo}</h1>
          <p className="text-[13px] text-(--muted)">Merge policy — the “can I merge?” gate</p>
        </div>
        <StatusPill passed={passed} />
      </div>

      {policy ? (
        <>
          <Card>
            <CardHeader title="Rules" description="Enforced on every upload and pull request" />
            <div>
              {rules.map((r) => (
                <Rule key={r.label} {...r} />
              ))}
            </div>
            {status?.head && (
              <CardFooter>
                {passed
                  ? "Latest upload clears every rule. 🎉"
                  : status.configured
                    ? "Latest upload is below the gate — see the failures below."
                    : "No coverage to judge yet."}
                {status.head && (
                  <>
                    {" "}
                    Judged on{" "}
                    <Link
                      to={`/r/${repo}/u/${status.head.id}`}
                      className="font-mono hover:text-(--ink)"
                    >
                      {status.head.commit.slice(0, 7)}
                    </Link>
                    {status.base ? (
                      <>
                        {" "}
                        vs <span className="font-mono">{status.base.commit.slice(0, 7)}</span>
                      </>
                    ) : null}
                    .
                  </>
                )}
              </CardFooter>
            )}
          </Card>

          {status && !status.passed && status.violations.length > 0 && (
            <Card>
              <CardHeader title="Why it's failing" />
              <ul className="space-y-2 px-5 pb-4">
                {status.violations.map((v) => (
                  <li key={v.kind} className="flex gap-2 text-[13.5px] text-(--ink-2)">
                    <span className="text-(--bad)">✕</span>
                    {v.message}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      ) : (
        <Card>
          <CardHeader
            title="No merge policy yet"
            description="Set one and the server gates uploads and PRs — and CI can check it with a single curl."
          />
          <div className="px-5 pb-5">
            <p className="mb-3 text-sm text-(--ink-2)">
              A policy can require a project-coverage floor, cap how far coverage may fall vs. the
              base branch, and hold new files to a minimum. Set it with the admin token:
            </p>
            <pre className="overflow-x-auto rounded-xl border border-(--hairline) bg-(--surface-2) p-4 text-left font-mono text-xs leading-relaxed">
              {setCmd}
            </pre>
          </div>
        </Card>
      )}

      <p className="text-sm">
        <Link to={`/r/${repo}`} className="text-(--ink-2) hover:underline">
          ← Back to {repo}
        </Link>
      </p>
    </div>
  );
}
