import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { createVisualDiff, parseStoryCaptureMetadata } from "../src/storybook-diff.js";

function image(width: number, height: number, color: [number, number, number, number]) {
  const png = new PNG({ width, height });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data.set(color, index);
  }
  return PNG.sync.write(png);
}

describe("Storybook visual diffs", () => {
  it("parses capture fingerprints and supports legacy story names", () => {
    expect(
      parseStoryCaptureMetadata(
        JSON.stringify({
          id: "button--primary",
          title: "Button",
          name: "Primary",
          sha256: "a".repeat(64),
        }),
        "capture.png",
      ),
    ).toEqual({ id: "button--primary", title: "Button", name: "Primary", sha256: "a".repeat(64) });
    expect(parseStoryCaptureMetadata("button--legacy", "capture.png").id).toBe("button--legacy");
  });

  it("creates a viewable diff and reports changed pixels across different canvas sizes", () => {
    const result = createVisualDiff(image(2, 2, [0, 0, 0, 255]), image(3, 2, [255, 255, 255, 255]));
    const decoded = PNG.sync.read(Buffer.from(result.png));
    expect(decoded).toMatchObject({ width: 3, height: 2 });
    expect(result.changedPixels).toBeGreaterThan(0);
    expect(result.changeRatio).toBeGreaterThan(0);
  });

  it("reports no changes for identical images", () => {
    const bytes = image(2, 2, [25, 50, 75, 255]);
    expect(createVisualDiff(bytes, bytes)).toMatchObject({ changedPixels: 0, changeRatio: 0 });
  });
});
