import { describe, expect, it } from "vitest";
import type { TestArtifact } from "../web/src/api.js";
import { buildPlaybackLibrary, shortJourneyName } from "../web/src/playback.js";

const artifact = (
  id: number,
  kind: TestArtifact["kind"],
  testName: string | null,
): TestArtifact => ({
  id,
  runId: 4,
  name: `${kind}-${id}`,
  kind,
  contentType: kind === "screenshot" ? "image/png" : "application/octet-stream",
  sizeBytes: 100,
  testName,
  createdAt: "2026-07-11T00:00:00Z",
  url: `/artifact/${id}`,
});

describe("playback library", () => {
  it("organizes named artifacts into journeys and leaves run-level files separate", () => {
    const library = buildPlaybackLibrary([
      artifact(1, "video", "flows › onboarding › activates a dashboard"),
      artifact(2, "screenshot", "flows › onboarding › activates a dashboard"),
      artifact(3, "trace", "flows › onboarding › activates a dashboard"),
      artifact(4, "report", null),
    ]);

    expect(library.journeys).toHaveLength(1);
    expect(library.journeys[0]).toMatchObject({
      name: "flows › onboarding › activates a dashboard",
      videos: [{ id: 1 }],
      screenshots: [{ id: 2 }],
      traces: [{ id: 3 }],
    });
    expect(library.runFiles).toMatchObject([{ id: 4 }]);
    expect(shortJourneyName(library.journeys[0]!.name)).toBe("activates a dashboard");
  });
});
