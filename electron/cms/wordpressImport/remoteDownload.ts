import { lookup as dnsLookup } from "node:dns/promises";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";

type LookupAddress = { address: string; family: number };

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REDIRECTS = 5;

export class RemoteDownloadError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_URL"
      | "PRIVATE_DESTINATION"
      | "TOO_MANY_REDIRECTS"
      | "TOO_LARGE"
      | "HTTP_ERROR",
  ) {
    super(message);
    this.name = "RemoteDownloadError";
  }
}

function parseIpv4(hostname: string): number[] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  return octets.every(
    (octet, index) =>
      Number.isInteger(octet) &&
      octet >= 0 &&
      octet <= 255 &&
      String(octet) === parts[index],
  )
    ? octets
    : null;
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && octets[2] === 100) ||
    (a === 203 && b === 0 && octets[2] === 113) ||
    a >= 224
  );
}

function parseIpv6(hostname: string): number[] | null {
  let value = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!value.includes(":")) return null;

  const ipv4Tail = value.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (ipv4Tail) {
    const octets = parseIpv4(ipv4Tail);
    if (!octets) return null;
    value =
      value.slice(0, -ipv4Tail.length) +
      `${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
  }

  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;

  const groups = [
    ...left,
    ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => "0"),
    ...right,
  ].map((group) => Number.parseInt(group || "0", 16));

  return groups.length === 8 &&
    groups.every((group) => group >= 0 && group <= 0xffff)
    ? groups
    : null;
}

function isPrivateIpv6(groups: number[]): boolean {
  const allZero = groups.every((group) => group === 0);
  const loopback =
    groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  const uniqueLocal = (groups[0]! & 0xfe00) === 0xfc00;
  const linkLocal = (groups[0]! & 0xffc0) === 0xfe80;
  const multicast = (groups[0]! & 0xff00) === 0xff00;
  const documentation = groups[0] === 0x2001 && groups[1] === 0x0db8;
  const special2001 =
    groups[0] === 0x2001 &&
    (groups[1] === 0 || groups[1] === 2 || groups[1] === 0x10 || groups[1] === 0x20);
  const sixToFourPrivate =
    groups[0] === 0x2002 &&
    isPrivateIpv4([
      groups[1]! >> 8,
      groups[1]! & 0xff,
      groups[2]! >> 8,
      groups[2]! & 0xff,
    ]);
  const ipv4Mapped =
    groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  const mappedPrivate =
    ipv4Mapped &&
    isPrivateIpv4([
      groups[6]! >> 8,
      groups[6]! & 0xff,
      groups[7]! >> 8,
      groups[7]! & 0xff,
    ]);
  return (
    allZero ||
    loopback ||
    uniqueLocal ||
    linkLocal ||
    multicast ||
    documentation ||
    special2001 ||
    sixToFourPrivate ||
    mappedPrivate
  );
}

export function assertSafeRemoteUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = input instanceof URL ? new URL(input) : new URL(input);
  } catch {
    throw new RemoteDownloadError("Remote URL is invalid", "INVALID_URL");
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new RemoteDownloadError(
      "Remote URL must be an HTTP(S) URL without credentials",
      "INVALID_URL",
    );
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const localHostname =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home.arpa");
  const ipv4 = parseIpv4(hostname);
  const ipv6 = parseIpv6(hostname);

  if (
    localHostname ||
    (ipv4 !== null && isPrivateIpv4(ipv4)) ||
    (ipv6 !== null && isPrivateIpv6(ipv6))
  ) {
    throw new RemoteDownloadError(
      "Remote URL resolves to a local or private destination",
      "PRIVATE_DESTINATION",
    );
  }

  return url;
}

async function readBodyWithLimit(
  response: IncomingMessage,
  maxBytes: number,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RemoteDownloadError(
      `Remote file exceeds the ${maxBytes} byte limit`,
      "TOO_LARGE",
    );
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const raw of response) {
      const value = typeof raw === "string" ? Buffer.from(raw) : raw;
      total += value.byteLength;
      if (total > maxBytes) {
        response.destroy();
        throw new RemoteDownloadError(
          `Remote file exceeds the ${maxBytes} byte limit`,
          "TOO_LARGE",
        );
      }
      chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function responseHeaders(response: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(response.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
    else if (value !== undefined) headers.set(key, String(value));
  }
  return headers;
}

export async function resolvePublicAddresses(
  hostname: string,
  lookupImpl: typeof dnsLookup = dnsLookup,
): Promise<LookupAddress[]> {
  const literal4 = parseIpv4(hostname);
  const literal6 = parseIpv6(hostname);
  if (literal4 || literal6) {
    return [{ address: hostname, family: literal4 ? 4 : 6 }];
  }
  let addresses: LookupAddress[];
  try {
    addresses = await lookupImpl(hostname, { all: true, verbatim: true });
  } catch {
    throw new RemoteDownloadError("Remote host could not be resolved", "HTTP_ERROR");
  }
  if (addresses.length === 0) {
    throw new RemoteDownloadError("Remote host could not be resolved", "HTTP_ERROR");
  }
  for (const result of addresses) {
    const ipv4 = parseIpv4(result.address);
    const ipv6 = parseIpv6(result.address);
    if (
      (!ipv4 && !ipv6) ||
      (ipv4 && isPrivateIpv4(ipv4)) ||
      (ipv6 && isPrivateIpv6(ipv6))
    ) {
      throw new RemoteDownloadError(
        "Remote URL resolves to a local, private, or reserved destination",
        "PRIVATE_DESTINATION",
      );
    }
  }
  return addresses;
}

export function pinnedLookup(addresses: LookupAddress[]) {
  const selected = addresses[0];
  if (!selected) throw new Error("At least one validated address is required");
  return (
    _hostname: string,
    _options: unknown,
    callback: (error: NodeJS.ErrnoException | null, address: string, family: 4 | 6) => void,
  ) => callback(null, selected.address, selected.family === 6 ? 6 : 4);
}

async function requestPinned(
  url: URL,
  signal: AbortSignal,
  lookupImpl: typeof dnsLookup = dnsLookup,
): Promise<IncomingMessage> {
  const addresses = await resolvePublicAddresses(url.hostname, lookupImpl);
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method: "GET",
      signal,
      headers: {
        accept: "*/*",
        "accept-encoding": "identity",
        "user-agent": "Aria WordPress Import",
      },
      lookup: pinnedLookup(addresses),
      ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
    }, resolve);
    request.once("error", reject);
    request.end();
  });
}

export async function downloadRemoteResource(
  input: string | URL,
  options: {
    maxBytes: number;
    timeoutMs?: number;
    maxRedirects?: number;
    lookupImpl?: typeof dnsLookup;
  },
): Promise<{ bytes: Uint8Array; response: Response; finalUrl: URL }> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Remote download timed out")),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    let url = assertSafeRemoteUrl(input);
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

    for (let redirectCount = 0; ; redirectCount += 1) {
      const incoming = await requestPinned(url, controller.signal, options.lookupImpl);
      const status = incoming.statusCode ?? 0;

      if (status >= 300 && status < 400) {
        if (redirectCount >= maxRedirects) {
          throw new RemoteDownloadError(
            "Remote URL exceeded the redirect limit",
            "TOO_MANY_REDIRECTS",
          );
        }
        const location = incoming.headers.location;
        if (!location) {
          throw new RemoteDownloadError(
            `Remote server returned HTTP ${status} without a redirect location`,
            "HTTP_ERROR",
          );
        }
        incoming.resume();
        url = assertSafeRemoteUrl(new URL(location, url));
        continue;
      }

      if (status < 200 || status >= 300) {
        incoming.resume();
        throw new RemoteDownloadError(
          `Remote server returned HTTP ${status}`,
          "HTTP_ERROR",
        );
      }

      const contentEncoding = incoming.headers["content-encoding"];
      if (contentEncoding && contentEncoding !== "identity") {
        incoming.destroy();
        throw new RemoteDownloadError(
          "Remote server ignored the safe identity encoding request",
          "HTTP_ERROR",
        );
      }
      const headers = responseHeaders(incoming);
      const bytes = await readBodyWithLimit(incoming, options.maxBytes);
      const response = new Response(bytes, { status, headers });
      return { bytes, response, finalUrl: url };
    }
  } finally {
    clearTimeout(timeout);
  }
}
