import { describe, expect, it } from "vitest";
import {
  handlePreviewFrameHeaders,
  isLoopbackPreviewUrl,
  shouldAllowWindowRedirect,
  softenPreviewFrameHeaders,
  stripFrameAncestorsFromCsp,
} from "./previewFramePolicy";

describe("previewFramePolicy", () => {
  it("recognizes loopback preview hosts only", () => {
    expect(isLoopbackPreviewUrl("http://127.0.0.1:4321/")).toBe(true);
    expect(isLoopbackPreviewUrl("http://localhost:4321/about")).toBe(true);
    expect(isLoopbackPreviewUrl("http://[::1]:4321/")).toBe(true);
    expect(isLoopbackPreviewUrl("https://127.0.0.1:4321/")).toBe(false);
    expect(isLoopbackPreviewUrl("http://example.com/")).toBe(false);
  });

  it("allows main-frame redirects only when the app URL is trusted", () => {
    expect(shouldAllowWindowRedirect({
      isMainFrame: true,
      destinationUrl: "http://127.0.0.1:4321/auth",
      trustedMainFrameUrl: true,
      activePreviewUrls: [],
    })).toBe(true);
    expect(shouldAllowWindowRedirect({
      isMainFrame: true,
      destinationUrl: "http://127.0.0.1:4321/auth",
      trustedMainFrameUrl: false,
      activePreviewUrls: ["http://127.0.0.1:4321"],
    })).toBe(false);
  });

  it("allows subframe redirects only on an active preview origin", () => {
    const activePreviewUrls = ["http://127.0.0.1:4321"];
    expect(shouldAllowWindowRedirect({
      isMainFrame: false,
      destinationUrl: "http://127.0.0.1:4321/auth",
      trustedMainFrameUrl: false,
      activePreviewUrls,
    })).toBe(true);
    expect(shouldAllowWindowRedirect({
      isMainFrame: false,
      destinationUrl: "http://127.0.0.1:4322/auth",
      trustedMainFrameUrl: false,
      activePreviewUrls,
    })).toBe(false);
    expect(shouldAllowWindowRedirect({
      isMainFrame: false,
      destinationUrl: "https://example.com/auth",
      trustedMainFrameUrl: false,
      activePreviewUrls,
    })).toBe(false);
  });

  it("strips frame-ancestors from CSP without touching other directives", () => {
    expect(
      stripFrameAncestorsFromCsp(
        "default-src 'self'; frame-ancestors 'none'; img-src *",
      ),
    ).toBe("default-src 'self'; img-src *");
    expect(stripFrameAncestorsFromCsp("frame-ancestors 'none'")).toBe("");
  });

  it("removes X-Frame-Options and CSP frame-ancestors for iframe embedding", () => {
    const softened = softenPreviewFrameHeaders({
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": [
        "default-src 'self'; frame-ancestors 'none'",
      ],
      "X-Content-Type-Options": "nosniff",
    });
    expect(softened["X-Frame-Options"]).toBeUndefined();
    expect(softened["Content-Security-Policy"]).toEqual(["default-src 'self'"]);
    expect(softened["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("adds UTF-8 to HTML documents without replacing explicit charsets", () => {
    expect(softenPreviewFrameHeaders({
      "Content-Type": "text/html",
    })["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(softenPreviewFrameHeaders({
      "content-type": "text/html; charset=iso-8859-1",
    })["content-type"]).toBe("text/html; charset=iso-8859-1");
    expect(softenPreviewFrameHeaders({
      "CONTENT-TYPE": ["text/html", "text/html; charset=UTF-8"],
    })["CONTENT-TYPE"]).toEqual([
      "text/html; charset=utf-8",
      "text/html; charset=UTF-8",
    ]);
  });

  it("does not add a charset to non-HTML responses", () => {
    const softened = softenPreviewFrameHeaders({
      "Content-Type": "application/json",
    });
    expect(softened["Content-Type"]).toBe("application/json");
  });

  it("softens only loopback subframe documents", () => {
    const calls: unknown[] = [];
    handlePreviewFrameHeaders(
      {
        url: "http://127.0.0.1:4321/",
        resourceType: "subFrame",
        responseHeaders: { "x-frame-options": ["DENY"] },
      },
      (response) => calls.push(response),
    );
    expect(calls).toEqual([
      { responseHeaders: {} },
    ]);

    calls.length = 0;
    const original = { "x-frame-options": ["DENY"] };
    handlePreviewFrameHeaders(
      {
        url: "http://127.0.0.1:4321/api",
        resourceType: "xhr",
        responseHeaders: original,
      },
      (response) => calls.push(response),
    );
    expect(calls).toEqual([{ responseHeaders: original }]);

    calls.length = 0;
    handlePreviewFrameHeaders(
      {
        url: "http://example.com/",
        resourceType: "subFrame",
        responseHeaders: { "content-type": "text/html" },
      },
      (response) => calls.push(response),
    );
    expect(calls).toEqual([{
      responseHeaders: { "content-type": "text/html" },
    }]);
  });
});
