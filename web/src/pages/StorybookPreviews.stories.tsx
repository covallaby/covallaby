import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useEffect } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, userEvent, within } from "storybook/test";
import type { StorybookCapture, StorybookDiffSummary, StorybookPreview } from "../api.js";
import { StorybookPreviewDetail } from "./StorybookPreviews.js";

const image = (label: string, accent: string, offset = 0) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#171613"/><rect x="${120 + offset}" y="${110 + offset}" width="${720 - offset * 2}" height="320" rx="24" fill="#29251f" stroke="#4b4338"/><circle cx="${190 + offset}" cy="190" r="24" fill="${accent}"/><rect x="250" y="166" width="420" height="28" rx="14" fill="#f5f1e8"/><rect x="250" y="216" width="300" height="18" rx="9" fill="#928979"/><text x="150" y="380" fill="#f5f1e8" font-family="system-ui" font-size="30" font-weight="700">${label}</text></svg>`)}`;

const baseline = image("Baseline checkout", "#d59b16", 10);
const current = image("Updated checkout", "#22c55e");
const diff = image("Changed pixels", "#ff2f92", 4);
const originalFetch = globalThis.fetch.bind(globalThis);

type PreviewResponse = {
  run: StorybookPreview;
  previewUrl: string;
  baselineRun: StorybookPreview | null;
  summary: StorybookDiffSummary;
  captures: StorybookCapture[];
};

const run = (overrides: Partial<StorybookPreview> = {}): StorybookPreview => ({
  id: 18,
  repo: "covallaby/covallaby",
  branch: "feature/checkout-polish",
  commit: "8f31cb8d59ea5bb8e8dcf7cd981bfc5fbdfa456a",
  pr: 128,
  framework: "storybook",
  status: "complete",
  testsPassed: 0,
  testsFailed: 0,
  testsSkipped: 0,
  durationMs: 0,
  createdAt: "2026-07-11T18:42:00.000Z",
  completedAt: "2026-07-11T18:43:02.000Z",
  ...overrides,
});

const changedFixture: PreviewResponse = {
  run: run(),
  previewUrl: "https://previews.example.test/p/18/index.html",
  baselineRun: run({ id: 17, branch: "main", pr: null, commit: "72d41f0dd8" }),
  summary: { changed: 3, new: 1, removed: 1, unchanged: 1, uncompared: 0 },
  captures: [
    {
      artifactId: 1,
      id: "checkout--default",
      title: "Commerce/Checkout",
      name: "Default",
      status: "changed",
      imageUrl: current,
      baselineImageUrl: baseline,
      diffImageUrl: diff,
      sha256: "1".repeat(64),
      baselineSha256: "2".repeat(64),
      changedPixels: 6480,
      totalPixels: 540000,
      changeRatio: 0.012,
      review: { state: "pending" },
    },
    // These two share the exact same (baseline, new) hash pair as each other,
    // so the review groups them into one stop.
    {
      artifactId: 4,
      id: "checkout--dark",
      title: "Commerce/Checkout",
      name: "Dark",
      status: "changed",
      imageUrl: current,
      baselineImageUrl: baseline,
      diffImageUrl: diff,
      sha256: "3".repeat(64),
      baselineSha256: "4".repeat(64),
    },
    {
      artifactId: 5,
      id: "checkout--compact",
      title: "Commerce/Checkout",
      name: "Compact",
      status: "changed",
      imageUrl: current,
      baselineImageUrl: baseline,
      diffImageUrl: diff,
      sha256: "3".repeat(64),
      baselineSha256: "4".repeat(64),
    },
    {
      artifactId: 2,
      id: "checkout--annual-plan",
      title: "Commerce/Checkout",
      name: "Annual plan",
      status: "new",
      imageUrl: image("New annual plan", "#22c55e", 6),
    },
    {
      artifactId: null,
      id: "checkout--legacy-coupon",
      title: "Commerce/Checkout",
      name: "Legacy coupon",
      status: "removed",
      imageUrl: "",
      baselineImageUrl: image("Removed coupon", "#ef6464", 8),
    },
    {
      artifactId: 3,
      id: "button--primary",
      title: "Components/Button",
      name: "Primary",
      status: "unchanged",
      imageUrl: baseline,
      baselineImageUrl: baseline,
    },
  ],
};

