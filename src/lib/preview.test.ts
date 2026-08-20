import { describe, expect, it } from "vitest";
import { previewPageUrl, previewWindowMatchesOrigin } from "./preview";

describe("previewPageUrl", () => {
  it("tags only Composer design-mode requests for middleware bypass", () => {
    expect(
      previewPageUrl("http://127.0.0.1:4321/", "/protected", {
        designMode: true,
      }),
    ).toBe("http://127.0.0.1:4321/protected?aria-design=1#aria-design");

    expect(previewPageUrl("http://127.0.0.1:4321/", "/protected")).toBe(
      "http://127.0.0.1:4321/protected",
    );
  });
});

describe("previewWindowMatchesOrigin", () => {
  it("rejects the host about:blank window for a preview target origin", () => {
    const win = { location: { origin: "http://127.0.0.1:59774" } } as Window;
    expect(previewWindowMatchesOrigin(win, "http://127.0.0.1:4324")).toBe(false);
  });

  it("accepts a window whose origin already matches", () => {
    const origin = "http://127.0.0.1:4324";
    const win = { location: { origin } } as Window;
    expect(previewWindowMatchesOrigin(win, origin)).toBe(true);
  });

  it("accepts a cross-origin window that hides location", () => {
    const win = {
      get location() {
        throw new DOMException("Blocked", "SecurityError");
      },
    } as unknown as Window;
    expect(previewWindowMatchesOrigin(win, "http://127.0.0.1:4324")).toBe(true);
  });
});
