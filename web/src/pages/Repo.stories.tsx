import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import type { RepoHistory } from "../api.js";
import { RepoHeader } from "./Repo.js";

const branches = [
  "main",
  ...Array.from({ length: 48 }, (_, index) =>
    index % 3 === 0
      ? `feature/customer-dashboard-${index + 1}`
      : index % 3 === 1
        ? `fix/mobile-overflow-${index + 1}`
        : `release/2026-${String(index + 1).padStart(2, "0")}`,
  ),
];

const data: RepoHistory = {
  repo: "covallaby/covallaby",
  branch: "main",
  branches,
  history: [
    {
      id: 1,
      repo: "covallaby/covallaby",
      branch: "main",
      commit: "3bdb5b2a7a394b706fe43db58da3304b2d9ddb10",
      pr: null,
      linesCovered: 761,
      linesTotal: 1000,
      percent: 76.1,
      files: 19,
      createdAt: "2026-07-13T11:34:06Z",
    },
  ],
};

const meta = {
  title: "Pages/Repository header",
  parameters: { layout: "padded" },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const FortyNineBranches: Story = {
  render: () => (
    <MemoryRouter>
      <RepoHeader repo="covallaby/covallaby" data={data} />
    </MemoryRouter>
  ),
};
