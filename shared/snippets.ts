import type { CodeSnippet, CodeSnippetPlacement } from "./types";

export type SnippetSlots = {
  header: string;
  body: string;
  footer: string;
};

const EMPTY_SLOTS: SnippetSlots = {
  header: "",
  body: "",
  footer: "",
};

/**
 * Compile enabled site snippets into Header/Body/Footer HTML blobs.
 * Preserves array order within each placement. Disabled / empty code omitted.
 */
export function compileSnippetSlots(
  snippets: CodeSnippet[] | undefined,
): SnippetSlots {
  if (!snippets || snippets.length === 0) return { ...EMPTY_SLOTS };

  const buckets: Record<CodeSnippetPlacement, string[]> = {
    header: [],
    body: [],
    footer: [],
  };

  for (const snippet of snippets) {
    if (!snippet || snippet.enabled === false) continue;
    const code = typeof snippet.code === "string" ? snippet.code.trim() : "";
    if (!code) continue;
    if (
      snippet.placement !== "header" &&
      snippet.placement !== "body" &&
      snippet.placement !== "footer"
    ) {
      continue;
    }
    buckets[snippet.placement].push(snippet.code);
  }

  return {
    header: buckets.header.join("\n"),
    body: buckets.body.join("\n"),
    footer: buckets.footer.join("\n"),
  };
}

/**
 * Inject compiled snippet slots into a full HTML document string.
 * Header → before `</head>`; body → after `<body…>`; footer → before `</body>`.
 */
export function injectSnippetHtml(html: string, slots: SnippetSlots): string {
  let out = html;
  if (slots.header) {
    const headClose = out.search(/<\/head>/i);
    if (headClose >= 0) {
      out =
        out.slice(0, headClose) +
        `${slots.header}\n` +
        out.slice(headClose);
    }
  }
  if (slots.body) {
    const bodyOpen = out.match(/<body\b[^>]*>/i);
    if (bodyOpen && bodyOpen.index !== undefined) {
      const insertAt = bodyOpen.index + bodyOpen[0].length;
      out =
        out.slice(0, insertAt) + `\n${slots.body}` + out.slice(insertAt);
    }
  }
  if (slots.footer) {
    const bodyClose = out.search(/<\/body>/i);
    if (bodyClose >= 0) {
      out =
        out.slice(0, bodyClose) +
        `${slots.footer}\n` +
        out.slice(bodyClose);
    }
  }
  return out;
}
