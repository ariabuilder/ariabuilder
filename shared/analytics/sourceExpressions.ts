export type SourceFieldOrigin = {
  raw: string;
  ident?: string;
  envKey?: string;
};

const IDENT = "[A-Za-z_$][\\w]*";

export function isSourceExpression(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^\$\{[\s\S]+\}$/.test(trimmed)) return true;
  if (/^\{[\s\S]+\}$/.test(trimmed)) return true;
  if (/^`\$\{[\s\S]+\}$`/.test(trimmed)) return true;
  return /\$\{[A-Za-z_$][\w]*\}/.test(trimmed) && !/^https?:\/\//i.test(trimmed);
}

export function unwrapSourceExpression(value: string): string | null {
  const trimmed = value.trim();
  const patterns = [
    new RegExp(`^\\$\\{(${IDENT})\\}$`),
    new RegExp(`^\\{(${IDENT})\\}$`),
    new RegExp(`^\\{\`\\$\\{(${IDENT})\\}\`\\}$`),
    new RegExp(`^\`\\$\\{(${IDENT})\\}\`$`),
    new RegExp(`^\\{\`(${IDENT})\`\\}$`),
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return match[1];
  }
  const nested = trimmed.match(new RegExp(`\\$\\{(${IDENT})\\}`));
  return nested?.[1] ?? null;
}

function frontmatterBlock(source: string): string {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match?.[1] ?? "";
}

function escapeIdent(ident: string): string {
  return ident.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolve a frontmatter binding to a string literal and/or import.meta.env key.
 */
export function resolveFrontmatterBinding(
  source: string,
  ident: string,
): { literal?: string; envKey?: string } | null {
  const fm = frontmatterBlock(source);
  if (!fm) return null;
  const token = escapeIdent(ident);

  const envWithFallback = fm.match(
    new RegExp(
      `(?:const|let|var)\\s+${token}\\s*=\\s*import\\.meta\\.env\\.([A-Z0-9_]+)\\s*(?:\\?\\?|\\|\\|)\\s*(['"\`])([^'"\`]+)\\2`,
    ),
  );
  if (envWithFallback?.[1]) {
    return {
      envKey: envWithFallback[1],
      literal: envWithFallback[3],
    };
  }

  const envOnly = fm.match(
    new RegExp(
      `(?:const|let|var)\\s+${token}\\s*=\\s*import\\.meta\\.env\\.([A-Z0-9_]+)`,
    ),
  );
  if (envOnly?.[1]) return { envKey: envOnly[1] };

  const literal = fm.match(
    new RegExp(
      `(?:const|let|var)\\s+${token}\\s*=\\s*(['"\`])([^'"\`]+)\\1`,
    ),
  );
  if (literal?.[2]) return { literal: literal[2] };

  return null;
}

export function replaceFrontmatterLiteral(
  source: string,
  ident: string,
  next: string,
): string | null {
  const token = escapeIdent(ident);
  const pattern = new RegExp(
    `((?:const|let|var)\\s+${token}\\s*=\\s*)(['"\`])([^'"\`]*)\\2`,
  );
  if (!pattern.test(source)) return null;
  pattern.lastIndex = 0;
  return source.replace(pattern, `$1$2${next}$2`);
}

export function resolveSourceFieldValue(
  raw: string,
  source: string,
  env: Record<string, string>,
): { value: string; origin: SourceFieldOrigin } {
  const origin: SourceFieldOrigin = { raw };
  if (!isSourceExpression(raw)) {
    return { value: raw, origin };
  }
  const ident = unwrapSourceExpression(raw);
  if (!ident) return { value: raw, origin };
  origin.ident = ident;
  const binding = resolveFrontmatterBinding(source, ident);
  if (!binding) return { value: raw, origin };
  if (binding.envKey) {
    origin.envKey = binding.envKey;
    const fromEnv = env[binding.envKey]?.trim();
    if (fromEnv) return { value: fromEnv, origin };
  }
  if (binding.literal) return { value: binding.literal, origin };
  return { value: raw, origin };
}

export function resolveSourceFields(
  fields: Record<string, string>,
  source: string,
  env: Record<string, string> = {},
): {
  fields: Record<string, string>;
  fieldMeta: Record<string, SourceFieldOrigin>;
} {
  const resolved: Record<string, string> = {};
  const fieldMeta: Record<string, SourceFieldOrigin> = {};
  for (const [key, raw] of Object.entries(fields)) {
    const next = resolveSourceFieldValue(raw, source, env);
    resolved[key] = next.value;
    if (next.origin.ident || isSourceExpression(raw)) {
      fieldMeta[key] = next.origin;
    }
  }
  return { fields: resolved, fieldMeta };
}
