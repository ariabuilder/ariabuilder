import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ARIA_BRIDGE_ID,
  ARIA_PROTOCOL_VERSION,
} from "../../shared/composer/protocol";
import { probeAriaBridge } from "./probeMarkers";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("preview bridge probe", () => {
  it("accepts only the current served bridge identity", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      bridgeId: ARIA_BRIDGE_ID,
      protocolVersion: ARIA_PROTOCOL_VERSION,
    }), { status: 200 })));

    await expect(probeAriaBridge("http://127.0.0.1:4321")).resolves.toMatchObject({
      compatible: true,
      bridgeId: ARIA_BRIDGE_ID,
    });
  });

  it("reports a stale endpoint as incompatible", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      bridgeId: "aria-composer-bridge-old",
      protocolVersion: ARIA_PROTOCOL_VERSION,
    }), { status: 200 })));

    await expect(probeAriaBridge("http://127.0.0.1:4321")).resolves.toMatchObject({
      compatible: false,
      bridgeId: "aria-composer-bridge-old",
    });
  });
});
