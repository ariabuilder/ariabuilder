import { describe, expect, it, vi } from "vitest";
import { saveMediaVariantWithProfile } from "./media";

describe("media IPC payloads", () => {
  it("serializes reactive variant and profile values before invoking Electron", async () => {
    const saveVariantWithProfile = vi.fn<
      (projectPath: string, payload: unknown) => Promise<unknown>
    >(async () => ({ profile: {}, variant: {} }));
    vi.stubGlobal("window", {
      aria: {
        media: { saveVariantWithProfile },
      },
    });

    const variant = new Proxy(
      {
        id: "square",
        assetPath: "src/assets/portrait.webp",
        name: "Square",
        crop: new Proxy({ x: 0, y: 0, width: 1, height: 1 }, {}),
        focalPoint: new Proxy({ x: 0.5, y: 0.5 }, {}),
        aspectRatio: new Proxy({ width: 1, height: 1 }, {}),
        output: new Proxy(
          { width: 1600, height: 1600, format: "webp" as const, quality: 100 },
          {},
        ),
        bytes: new Uint8Array([1, 2, 3]),
      },
      {},
    );
    const profile = new Proxy(
      {
        assetPath: "src/assets/portrait.webp",
        altText: "Portrait",
        focalPoint: new Proxy({ x: 0.5, y: 0.5 }, {}),
      },
      {},
    );

    await saveMediaVariantWithProfile("/project", { variant, profile });

    const [, payload] = saveVariantWithProfile.mock.calls[0];
    expect(() => structuredClone(payload)).not.toThrow();
    expect(payload).toMatchObject({
      variant: {
        crop: { x: 0, y: 0, width: 1, height: 1 },
        focalPoint: { x: 0.5, y: 0.5 },
        aspectRatio: { width: 1, height: 1 },
        output: { width: 1600, height: 1600, format: "webp", quality: 100 },
        bytes: new Uint8Array([1, 2, 3]),
      },
      profile: {
        focalPoint: { x: 0.5, y: 0.5 },
      },
    });
  });
});
