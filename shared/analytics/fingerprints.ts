import type { AnalyticsProviderId } from "../types";
import { ANALYTICS_PROVIDER_MAP } from "./providers";

export type ClassifiedInjection =
  | {
      kind: "analytics";
      providerId: AnalyticsProviderId;
      fields: Record<string, string>;
    }
  | {
      kind: "snippet";
    };

type ExtractedFields = Record<string, string>;

const IDENT = "[A-Za-z_$][\\w]*";

function attr(html: string, name: string): string | undefined {
  const quoted = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "i",
  );
  const quotedMatch = html.match(quoted);
  if (quotedMatch) {
    const value = quotedMatch[1] ?? quotedMatch[2];
    return value?.trim() || undefined;
  }
  const expr = new RegExp(`\\b${name}\\s*=\\s*\\{(${IDENT})\\}`, "i");
  const exprMatch = html.match(expr);
  if (exprMatch?.[1]) return `{${exprMatch[1]}}`;
  const unquoted = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i");
  const unquotedMatch = html.match(unquoted);
  return unquotedMatch?.[1]?.trim() || undefined;
}

function firstGroup(html: string, re: RegExp): string | undefined {
  const match = html.match(re);
  const value = match?.[1]?.trim();
  return value || undefined;
}

function extractPlausible(html: string): ExtractedFields {
  const fields: ExtractedFields = {};
  const domain = attr(html, "data-domain");
  if (domain) fields.domain = domain;
  const scriptSrc = attr(html, "src");
  if (scriptSrc) fields.scriptSrc = scriptSrc;
  return fields;
}

function extractFathom(html: string): ExtractedFields {
  const fields: ExtractedFields = {};
  const siteId = attr(html, "data-site");
  if (siteId) fields.siteId = siteId;
  const scriptSrc = attr(html, "src");
  if (scriptSrc) fields.scriptSrc = scriptSrc;
  return fields;
}

function extractSimpleAnalytics(html: string): ExtractedFields {
  const fields: ExtractedFields = {};
  const scriptSrc = attr(html, "src");
  if (scriptSrc) fields.scriptSrc = scriptSrc;
  return fields;
}

