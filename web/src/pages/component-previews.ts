import type { StorybookPreview } from "../api.js";

export interface ComponentPreviewSections {
  current: StorybookPreview | null;
  changes: StorybookPreview[];
}

/**
 * Split the repository's component runs into its current default-branch
 * library and one latest diff per PR/branch. The API is newest-first.
 */
export function componentPreviewSections(
  previews: StorybookPreview[],
  defaultBranch: string,
): ComponentPreviewSections {
  const current =
    previews.find((preview) => preview.branch === defaultBranch && preview.pr === null) ?? null;
  const seen = new Set<string>();
  const changes = previews.filter((preview) => {
    if (preview.id === current?.id || (preview.branch === defaultBranch && preview.pr === null)) {
      return false;
    }
    const key = preview.pr ? `pr:${preview.pr}` : `branch:${preview.branch}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { current, changes };
}
