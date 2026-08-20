import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { omitSourceBackedInjections } from "@electron/injectionDedupe";
import { scanInjectionSources } from "@electron/injectionSourceScan";
import { updateSourceInjection } from "@electron/injectionSourceWrite";
import { mergeInjectionSlots, syncSnippetsInjection } from "@electron/snippetsInjection";

const GTM_HEAD = `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-ABC123');</script>`;
const GTM_NOSCRIPT = `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-ABC123" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`;
const PLAUSIBLE = `<script defer data-domain="example.com" src="https://plausible.io/js/script.js"></script>`;
const INTERCOM = `<script src="https://widget.intercom.io/widget/abc"></script>`;

function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "aria-injection-scan-"));
  mkdirSync(path.join(root, "src/pages"), { recursive: true });
  mkdirSync(path.join(root, "src/layouts"), { recursive: true });
  mkdirSync(path.join(root, "src/components"), { recursive: true });
  mkdirSync(path.join(root, "src/aria"), { recursive: true });
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "injection-scan", dependencies: { astro: "latest" } }),
  );
  writeFileSync(path.join(root, "src/pages/index.astro"), "---\n---\n<h1>Home</h1>\n");
  return root;
}

function writeLayout(root: string, body: string): void {
  writeFileSync(
    path.join(root, "src/layouts/Base.astro"),
    `---
---
<html>
  <head>
    ${body}
  </head>
  <body>
    <slot />
  </body>
</html>
`,
  );
}

describe("injection source scan", () => {
  it("finds layout GTM plus noscript as one analytics item", () => {
    const root = fixture();
    writeFileSync(
      path.join(root, "src/layouts/Base.astro"),
      `---
---
<html>
  <head>
    ${GTM_HEAD}
  </head>
  <body>
    ${GTM_NOSCRIPT}
    <slot />
  </body>
</html>
`,
    );

    const scan = scanInjectionSources(root);
    expect(scan.analytics).toHaveLength(1);
    expect(scan.analytics[0]).toMatchObject({
      kind: "analytics",
      providerId: "google-tag-manager",
      fields: { containerId: "GTM-ABC123" },
      file: "src/layouts/Base.astro",
      enabled: true,
    });
    expect(scan.analytics[0]?.spans).toHaveLength(2);
    expect(scan.targetLayout).toBe("src/layouts/Base.astro");
  });

  it("finds Plausible in a layout", () => {
    const root = fixture();
    writeLayout(root, PLAUSIBLE);
    const scan = scanInjectionSources(root);
    expect(scan.analytics).toHaveLength(1);
    expect(scan.analytics[0]).toMatchObject({
      providerId: "plausible",
      fields: { domain: "example.com" },
      placement: "header",
    });
  });

  it("resolves Umami fields from frontmatter expressions", () => {
    const root = fixture();
    writeFileSync(
      path.join(root, "src/layouts/Layout.astro"),
      `---
const umamiWebsiteId = "94db1cb1-74f4-4a40-ad6c-962362670409";
const src = "https://cloud.umami.is/script.js";
---
<html>
  <head>
    <script defer src="\${src}" data-website-id="\${umamiWebsiteId}"></script>
  </head>
  <body>
    <slot />
  </body>
</html>
`,
    );
    const scan = scanInjectionSources(root);
    expect(scan.analytics).toHaveLength(1);
    expect(scan.analytics[0]).toMatchObject({
      providerId: "umami",
      fields: {
        websiteId: "94db1cb1-74f4-4a40-ad6c-962362670409",
        scriptSrc: "https://cloud.umami.is/script.js",
      },
    });
  });

  it("classifies unknown Intercom widgets as snippets in the header", () => {
    const root = fixture();
    writeLayout(root, INTERCOM);
    const scan = scanInjectionSources(root);
    expect(scan.analytics).toHaveLength(0);
    expect(scan.snippets).toHaveLength(1);
    expect(scan.snippets[0]).toMatchObject({
      kind: "snippet",
      placement: "header",
      file: "src/layouts/Base.astro",
    });
    expect(scan.snippets[0]?.rawHtml).toContain("widget.intercom.io");
  });

  it("ignores bundled component module scripts", () => {
    const root = fixture();
    writeFileSync(
      path.join(root, "src/components/Counter.astro"),
      `---
---
<button>Hi</button>
<script>
  import { setup } from "./setup";
  setup();
</script>
`,
    );
    const scan = scanInjectionSources(root);
    expect(scan.snippets).toHaveLength(0);
    expect(scan.analytics).toHaveLength(0);
  });

  it("ignores JSON-LD scripts", () => {
    const root = fixture();
    writeLayout(
      root,
      `<script type="application/ld+json">{"@type":"WebSite"}</script>`,
    );
    const scan = scanInjectionSources(root);
    expect(scan.snippets).toHaveLength(0);
    expect(scan.analytics).toHaveLength(0);
  });

  it("ignores scripts under src/aria", () => {
    const root = fixture();
    writeFileSync(
      path.join(root, "src/aria/snippets.generated.ts"),
      `export const ariaSnippetSlots = { header: '<script src="https://evil.example/x.js"></script>', body: '', footer: '' };\n`,
    );
    const scan = scanInjectionSources(root);
    expect(scan.snippets).toHaveLength(0);
    expect(scan.analytics).toHaveLength(0);
  });
});