function WithApiFixture({ fixture, children }: { fixture: PreviewResponse; children: ReactNode }) {
  window.fetch = async (input, init) => {
    if (String(input).includes("/api/v1/storybook-previews/18")) {
      return new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };
  useEffect(
    () => () => {
      window.fetch = originalFetch;
    },
    [],
  );
  return children;
}

function ReviewStory({ fixture }: { fixture: PreviewResponse }) {
  return (
    <WithApiFixture fixture={fixture}>
      <MemoryRouter initialEntries={["/r/covallaby/covallaby/storybook-previews/18"]}>
        <Routes>
          <Route
            path="/r/:owner/:name/storybook-previews/:id"
            element={<StorybookPreviewDetail />}
          />
        </Routes>
      </MemoryRouter>
    </WithApiFixture>
  );
}

const meta = {
  title: "Pages/Component visual review",
  parameters: { layout: "fullscreen", contentWidth: "wide" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ChangedNewAndRemoved: Story = {
  render: () => <ReviewStory fixture={changedFixture} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("heading", { name: "Default" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "overlay" }));
    await expect(canvas.getByRole("slider", { name: "Current image visibility" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "diff" }));
    await expect(canvas.getByAltText("Pixel diff for Default")).toBeVisible();
    // The two stories sharing one identical diff collapse into a single group card.
    const group = canvas.getByRole("button", { name: /2 stories with this same change/i });
    await userEvent.click(group);
    await expect(canvas.getByRole("button", { name: /Compact/i })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: /1 removed/i }));
    await expect(canvas.getByRole("button", { name: /Legacy coupon/i })).toBeVisible();
  },
};

export const KeyboardReviewLoop: Story = {
  render: () => <ReviewStory fixture={changedFixture} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("heading", { name: "Default" })).toBeVisible();
    // j advances to the next review stop; the identical-diff group is one stop.
    await userEvent.keyboard("j");
    await expect(canvas.getByRole("heading", { name: "Dark" })).toBeVisible();
    await userEvent.keyboard("j");
    await expect(canvas.getByRole("heading", { name: "Annual plan" })).toBeVisible();
    await userEvent.keyboard("k");
    await userEvent.keyboard("k");
    await expect(canvas.getByRole("heading", { name: "Default" })).toBeVisible();
    // d toggles the pixel diff, b flips baseline vs. new in place.
    await userEvent.keyboard("d");
    await expect(canvas.getByAltText("Pixel diff for Default")).toBeVisible();
    await userEvent.keyboard("d");
    await expect(canvas.queryByAltText("Pixel diff for Default")).toBeNull();
    await userEvent.keyboard("b");
    await expect(canvas.getByRole("slider", { name: "Current image visibility" })).toBeVisible();
  },
};

export const PersistentRuleConfiguration: Story = {
  render: () => <ReviewStory fixture={changedFixture} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("heading", { name: "Default" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Mark flaky" }));
    await expect(canvas.getByLabelText("Allowed changed pixels percentage")).toHaveValue(1.5);
    await expect(canvas.getByLabelText("Visual rule reason")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Save flaky rule" })).toBeVisible();
  },
};

export const NoBaselineYet: Story = {
  render: () => (
    <ReviewStory
      fixture={{
        ...changedFixture,
        baselineRun: null,
        summary: { changed: 0, new: 0, removed: 0, unchanged: 0, uncompared: 1 },
        captures: [
          {
            artifactId: 1,
            id: "checkout--default",
            title: "Commerce/Checkout",
            name: "Default",
            status: "uncompared",
            imageUrl: current,
          },
        ],
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText(/No earlier main capture is available yet/),
    ).toBeVisible();
  },
};

export const AllUnchanged: Story = {
  render: () => (
    <ReviewStory
      fixture={{
        ...changedFixture,
        summary: { changed: 0, new: 0, removed: 0, unchanged: 1, uncompared: 0 },
        captures: [changedFixture.captures[3]!],
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/No visual changes to review/)).toBeVisible();
    await userEvent.selectOptions(canvas.getByRole("combobox", { name: "Capture filter" }), "all");
    await expect(
      canvas.getByRole("button", { name: /Components\/Button — Primary/i }),
    ).toBeVisible();
  },
};