function extractMatomo(html: string): ExtractedFields {
  const fields: ExtractedFields = {};
  const siteId =
    firstGroup(html, /setSiteId['"]?\s*,\s*['"](\d+)['"]/i) ??
    firstGroup(html, /setSiteId['"]?\s*,\s*(\d+)/i);
  if (siteId) fields.siteId = siteId;
  const quotedBase = firstGroup(
    html,
    /(?:var\s+u\s*=\s*|u\s*=\s*)['"](https?:\/\/[^'"]+)['"]/i,
  );
  if (quotedBase) fields.baseUrl = quotedBase;
  return fields;
}

function extractUmami(html: string): ExtractedFields {
  const fields: ExtractedFields = {};
  const websiteId = attr(html, "data-website-id");
  if (websiteId) fields.websiteId = websiteId;
  const scriptSrc = attr(html, "src");
  if (scriptSrc) fields.scriptSrc = scriptSrc;
  const hostUrl = attr(html, "data-host-url");
  if (hostUrl) fields.hostUrl = hostUrl;
  return fields;
}

function extractTiktok(html: string): ExtractedFields {
  const fields: ExtractedFields = {};
  const pixelId =
    firstGroup(html, /ttq\.load\(\s*['"]([^'"]+)['"]/i) ??
    firstGroup(html, /sdkid=([0-9A-Za-z]+)/i);
  if (pixelId) fields.pixelId = pixelId;
  return fields;
}

function extractLinkedin(html: string): ExtractedFields {
  const fields: ExtractedFields = {};
  const partnerId =
    firstGroup(html, /_linkedin_partner_id\s*=\s*['"](\d+)['"]/i) ??
    firstGroup(html, /[?&]pid=(\d+)/i);
  if (partnerId) fields.partnerId = partnerId;
  return fields;
}

function extractMeta(html: string): ExtractedFields {
  const fields: ExtractedFields = {};
  const pixelId =
    firstGroup(html, /fbq\(\s*['"]init['"]\s*,\s*['"](\d+)['"]/i) ??
    firstGroup(html, /[?&]id=(\d{8,20})/i);
  if (pixelId) fields.pixelId = pixelId;
  return fields;
}

function extractGa(html: string): ExtractedFields {
  const fields: ExtractedFields = {};
  const measurementId =
    firstGroup(html, /gtag\/js\?id=(G-[A-Z0-9]+)/i) ??
    firstGroup(html, /gtag\(\s*['"]config['"]\s*,\s*['"](G-[A-Z0-9]+)['"]/i) ??
    firstGroup(html, /\b(G-[A-Z0-9]{6,})\b/);
  if (measurementId) fields.measurementId = measurementId.toUpperCase();
  return fields;
}

function extractGtm(html: string): ExtractedFields {
  const fields: ExtractedFields = {};
  const containerId = firstGroup(html, /\b(GTM-[A-Z0-9]+)\b/i);
  if (containerId) fields.containerId = containerId.toUpperCase();
  return fields;
}

function extractCloudflare(html: string): ExtractedFields {
  const fields: ExtractedFields = {};
  const token =
    firstGroup(html, /["']token["']\s*:\s*["']([0-9A-Za-z_-]{20,64})["']/) ??
    firstGroup(html, /data-cf-beacon=['"][^'"]*token["']?\s*[:=]\s*["']?([0-9A-Za-z_-]{20,64})/);
  if (token) fields.token = token;
  return fields;
}

type Fingerprint = {
  id: AnalyticsProviderId;
  match: (html: string) => boolean;
  extract: (html: string) => ExtractedFields;
};

/**
 * More specific matchers first so GTM is not classified as GA
 * (both live on googletagmanager.com).
 */
const FINGERPRINTS: readonly Fingerprint[] = [
  {
    id: "google-tag-manager",
    match: (html) =>
      /\bGTM-[A-Z0-9]+\b/i.test(html) ||
      /googletagmanager\.com\/gtm\.js/i.test(html) ||
      /googletagmanager\.com\/ns\.html/i.test(html),
    extract: extractGtm,
  },
  {
    id: "google-analytics",
    match: (html) =>
      /gtag\/js\?id=G-/i.test(html) ||
      /gtag\(\s*['"]config['"]\s*,\s*['"]G-/i.test(html) ||
      (/\bG-[A-Z0-9]{6,}\b/.test(html) &&
        /googletagmanager\.com|google-analytics\.com|gtag\s*\(/i.test(html)),
    extract: extractGa,
  },
  {
    id: "meta-pixel",
    match: (html) =>
      /\bfbq\s*\(/i.test(html) ||
      /connect\.facebook\.net/i.test(html) ||
      /facebook\.com\/tr\?/i.test(html),
    extract: extractMeta,
  },
  {
    id: "tiktok-pixel",
    match: (html) =>
      /TiktokAnalyticsObject/i.test(html) ||
      /\bttq\.(?:load|page|track)\s*\(/i.test(html) ||
      /analytics\.tiktok\.com/i.test(html),
    extract: extractTiktok,
  },
  {
    id: "linkedin-insight-tag",
    match: (html) =>
      /_linkedin_partner_id/i.test(html) ||
      /\blintrk\b/i.test(html) ||
      /snap\.licdn\.com/i.test(html) ||
      /px\.ads\.linkedin\.com/i.test(html),
    extract: extractLinkedin,
  },
  {
    id: "cloudflare-web-analytics",
    match: (html) =>
      /cloudflareinsights\.com/i.test(html) ||
      /data-cf-beacon/i.test(html),
    extract: extractCloudflare,
  },
  {
    id: "plausible",
    match: (html) =>
      /plausible\.io/i.test(html) ||
      (/data-domain=/i.test(html) && /plausible/i.test(html)),
    extract: extractPlausible,
  },
  {
    id: "fathom",
    match: (html) => /usefathom\.com/i.test(html) || /cdn\.usefathom\.com/i.test(html),
    extract: extractFathom,
  },
  {
    id: "simple-analytics",
    match: (html) => /simpleanalyticscdn\.com/i.test(html) || /simpleanalytics\.com/i.test(html),
    extract: extractSimpleAnalytics,
  },
  {
    id: "umami",
    match: (html) =>
      /data-website-id=/i.test(html) ||
      /umami\.is/i.test(html) ||
      /\/script\.js/i.test(html) && /umami/i.test(html),
    extract: extractUmami,
  },
  {
    id: "matomo",
    match: (html) =>
      /\b_paq\b/.test(html) ||
      /matomo\.js/i.test(html) ||
      /matomo\.php/i.test(html),
    extract: extractMatomo,
  },
];

function hasRequiredFields(
  providerId: AnalyticsProviderId,
  fields: ExtractedFields,
): boolean {
  const definition = ANALYTICS_PROVIDER_MAP[providerId];
  return definition.fields
    .filter((field) => field.required)
    .every((field) => Boolean(fields[field.key]?.trim()));
}

export function providerPrimaryValue(
  providerId: AnalyticsProviderId,
  fields: Record<string, string>,
): string {
  const definition = ANALYTICS_PROVIDER_MAP[providerId];
  const required = definition.fields.find((field) => field.required);
  if (required) {
    const value = fields[required.key]?.trim();
    if (value) return value;
  }
  const scriptSrc = fields.scriptSrc?.trim();
  if (scriptSrc) return scriptSrc;
  return providerId;
}

/**
 * Classify a script/noscript HTML blob as a known analytics provider
 * or a generic snippet. Providers that match but lack required fields
 * stay snippets so customized vendor code is not half-mapped.
 */
export function classifyInjectionHtml(html: string): ClassifiedInjection {
  for (const fingerprint of FINGERPRINTS) {
    if (!fingerprint.match(html)) continue;
    const fields = fingerprint.extract(html);
    if (!hasRequiredFields(fingerprint.id, fields)) {
      return { kind: "snippet" };
    }
    return {
      kind: "analytics",
      providerId: fingerprint.id,
      fields,
    };
  }
  return { kind: "snippet" };
}

/**
 * Replace previous field values with next values inside the original HTML.
 * Longest values first so a longer token is not partially clobbered.
 * Returns null when a changed required field cannot be found in the source.
 */
export function substituteInjectionFields(
  html: string,
  providerId: AnalyticsProviderId,
  previous: Record<string, string>,
  next: Record<string, string>,
): string | null {
  const definition = ANALYTICS_PROVIDER_MAP[providerId];
  let out = html;
  const replacements: Array<{ from: string; to: string }> = [];

  for (const field of definition.fields) {
    const from = (previous[field.key] ?? "").trim();
    const to = (next[field.key] ?? "").trim();
    if (!from || from === to) continue;
    if (!html.includes(from)) {
      if (field.required) return null;
      continue;
    }
    replacements.push({ from, to });
  }

  replacements.sort((a, b) => b.from.length - a.from.length);
  for (const { from, to } of replacements) {
    out = out.split(from).join(to);
  }
  return out;
}
