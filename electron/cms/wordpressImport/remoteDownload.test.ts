import { describe, expect, it, vi } from "vitest";
import {
  assertSafeRemoteUrl,
  pinnedLookup,
  RemoteDownloadError,
  resolvePublicAddresses,
} from "./remoteDownload";

describe("remote download destination validation", () => {
  it.each([
    "http://127.0.0.1/file.jpg",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/file.jpg",
    "http://[::ffff:127.0.0.1]/file.jpg",
    "http://host.internal/file.jpg",
  ])("rejects literal and local destination %s", (url) => {
    expect(() => assertSafeRemoteUrl(url)).toThrowError(
      expect.objectContaining({ code: "PRIVATE_DESTINATION" }),
    );
  });

  it("rejects a hostname when any DNS result is private", async () => {
    const lookup = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]) as never;
    await expect(resolvePublicAddresses("example.test", lookup)).rejects.toMatchObject({
      code: "PRIVATE_DESTINATION",
    } satisfies Partial<RemoteDownloadError>);
  });

  it("pins subsequent socket lookup to the already validated address", () => {
    const lookup = pinnedLookup([
      { address: "93.184.216.34", family: 4 },
      { address: "93.184.216.35", family: 4 },
    ]);
    const callback = vi.fn();
    lookup("changed.example", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
  });

  it("revalidates a redirect target before a follow-up request", () => {
    const initial = assertSafeRemoteUrl("https://example.com/image.jpg");
    const redirected = new URL("http://127.0.0.1/private", initial);
    expect(() => assertSafeRemoteUrl(redirected)).toThrowError(
      expect.objectContaining({ code: "PRIVATE_DESTINATION" }),
    );
  });
});
