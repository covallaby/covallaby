import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalArtifactStorage } from "../src/artifacts.js";

describe("local artifact storage", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  const storage = async () => {
    const dir = await mkdtemp(join(tmpdir(), "covallaby-artifacts-"));
    dirs.push(dir);
    return new LocalArtifactStorage(dir);
  };

  it("streams uploads and reads only the requested byte range", async () => {
    const store = await storage();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("0123"));
        controller.enqueue(new TextEncoder().encode("456789"));
        controller.close();
      },
    });
    await expect(store.putStream("runs/video.webm", body, 10)).resolves.toBe(true);
    expect(new TextDecoder().decode(await store.get("runs/video.webm", { start: 3, end: 6 }))).toBe(
      "3456",
    );
  });

  it("rejects and removes streams that do not match the manifest size", async () => {
    const store = await storage();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("too large"));
        controller.close();
      },
    });
    await expect(store.putStream("runs/bad.webm", body, 3)).resolves.toBe(false);
    await expect(store.exists("runs/bad.webm", 3)).resolves.toBe(false);
  });
});
