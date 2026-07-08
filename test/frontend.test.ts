import { describe, expect, it } from "vitest";
import { buildTree, type FileEntry } from "../web/src/components/explorer.js";
import { findNode, squarify } from "../web/src/components/treemap.js";

// Two top-level dirs so the root stays root; one branch is a collapsed chain.
const files: FileEntry[] = [
  { path: "src/main/java/com/App.java", covered: 8, total: 10, percent: 80, missing: "3, 7" },
  { path: "src/main/java/com/Util.java", covered: 5, total: 5, percent: 100, missing: "" },
  { path: "docs/guide.md", covered: 2, total: 2, percent: 100, missing: "" },
];

describe("findNode with collapsed chains", () => {
  const tree = buildTree(files);

  it("keeps root resolvable", () => {
    expect(findNode(tree, "").path).toBe("");
    expect(tree.children.length).toBeGreaterThan(1); // root not collapsed
  });

  it("resolves an interior segment of a collapsed chain instead of falling to root", () => {
    // 'src/main/java/com' collapses to one node; the breadcrumb offers 'src/main'.
    const node = findNode(tree, "src/main");
    expect(node).not.toBe(tree); // the bug returned root here
    expect(node.path.startsWith("src/main")).toBe(true);
  });

  it("resolves the collapsed node's own full path", () => {
    const node = findNode(tree, "src/main/java/com");
    expect(node.path).toBe("src/main/java/com");
  });
});

describe("squarify never produces non-finite rects", () => {
  it("handles many tiny items in a thin rect without Infinity", () => {
    const tree = buildTree(
      Array.from({ length: 40 }, (_, i) => ({
        path: `pkg/f${i}.ts`,
        covered: 1,
        total: 1 + (i % 3),
        percent: 100,
        missing: "",
      })),
    );
    const cells = squarify(tree.children, { x: 0, y: 0, w: 4, h: 900 });
    for (const c of cells) {
      expect(Number.isFinite(c.w) && Number.isFinite(c.h)).toBe(true);
      expect(c.w).toBeGreaterThanOrEqual(0);
      expect(c.h).toBeGreaterThanOrEqual(0);
    }
  });
});
