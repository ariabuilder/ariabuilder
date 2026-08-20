import { describe, expect, it } from "vitest";
import { classifyInjectionHtml } from "./fingerprints";

describe("classifyInjectionHtml", () => {
  it("classifies Google Tag Manager with a container id", () => {
    const html =
      `<script>(function(w,d,s,l,i){w[l]=w[l]||[];j.src='https://www.googletagmanager.com/gtm.js?id='+i;})(window,document,'script','dataLayer','GTM-ABC123');</script>`;
    expect(classifyInjectionHtml(html)).toEqual({
      kind: "analytics",
      providerId: "google-tag-manager",
      fields: { containerId: "GTM-ABC123" },
    });
  });

  it("classifies Plausible with domain and script src", () => {
    const html =
      `<script defer data-domain="example.com" src="https://plausible.io/js/script.js"></script>`;
    expect(classifyInjectionHtml(html)).toEqual({
      kind: "analytics",
      providerId: "plausible",
      fields: {
        domain: "example.com",
        scriptSrc: "https://plausible.io/js/script.js",
      },
    });
  });

  it("keeps GTM-looking scripts without a container id as snippets", () => {
    const html = `<script src="https://www.googletagmanager.com/gtm.js"></script>`;
    expect(classifyInjectionHtml(html)).toEqual({ kind: "snippet" });
  });

  it("classifies unknown third-party widgets as snippets", () => {
    const html = `<script src="https://widget.intercom.io/widget/abc"></script>`;
    expect(classifyInjectionHtml(html)).toEqual({ kind: "snippet" });
  });

  it("does not classify GA4 as GTM", () => {
    const html =
      `<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABCDEF123"></script>`;
    expect(classifyInjectionHtml(html)).toEqual({
      kind: "analytics",
      providerId: "google-analytics",
      fields: { measurementId: "G-ABCDEF123" },
    });
  });
});
