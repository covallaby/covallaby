import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  BranchTag,
  Card,
  CardFooter,
  CardHeader,
  DeltaChip,
  Meter,
  Pct,
  Stat,
  Td,
  Th,
} from "./ui.js";

const meta = {
  title: "Design system/Dashboard primitives",
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const CoverageHealth: Story = {
  render: () => (
    <Card>
      <CardHeader
        title="Coverage health"
        description="The complete semantic color range used throughout Covallaby."
      />
      <div className="grid gap-5 px-5 pb-5 sm:grid-cols-2">
        {[
          ["Excellent", 96.4],
          ["Healthy", 83.2],
          ["Needs attention", 67.5],
          ["At risk", 42.1],
        ].map(([label, value]) => (
          <div key={label}>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span>{label}</span>
              <Pct percent={Number(value)} />
            </div>
            <Meter percent={Number(value)} label={`${label} coverage`} />
          </div>
        ))}
      </div>
      <CardFooter>Colors communicate status consistently in light and dark themes.</CardFooter>
    </Card>
  ),
};

export const RepositorySummary: Story = {
  render: () => (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card className="p-5">
        <div className="grid grid-cols-2 gap-5">
          <Stat value={<span className="text-(--good)">88.7%</span>} label="Line coverage" />
          <Stat value="142" label="Files measured" />
          <Stat value={<DeltaChip current={88.7} previous={86.2} />} label="Since previous" />
          <Stat value={<BranchTag branch="main" />} label="Current branch" />
        </div>
      </Card>
      <Card className="p-5">
        <div className="grid grid-cols-2 gap-5">
          <Stat value={<span className="text-(--warn)">72.4%</span>} label="Patch coverage" />
          <Stat value="9" label="Changed files" />
          <Stat value={<DeltaChip current={72.4} previous={79.1} />} label="Since previous" />
          <Stat value={<BranchTag branch="feature/previews" pr={24} />} label="Pull request" />
        </div>
      </Card>
    </div>
  ),
};

export const DataTable: Story = {
  render: () => (
    <Card>
      <CardHeader title="Recent uploads" description="Dense data remains calm and scannable." />
      <table className="w-full text-[13.5px]">
        <thead>
          <tr>
            <Th>Repository</Th>
            <Th>Branch</Th>
            <Th right>Coverage</Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Td>covallaby/action</Td>
            <Td>
              <BranchTag branch="main" />
            </Td>
            <Td className="text-right">
              <Pct percent={91.2} />
            </Td>
          </tr>
          <tr>
            <Td>covallaby/covallaby</Td>
            <Td>
              <BranchTag branch="storybook-dogfood" pr={7} />
            </Td>
            <Td className="text-right">
              <Pct percent={79.8} />
            </Td>
          </tr>
        </tbody>
      </table>
    </Card>
  ),
};

export const EmptyState: Story = {
  render: () => (
    <Card>
      <CardHeader
        title="Storybook previews"
        description="Explore the exact component library built by CI."
      />
      <div className="px-5 pb-6 text-sm text-(--muted)">
        No previews yet. Upload a Storybook build with the Covallaby Action to publish the first
        one.
      </div>
    </Card>
  ),
};
