import { BookOpen, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { type StorybookPreview, api } from "../api.js";
import { Card, CardHeader, Td, Th } from "../components/ui.js";
import { useRepo } from "./Repo.js";

const when = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );

export function StorybookPreviews() {
  const { repo } = useRepo();
  const [previews, setPreviews] = useState<StorybookPreview[] | null>(null);
  useEffect(() => {
    api
      .storybookPreviews(repo)
      .then((result) => setPreviews(result.previews))
      .catch(() => setPreviews([]));
  }, [repo]);
  return (
    <Card>
      <CardHeader
        title="Storybook previews"
        description="Explore the exact component library built by CI for each commit and pull request."
      />
      {!previews ? (
        <p className="px-5 pb-5 text-sm text-(--muted)">Loading previews…</p>
      ) : previews.length === 0 ? (
        <p className="px-5 pb-6 text-sm text-(--muted)">
          No previews yet. Upload a Storybook build with the Covallaby Action to publish the first
          one.
        </p>
      ) : (
        <table className="w-full text-[13.5px]">
          <thead>
            <tr>
              <Th>Preview</Th>
              <Th>Commit</Th>
              <Th>Branch</Th>
              <Th>Published</Th>
            </tr>
          </thead>
          <tbody>
            {previews.map((preview) => (
              <tr key={preview.id} className="hover:bg-(--surface-2)">
                <Td>
                  <Link
                    className="font-medium hover:underline"
                    to={`/r/${repo}/storybook-previews/${preview.id}`}
                  >
                    <BookOpen className="mr-2 inline text-(--accent)" size={16} />
                    Preview #{preview.id}
                  </Link>
                </Td>
                <Td>
                  <span className="font-mono text-xs">{preview.commit.slice(0, 10)}</span>
                  {preview.pr ? (
                    <span className="ml-2 text-(--muted)">PR #{preview.pr}</span>
                  ) : null}
                </Td>
                <Td className="text-(--muted)">{preview.branch}</Td>
                <Td className="text-(--muted)">{when(preview.createdAt)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function StorybookPreviewDetail() {
  const { id } = useParams();
  const [data, setData] = useState<{ run: StorybookPreview; previewUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .storybookPreview(id!)
      .then(setData)
      .catch((reason) => setError(String(reason)));
  }, [id]);
  if (error) return <p className="text-sm text-(--bad)">{error}</p>;
  if (!data) return <p className="text-sm text-(--muted)">Loading Storybook preview…</p>;
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <Link
            to={`/r/${data.run.repo}/storybook-previews`}
            className="text-xs text-(--muted) hover:text-(--ink)"
          >
            ← All Storybook previews
          </Link>
          <h1 className="mt-2 text-xl font-semibold">Storybook preview #{data.run.id}</h1>
          <p className="mt-1 font-mono text-xs text-(--muted)">
            {data.run.commit} · {when(data.run.createdAt)}
          </p>
        </div>
        {data.run.status === "complete" ? (
          <a
            href={data.previewUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-(--border) bg-(--surface) px-3 py-2 text-xs font-medium hover:border-(--muted)"
          >
            Open preview <ExternalLink size={14} />
          </a>
        ) : (
          <span className="rounded-full bg-(--accent-wash) px-3 py-1.5 text-xs font-medium text-(--accent)">
            Publishing…
          </span>
        )}
      </div>
      {data.run.status === "complete" ? (
        <Card className="overflow-hidden">
          <iframe
            title={`Storybook preview ${data.run.id}`}
            src={data.previewUrl}
            referrerPolicy="no-referrer"
            className="h-[78vh] w-full border-0 bg-white"
            sandbox="allow-downloads allow-forms allow-popups allow-same-origin allow-scripts"
          />
        </Card>
      ) : (
        <Card className="p-6">
          <p className="text-sm font-medium">This preview is still publishing.</p>
          <p className="mt-1 text-xs text-(--muted)">
            Covallaby will make it available as soon as every Storybook asset finishes uploading.
          </p>
        </Card>
      )}
    </div>
  );
}
