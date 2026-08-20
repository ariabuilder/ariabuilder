import { describe, expect, it } from "vitest";
import {
  isSourceExpression,
  resolveSourceFields,
  unwrapSourceExpression,
} from "./sourceExpressions";

describe("source expressions", () => {
  it("unwraps template and Astro attribute expressions", () => {
    expect(unwrapSourceExpression("${umamiWebsiteId}")).toBe("umamiWebsiteId");
    expect(unwrapSourceExpression("{src}")).toBe("src");
    expect(unwrapSourceExpression("{`${umamiWebsiteId}`}")).toBe("umamiWebsiteId");
    expect(isSourceExpression("${src}")).toBe(true);
    expect(isSourceExpression("https://cloud.umami.is/script.js")).toBe(false);
  });

  it("resolves frontmatter string literals", () => {
    const source = `---
const umamiWebsiteId = "94db1cb1-74f4-4a40-ad6c-962362670409";
const src = "https://cloud.umami.is/script.js";
---
<script defer src="\${src}" data-website-id="\${umamiWebsiteId}"></script>
`;
    const resolved = resolveSourceFields(
      {
        websiteId: "${umamiWebsiteId}",
        scriptSrc: "${src}",
      },
      source,
    );
    expect(resolved.fields).toEqual({
      websiteId: "94db1cb1-74f4-4a40-ad6c-962362670409",
      scriptSrc: "https://cloud.umami.is/script.js",
    });
    expect(resolved.fieldMeta.websiteId?.ident).toBe("umamiWebsiteId");
    expect(resolved.fieldMeta.scriptSrc?.ident).toBe("src");
  });

  it("resolves import.meta.env keys from an env map", () => {
    const source = `---
const umamiWebsiteId = import.meta.env.PUBLIC_UMAMI_WEBSITE_ID;
const src = import.meta.env.PUBLIC_UMAMI_SRC ?? "https://cloud.umami.is/script.js";
---
`;
    const resolved = resolveSourceFields(
      {
        websiteId: "${umamiWebsiteId}",
        scriptSrc: "${src}",
      },
      source,
      {
        PUBLIC_UMAMI_WEBSITE_ID: "94db1cb1-74f4-4a40-ad6c-962362670409",
      },
    );
    expect(resolved.fields.websiteId).toBe("94db1cb1-74f4-4a40-ad6c-962362670409");
    expect(resolved.fields.scriptSrc).toBe("https://cloud.umami.is/script.js");
    expect(resolved.fieldMeta.websiteId?.envKey).toBe("PUBLIC_UMAMI_WEBSITE_ID");
  });
});
