import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import type { CommitCheck } from "../checks.js";
import { Card } from "../components/ui.js";
import { CommitCheckRow } from "./Commits.js";

const complete: CommitCheck = {
  repo: "covallaby/covallaby",
  commit: "78efa82884fd3fb863bfd58120092b9b93498cc6",
  branch: "feature/commit-status",
  pr: 16,
  createdAt: "2026-07-12T23:30:00Z",
  status: "ready",
  missing: [],
  coverage: {
    id: 1,
    repo: "covallaby/covallaby",
    branch: "feature/commit-status",
    commit: "78efa82884fd3fb863bfd58120092b9b93498cc6",
    pr: 16,
    linesCovered: 761,
    linesTotal: 1000,
    percent: 76.1,
    files: 42,
    createdAt: "2026-07-12T23:30:00Z",
  },
  journey: {
    id: 2,
    repo: "covallaby/covallaby",
    branch: "feature/commit-status",
    commit: "78efa82884fd3fb863bfd58120092b9b93498cc6",
    pr: 16,
    framework: "playwright",
    status: "complete",
    testsPassed: 34,
    testsFailed: 0,
    testsSkipped: 1,
    durationMs: 48000,
    createdAt: "2026-07-12T23:30:00Z",
    completedAt: "2026-07-12T23:31:00Z",
  },
  components: {
    id: 3,
    repo: "covallaby/covallaby",
    branch: "feature/commit-status",
    commit: "78efa82884fd3fb863bfd58120092b9b93498cc6",
    pr: 16,
    framework: "storybook",
    status: "complete",
    testsPassed: 0,
    testsFailed: 0,
    testsSkipped: 0,
    durationMs: 0,
    createdAt: "2026-07-12T23:30:00Z",
    completedAt: "2026-07-12T23:31:00Z",
    imageCount: 41,
  },
};

const meta = { title: "Pages/Commit status", parameters: { layout: "padded" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const ReadyAndIncomplete: Story = {
  render: () => (
    <MemoryRouter>
      <Card className="divide-y divide-(--hairline) overflow-hidden">
        <CommitCheckRow check={complete} repo={complete.repo} />
        <CommitCheckRow
          check={{
            ...complete,
            commit: "a12bc34def",
            status: "partial",
            coverage: null,
            missing: ["code"],
          }}
          repo={complete.repo}
        />
      </Card>
    </MemoryRouter>
  ),
};
