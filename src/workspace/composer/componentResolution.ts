export type ComposerComponentCandidate = {
  name: string;
  file: string;
  kind: "component" | "layout";
};

export type ComposerComponentFallbackResolution =
  | {
      status: "resolved";
      candidate: ComposerComponentCandidate;
      method: "import-suffix" | "name";
    }
  | {
      status: "ambiguous";
      candidates: ComposerComponentCandidate[];
    }
  | {
      status: "unresolved";
      candidates: [];
    };

function withoutAstroExtension(value: string): string {
  return value.replace(/\.astro$/i, "");
}

function normalizedImportSuffix(
  importSpec: string | null | undefined,
): string | null {
  const cleaned = (importSpec ?? "")
    .replace(/[?#].*$/, "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  if (!cleaned) return null;

  const segments = cleaned
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..");
  if (segments[0]?.startsWith("@") || segments[0]?.startsWith("~")) {
    segments.shift();
  }
  if (segments.length < 2) return null;
  return withoutAstroExtension(segments.join("/"));
}

function uniqueCandidates(
  candidates: readonly ComposerComponentCandidate[],
): ComposerComponentCandidate[] {
  return [
    ...new Map(
      candidates.map((candidate) => [candidate.file, candidate]),
    ).values(),
  ];
}

function fromMatches(
  matches: ComposerComponentCandidate[],
  method: "import-suffix" | "name",
): ComposerComponentFallbackResolution {
  const unique = uniqueCandidates(matches);
  if (unique.length === 1) {
    return { status: "resolved", candidate: unique[0]!, method };
  }
  if (unique.length > 1) {
    return { status: "ambiguous", candidates: unique };
  }
  return { status: "unresolved", candidates: [] };
}

/**
 * Best-effort fallback after exact import resolution fails. Never picks an
 * arbitrary same-named component: every fallback must identify one file.
 */
export function resolveComposerComponentFallback(input: {
  name: string;
  importSpec?: string | null;
  candidates: readonly ComposerComponentCandidate[];
}): ComposerComponentFallbackResolution {
  const suffix = normalizedImportSuffix(input.importSpec);
  if (suffix) {
    const suffixResult = fromMatches(
      input.candidates.filter((candidate) => {
        const file = withoutAstroExtension(candidate.file.replace(/\\/g, "/"));
        return file === suffix || file.endsWith(`/${suffix}`);
      }),
      "import-suffix",
    );
    if (suffixResult.status !== "unresolved") return suffixResult;
  }

  const nameResult = fromMatches(
    input.candidates.filter((candidate) => {
      const basename = candidate.file.split("/").at(-1) ?? "";
      return (
        candidate.name === input.name ||
        withoutAstroExtension(basename) === input.name
      );
    }),
    "name",
  );
  return nameResult;
}
