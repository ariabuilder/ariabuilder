import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { syncSeoInjection } from "@electron/seoInjection";
import { syncSnippetsInjection } from "@electron/snippetsInjection";

function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "aria-managed-middleware-"));
  mkdirSync(path.join(root, "src/pages"), { recursive: true });
  mkdirSync(path.join(root, "src/layouts"), { recursive: true });
  mkdirSync(path.join(root, "src/components"), { recursive: true });
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "managed-middleware", dependencies: { astro: "latest" } }),
  );
  writeFileSync(path.join(root, "src/pages/index.astro"), "---\n---\n<h1>Home</h1>\n");
  return root;
}

describe("Aria managed preview routes skip site middleware", () => {
  it("omits snippet and locale injection on /__aria authoring routes", () => {
    const root = fixture();
    syncSnippetsInjection(root);
    const middleware = readFileSync(
      path.join(root, "src", "aria", "snippets-middleware.ts"),
      "utf8",
    );
    expect(middleware).toContain("function isAriaManagedPath");
    expect(middleware).toContain('normalized.startsWith("/__aria/")');
    expect(middleware).toContain("if (isAriaManagedPath(pathname))");
  });

  it("omits SEO injection on /__aria authoring routes", async () => {
    const root = fixture();
    await syncSeoInjection(root, {
      siteName: "Test",
      siteDescription: "",
      siteUrl: "https://example.com",
      timeZone: "UTC",
      favicon: "",
      seoManagement: { status: "managed" },
    });
    const middleware = readFileSync(
      path.join(root, "src", "aria", "seo-middleware.ts"),
      "utf8",
    );
    expect(middleware).toContain("function isAriaManagedPath");
    expect(middleware).toContain('normalized.startsWith("/__aria/")');
    expect(middleware).toContain("if (isAriaManagedPath(pathname))");
  });
});
