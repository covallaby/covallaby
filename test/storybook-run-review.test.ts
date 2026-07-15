import { describe, expect, it } from "vitest";
import { deriveRunReviewState } from "../src/app.js";

const capture = (
  status: "changed" | "new" | "removed" | "unchanged" | "uncompared",
  review?: "pending" | "approved" | "rejected",
) => ({
  id: status,
  title: "Components/Button",
  name: status,
  imageUrl: "/capture.png",
  status,
  ...(review ? { review: { state: review } } : {}),
});

describe("deriveRunReviewState", () => {
  it("approves an empty review queue instead of leaving an unchanged PR pending", () => {
    expect(deriveRunReviewState([capture("unchanged"), capture("uncompared")])).toBe("approved");
  });

  it("keeps real changes pending until every reviewable capture is approved", () => {
    expect(deriveRunReviewState([capture("changed", "pending")])).toBe("pending");
    expect(deriveRunReviewState([capture("changed", "approved")])).toBe("approved");
    expect(deriveRunReviewState([capture("changed", "rejected")])).toBe("rejected");
  });
});
