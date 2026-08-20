import { describe, expect, it } from "vitest";
import {
  normalizeOpencodeCatalogModels,
  opencodeCatalogPlans,
} from "./opencodeProviders";

describe("OpenCode model catalogs", () => {
  it("uses only the selected OpenCode plan", () => {
    expect(opencodeCatalogPlans("go")).toEqual(["go"]);
    expect(opencodeCatalogPlans("zen")).toEqual(["zen"]);
    expect(opencodeCatalogPlans()).toEqual(["zen", "go"]);
  });

  it("normalizes Zen data responses", () => {
    expect(
      normalizeOpencodeCatalogModels("zen", {
        data: [{ id: "claude-sonnet-4", name: "Claude Sonnet 4" }],
      }),
    ).toEqual([
      {
        id: "opencode/claude-sonnet-4",
        name: "Claude Sonnet 4",
      },
    ]);
  });

  it("normalizes Go models responses and existing prefixes", () => {
    expect(
      normalizeOpencodeCatalogModels("go", {
        models: [
          "kimi-k2.5",
          { id: "opencode-go/minimax-m2.7", name: "MiniMax M2.7" },
        ],
      }),
    ).toEqual([
      { id: "opencode-go/kimi-k2.5", name: "kimi-k2.5" },
      { id: "opencode-go/minimax-m2.7", name: "MiniMax M2.7" },
    ]);
  });
});
