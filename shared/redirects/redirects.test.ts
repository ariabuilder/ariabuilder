import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  buildNetlifyRedirects,
  flattenRedirectChainTarget,
  normalizeRedirectPath,
  normalizeTrailingSlashPath,
  parseRedirectCsv,
  pathsMatchForRedirect,
  resolveRedirectTarget,
  shouldSkipRedirectLookup,
  validateRedirectRule,
  type RedirectRule,
} from "./index";

function rule(
  partial: Partial<RedirectRule> &
    Pick<RedirectRule, "id" | "fromPath" | "toPath">,
): RedirectRule {
  return {
    statusCode: 301,
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("normalizeRedirectPath", () => {
  it("ensures leading slash without changing trailing slash", () => {
    assert.equal(normalizeRedirectPath("old"), "/old");
    assert.equal(normalizeRedirectPath("/old/"), "/old/");
    assert.equal(normalizeRedirectPath(""), "/");
  });
});

describe("normalizeTrailingSlashPath", () => {
  it("strips trailing slash under strip policy", () => {
    assert.equal(normalizeTrailingSlashPath("/about/", "strip"), "/about");
    assert.equal(normalizeTrailingSlashPath("/about", "strip"), null);
  });

  it("adds trailing slash under add policy", () => {
    assert.equal(normalizeTrailingSlashPath("/about", "add"), "/about/");
    assert.equal(normalizeTrailingSlashPath("/about/", "add"), null);
  });

  it("does nothing for none or root", () => {
    assert.equal(normalizeTrailingSlashPath("/about/", "none"), null);
    assert.equal(normalizeTrailingSlashPath("/", "strip"), null);
  });
});

describe("pathsMatchForRedirect / wildcards", () => {
  it("matches exact paths", () => {
    assert.equal(pathsMatchForRedirect("/old", "/old"), true);
    assert.equal(pathsMatchForRedirect("/old/", "/old"), false);
  });

  it("matches /blog/* but not /blog", () => {
    assert.equal(pathsMatchForRedirect("/blog/old-post", "/blog/*"), true);
    assert.equal(pathsMatchForRedirect("/blog", "/blog/*"), false);
  });

  it("resolves first enabled match with literal destination", () => {
    const rules = [
      rule({ id: "1", fromPath: "/blog/*", toPath: "/posts", enabled: false }),
      rule({ id: "2", fromPath: "/blog/*", toPath: "/articles" }),
    ];
    assert.deepEqual(resolveRedirectTarget(rules, "/blog/x"), {
      toPath: "/articles",
      statusCode: 301,
    });
  });
});

describe("validateRedirectRule", () => {
  const livePaths = new Set(["/", "/about", "/contact"]);

  it("blocks unsafe destinations", () => {
    const errors = validateRedirectRule(
      { fromPath: "/old", toPath: "https://evil.example", statusCode: 301, enabled: true },
      { existingRules: [], livePaths },
    );
    assert.ok(errors.some((e) => e.field === "toPath"));
  });

  it("blocks protected sources", () => {
    const errors = validateRedirectRule(
      { fromPath: "/_astro/x", toPath: "/about", statusCode: 301, enabled: true },
      { existingRules: [], livePaths },
    );
    assert.ok(errors.some((e) => e.field === "fromPath"));
  });

  it("allows / as destination", () => {
    const errors = validateRedirectRule(
      { fromPath: "/old", toPath: "/", statusCode: 301, enabled: true },
      { existingRules: [], livePaths },
    );
    assert.equal(errors.length, 0);
  });

  it("hard-blocks live fromPath without wildcard", () => {
    const errors = validateRedirectRule(
      { fromPath: "/about", toPath: "/contact", statusCode: 301, enabled: true },
      { existingRules: [], livePaths },
    );
    assert.ok(
      errors.some((e) =>
        e.message.includes("live page route"),
      ),
    );
  });

  it("allows wildcard fromPath that covers a live path segment", () => {
    const errors = validateRedirectRule(
      { fromPath: "/about/*", toPath: "/contact", statusCode: 301, enabled: true },
      { existingRules: [], livePaths },
    );
    assert.equal(errors.length, 0);
  });

  it("allowDisabledInvalid skips validation for disable-only", () => {
    const errors = validateRedirectRule(
      {
        fromPath: "/gone",
        toPath: "https://evil.example",
        statusCode: 301,
        enabled: false,
      },
      { existingRules: [], livePaths },
      { allowDisabledInvalid: true },
    );
    assert.equal(errors.length, 0);
  });

  it("still validates when enabling a stale target", () => {
    const errors = validateRedirectRule(
      {
        fromPath: "/gone",
        toPath: "https://evil.example",
        statusCode: 301,
        enabled: true,
      },
      { existingRules: [], livePaths },
      { allowDisabledInvalid: true },
    );
    assert.ok(errors.length > 0);
  });
});

describe("flattenRedirectChainTarget", () => {
  it("flattens A→B→C to C", () => {
    const rules = [
      rule({ id: "a", fromPath: "/a", toPath: "/b" }),
      rule({ id: "b", fromPath: "/b", toPath: "/c" }),
    ];
    assert.equal(flattenRedirectChainTarget("/a", rules), "/c");
  });

  it("returns final destination for a single hop; null on cycle", () => {
    const terminal = [rule({ id: "a", fromPath: "/a", toPath: "/about" })];
    assert.equal(flattenRedirectChainTarget("/a", terminal), "/about");

    const cycle = [
      rule({ id: "a", fromPath: "/a", toPath: "/b" }),
      rule({ id: "b", fromPath: "/b", toPath: "/a" }),
    ];
    assert.equal(flattenRedirectChainTarget("/a", cycle), null);
  });

  it("does not walk wildcards as chain hops", () => {
    const rules = [
      rule({ id: "a", fromPath: "/a", toPath: "/blog/old" }),
      rule({ id: "w", fromPath: "/blog/*", toPath: "/posts" }),
    ];
    // Stops at /blog/old — does not continue via /blog/* → /posts
    assert.equal(flattenRedirectChainTarget("/a", rules), "/blog/old");
  });
});

describe("parseRedirectCsv", () => {
  it("parses rows and skips comments", () => {
    const result = parseRedirectCsv(
      `# comment\n/old,/about\n/temp,/contact,302\n`,
    );
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0]?.statusCode, 301);
    assert.equal(result.rows[1]?.statusCode, 302);
    assert.equal(result.skipped, 0);
  });

  it("records invalid status and malformed lines", () => {
    const result = parseRedirectCsv(`/a\n/b,/c,999`);
    assert.equal(result.rows.length, 0);
    assert.equal(result.skipped, 2);
    assert.equal(result.errors.length, 2);
  });
});

describe("buildNetlifyRedirects", () => {
  it("emits enabled rules only", () => {
    const out = buildNetlifyRedirects([
      rule({ id: "1", fromPath: "/a", toPath: "/b", enabled: false }),
      rule({ id: "2", fromPath: "/c", toPath: "/d", statusCode: 302 }),
    ]);
    assert.equal(out, "/c /d 302\n");
  });
});

describe("shouldSkipRedirectLookup", () => {
  it("skips /api and /api/* but not /apiculture", () => {
    assert.equal(shouldSkipRedirectLookup("/api"), true);
    assert.equal(shouldSkipRedirectLookup("/api/foo"), true);
    assert.equal(shouldSkipRedirectLookup("/apiculture"), false);
  });

  it("skips numbered sitemaps", () => {
    assert.equal(shouldSkipRedirectLookup("/sitemap-2.xml"), true);
  });
});
