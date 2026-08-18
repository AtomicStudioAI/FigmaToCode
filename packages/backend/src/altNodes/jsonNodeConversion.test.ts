import { describe, expect, it } from "vitest";
import { hugSizingIsMeaningless } from "./jsonNodeConversion";

describe("hugSizingIsMeaningless", () => {
  it("is false for a TEXT node with no children — it hugs its own characters", () => {
    expect(hugSizingIsMeaningless({ type: "TEXT" })).toBe(false);
    expect(hugSizingIsMeaningless({ type: "TEXT", children: [] })).toBe(false);
  });

  it("is true for an empty non-text frame — nothing to hug around", () => {
    expect(hugSizingIsMeaningless({ type: "FRAME" })).toBe(true);
    expect(hugSizingIsMeaningless({ type: "FRAME", children: [] })).toBe(true);
  });

  it("is false for a non-text frame with children — hugs its child content", () => {
    expect(
      hugSizingIsMeaningless({ type: "FRAME", children: [{}] })
    ).toBe(false);
  });
});
