import { describe, expect, it } from "vitest";
import { prioritizeWarmQueue } from "./warmQueue";

describe("prioritizeWarmQueue", () => {
  it("moves requested ids to the front in the given order", () => {
    const pending = [
      { id: "src/components/A.astro" },
      { id: "src/components/B.astro" },
      { id: "src/components/C.astro" },
      { id: "src/components/D.astro" },
    ];
    expect(
      prioritizeWarmQueue(pending, [
        "src/components/C.astro",
        "src/components/A.astro",
      ]).map((item) => item.id),
    ).toEqual([
      "src/components/C.astro",
      "src/components/A.astro",
      "src/components/B.astro",
      "src/components/D.astro",
    ]);
  });

  it("ignores unknown ids and leaves the queue unchanged when none match", () => {
    const pending = [
      { id: "src/components/A.astro", mtimeMs: 1 },
      { id: "src/components/B.astro", mtimeMs: 2 },
    ];
    expect(prioritizeWarmQueue(pending, ["src/components/Z.astro"])).toEqual(pending);
    expect(prioritizeWarmQueue(pending, [])).toEqual(pending);
  });
});
