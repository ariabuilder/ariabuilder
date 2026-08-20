import type { RedirectStatusCode } from "./schemas";

export type ParsedRedirectCsvRow = {
  fromPath: string;
  toPath: string;
  statusCode: RedirectStatusCode;
  lineNumber: number;
};

export type ParseRedirectCsvResult = {
  rows: ParsedRedirectCsvRow[];
  errors: string[];
  skipped: number;
};

/**
 * Parse `from,to[,status]` lines. `#` comments and blank lines skipped.
 * No quoting / no header detection (demo semantics).
 */
export function parseRedirectCsv(csv: string): ParseRedirectCsvResult {
  const lines = csv.split(/\r?\n/u);
  const rows: ParsedRedirectCsvRow[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const lineNumber = index + 1;
    const parts = line.split(",").map((part) => part.trim());
    const fromPath = parts[0];
    const toPath = parts[1];
    const statusCodeRaw = parts[2];

    if (!fromPath || !toPath) {
      errors.push(`Line ${lineNumber}: expected from,to[,status]`);
      skipped += 1;
      continue;
    }

    const statusCode: RedirectStatusCode | null =
      statusCodeRaw === "302"
        ? 302
        : statusCodeRaw === "301" || !statusCodeRaw
          ? 301
          : null;

    if (statusCode === null) {
      errors.push(`Line ${lineNumber}: invalid status code`);
      skipped += 1;
      continue;
    }

    rows.push({ fromPath, toPath, statusCode, lineNumber });
  }

  return { rows, errors, skipped };
}
