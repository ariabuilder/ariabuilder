import { z } from "zod";

const LOCALE_CODE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

function canonicalLocaleCode(value: string): string | null {
  try {
    return Intl.getCanonicalLocales(value)[0] ?? null;
  } catch {
    return null;
  }
}

/** Canonicalize a BCP-47 tag when possible; otherwise return the trimmed input. */
export function canonicalizeLocaleCode(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return canonicalLocaleCode(trimmed) ?? trimmed;
}

export function localeCodesEqual(left: string, right: string): boolean {
  if (left === right) return true;
  const canonicalLeft = canonicalizeLocaleCode(left);
  const canonicalRight = canonicalizeLocaleCode(right);
  return canonicalLeft.length > 0 && canonicalLeft === canonicalRight;
}

/** BCP-47 language tag (canonicalized when possible). */
export const LocaleCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .superRefine((value, context) => {
    if (!LOCALE_CODE_PATTERN.test(value) || !canonicalLocaleCode(value)) {
      context.addIssue({
        code: "custom",
        message: "Locale must be a valid BCP 47 language tag",
      });
    }
  })
  .transform((value) => canonicalLocaleCode(value) ?? value);

export type LocaleCode = z.infer<typeof LocaleCodeSchema>;
