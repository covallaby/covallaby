import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface StoryCaptureMetadata {
  id: string;
  title: string;
  name: string;
  path?: string;
  sha256?: string;
}

export function parseStoryCaptureMetadata(
  value: string | null,
  fallback: string,
): StoryCaptureMetadata {
  try {
    const parsed = JSON.parse(value ?? "{}") as Partial<StoryCaptureMetadata>;
    return {
      id: parsed.id || fallback,
      title: parsed.title || "Component",
      name: parsed.name || parsed.id || fallback,
      ...(parsed.path && { path: parsed.path }),
      ...(typeof parsed.sha256 === "string" && /^[a-f0-9]{64}$/i.test(parsed.sha256)
        ? { sha256: parsed.sha256.toLowerCase() }
        : {}),
    };
  } catch {
    return { id: value || fallback, title: "Component", name: value || fallback };
  }
}

function place(source: PNG, width: number, height: number): PNG {
  if (source.width === width && source.height === height) return source;
  const canvas = new PNG({ width, height, fill: true });
  PNG.bitblt(source, canvas, 0, 0, source.width, source.height, 0, 0);
  return canvas;
}

export function createVisualDiff(
  baselineBytes: Uint8Array,
  currentBytes: Uint8Array,
  threshold = 0.1,
): { png: Uint8Array; changedPixels: number; totalPixels: number; changeRatio: number } {
  const baselineSource = PNG.sync.read(Buffer.from(baselineBytes));
  const currentSource = PNG.sync.read(Buffer.from(currentBytes));
  const width = Math.max(baselineSource.width, currentSource.width);
  const height = Math.max(baselineSource.height, currentSource.height);
  const baseline = place(baselineSource, width, height);
  const current = place(currentSource, width, height);
  const diff = new PNG({ width, height });
  const changedPixels = pixelmatch(baseline.data, current.data, diff.data, width, height, {
    threshold,
    alpha: 0.35,
    diffColor: [255, 47, 146],
    aaColor: [255, 180, 0],
  });
  const totalPixels = width * height;
  return {
    png: PNG.sync.write(diff),
    changedPixels,
    totalPixels,
    changeRatio: totalPixels === 0 ? 0 : changedPixels / totalPixels,
  };
}
