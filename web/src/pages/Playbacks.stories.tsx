import type { Meta, StoryObj } from "@storybook/react-vite";
import type { TestArtifact } from "../api.js";
import { JourneyViewer } from "./Playbacks.js";

const shot = (label: string, color: string, height = 900) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="${height}"><rect width="1440" height="${height}" fill="#10100f"/><rect x="80" y="70" width="1280" height="86" rx="18" fill="${color}" opacity=".22"/><rect x="80" y="190" width="310" height="640" rx="22" fill="#1d1d1a"/><rect x="425" y="190" width="935" height="300" rx="22" fill="#20201c"/><rect x="425" y="525" width="450" height="305" rx="22" fill="#20201c"/><rect x="910" y="525" width="450" height="305" rx="22" fill="#20201c"/><text x="115" y="125" fill="white" font-family="system-ui" font-size="32" font-weight="700">${label}</text><text x="465" y="250" fill="${color}" font-family="system-ui" font-size="24">Mostly Good Metrics</text></svg>`)}`;

let id = 1;
const make = (
  kind: TestArtifact["kind"],
  testName: string | null,
  name: string,
  url: string,
): TestArtifact => ({
  id: id++,
  runId: 4,
  name,
  kind,
  contentType: kind === "screenshot" ? "image/svg+xml" : "application/octet-stream",
  sizeBytes: 42_000,
  testName,
  createdAt: "2026-07-11T00:00:00Z",
  url,
});

const journeys = [
  "New customer activates their first dashboard",
  "Dashboard date range, refresh, and edit workflow",
  "Mobile dashboard remains usable",
  "Experiment creation and launch",
  "Marketing product story and pricing",
  "Mobile marketing remains readable",
];

const artifacts = journeys.flatMap((journey, journeyIndex) => {
  const fullName = `product flows › ${journey}`;
  const steps =
    journeyIndex === 0
      ? ["Organization created", "SDK key copied", "Dashboard ready"]
      : ["Journey complete"];
  return [
    ...steps.map((step, stepIndex) =>
      make(
        "screenshot",
        fullName,
        `${String(stepIndex + 1).padStart(2, "0")}-${step.toLowerCase().replaceAll(" ", "-")}.png`,
        shot(step, journeyIndex % 2 ? "#a3c957" : "#59c3ff", stepIndex === 2 ? 4200 : 900),
      ),
    ),
    make("video", fullName, "video.webm", "#video-not-loaded-in-story"),
    make("trace", fullName, "trace.zip", "#trace"),
  ];
});

const meta = {
  title: "Pages/Playwright theater",
  component: JourneyViewer,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-(--bg) p-5 text-(--ink)">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof JourneyViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SixProductJourneys: Story = { args: { artifacts } };
