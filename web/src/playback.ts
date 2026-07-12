import type { TestArtifact } from "./api.js";

export interface PlaybackJourney {
  name: string;
  artifacts: TestArtifact[];
  screenshots: TestArtifact[];
  videos: TestArtifact[];
  traces: TestArtifact[];
  files: TestArtifact[];
}

export interface PlaybackLibrary {
  journeys: PlaybackJourney[];
  runFiles: TestArtifact[];
}

export function buildPlaybackLibrary(artifacts: TestArtifact[]): PlaybackLibrary {
  const grouped = new Map<string, TestArtifact[]>();
  const runFiles: TestArtifact[] = [];
  for (const artifact of artifacts) {
    if (!artifact.testName) {
      runFiles.push(artifact);
      continue;
    }
    const group = grouped.get(artifact.testName);
    if (group) group.push(artifact);
    else grouped.set(artifact.testName, [artifact]);
  }
  const journeys = [...grouped.entries()].map(([name, entries]) => ({
    name,
    artifacts: entries,
    screenshots: entries.filter((artifact) => artifact.kind === "screenshot"),
    videos: entries.filter((artifact) => artifact.kind === "video"),
    traces: entries.filter((artifact) => artifact.kind === "trace"),
    files: entries.filter((artifact) => !["screenshot", "video", "trace"].includes(artifact.kind)),
  }));
  return { journeys, runFiles };
}

export function shortJourneyName(name: string): string {
  return name.split(" › ").at(-1) ?? name;
}