describe("injection source write-back", () => {
  it("wraps and unwraps a snippet without dropping it from the scan", () => {
    const root = fixture();
    writeLayout(root, INTERCOM);
    const before = scanInjectionSources(root);
    const id = before.snippets[0]?.id;
    expect(id).toBeTruthy();

    updateSourceInjection(root, { op: "setEnabled", id: id!, enabled: false });
    const disabled = scanInjectionSources(root);
    expect(disabled.snippets[0]?.enabled).toBe(false);
    expect(readFileSync(path.join(root, "src/layouts/Base.astro"), "utf8")).toContain(
      "aria:injection-disabled-begin",
    );

    updateSourceInjection(root, { op: "setEnabled", id: disabled.snippets[0]!.id, enabled: true });
    const enabled = scanInjectionSources(root);
    expect(enabled.snippets[0]?.enabled).toBe(true);
    expect(readFileSync(path.join(root, "src/layouts/Base.astro"), "utf8")).not.toContain(
      "aria:injection-disabled-begin",
    );
  });

  it("deletes both GTM spans together", () => {
    const root = fixture();
    writeFileSync(
      path.join(root, "src/layouts/Base.astro"),
      `---
---
<html>
  <head>
    ${GTM_HEAD}
  </head>
  <body>
    ${GTM_NOSCRIPT}
    <slot />
  </body>
</html>
`,
    );
    const scan = scanInjectionSources(root);
    updateSourceInjection(root, { op: "delete", id: scan.analytics[0]!.id });
    const after = readFileSync(path.join(root, "src/layouts/Base.astro"), "utf8");
    expect(after).not.toContain("GTM-ABC123");
    expect(scanInjectionSources(root).analytics).toHaveLength(0);
  });

  it("substitutes a GTM container id in place", () => {
    const root = fixture();
    writeLayout(root, GTM_HEAD);
    const scan = scanInjectionSources(root);
    updateSourceInjection(root, {
      op: "edit",
      id: scan.analytics[0]!.id,
      fields: { containerId: "GTM-XYZ999" },
    });
    const after = readFileSync(path.join(root, "src/layouts/Base.astro"), "utf8");
    expect(after).toContain("GTM-XYZ999");
    expect(after).not.toContain("GTM-ABC123");
    expect(scanInjectionSources(root).analytics[0]?.fields?.containerId).toBe("GTM-XYZ999");
  });

  it("inserts a new snippet into the target layout", () => {
    const root = fixture();
    writeLayout(root, "");
    const result = updateSourceInjection(root, {
      op: "addSnippet",
      name: "Chat",
      placement: "header",
      code: INTERCOM,
    });
    expect(result.usedMiddleware).toBeFalsy();
    expect(result.scan.snippets).toHaveLength(1);
    const source = readFileSync(path.join(root, "src/layouts/Base.astro"), "utf8");
    expect(source).toContain("widget.intercom.io");
    expect(source).toContain("aria:snippet-name: Chat");
  });

  it("falls back to middleware when the project has no layout", () => {
    const root = fixture();
    const result = updateSourceInjection(root, {
      op: "addSnippet",
      name: "Chat",
      placement: "header",
      code: INTERCOM,
    });
    expect(result.usedMiddleware).toBe(true);
    expect(result.settings?.snippets?.some((item) => item.code.includes("widget.intercom.io"))).toBe(true);
  });
});

describe("middleware omits source-backed providers", () => {
  it("skips compiling a provider that already exists in source", () => {
    const root = fixture();
    writeLayout(root, GTM_HEAD);
    const scan = scanInjectionSources(root);
    const omitted = omitSourceBackedInjections(
      [],
      {
        version: 1,
        activeProviders: ["google-tag-manager"],
        providers: { "google-tag-manager": { containerId: "GTM-SETTINGS" } },
      },
      scan,
    );
    expect(omitted.analytics?.activeProviders).toEqual([]);
    const slots = mergeInjectionSlots(omitted.snippets, omitted.analytics);
    expect(slots.header).not.toContain("GTM-SETTINGS");
    expect(slots.header).not.toContain("GTM-ABC123");
  });

  it("does not bake source GTM into generated middleware slots", () => {
    const root = fixture();
    writeLayout(root, GTM_HEAD);
    syncSnippetsInjection(
      root,
      [],
      {
        version: 1,
        activeProviders: ["google-tag-manager"],
        providers: { "google-tag-manager": { containerId: "GTM-SETTINGS" } },
      },
    );
    const generated = readFileSync(
      path.join(root, "src", "aria", "snippets.generated.ts"),
      "utf8",
    );
    expect(generated).not.toContain("GTM-SETTINGS");
    expect(generated).not.toContain("GTM-ABC123");
  });
});
