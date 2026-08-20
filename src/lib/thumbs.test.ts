import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentThumbReadyPayload } from "@/types/aria";
import {
  getComponentThumb,
  invalidateComponentThumbCache,
  onComponentThumbReady,
  peekComponentThumb,
} from "./thumbs";

describe("component thumb ready cache", () => {
  let readyHandler: ((payload: ComponentThumbReadyPayload) => void) | undefined;
  let stop: (() => void) | undefined;
  const getComponent = vi.fn(async () => null);

  afterEach(() => {
    stop?.();
    stop = undefined;
    readyHandler = undefined;
    invalidateComponentThumbCache({
      projectPath: "/proj",
      id: "src/components/Hero.astro",
    });
    vi.unstubAllGlobals();
    getComponent.mockClear();
  });

  it("hydrates the session cache from a ready payload dataUrl", async () => {
    vi.stubGlobal("window", {
      aria: {
        thumbs: {
          getComponent,
          onComponentReady: (
            handler: (payload: ComponentThumbReadyPayload) => void,
          ) => {
            readyHandler = handler;
            return () => {
              readyHandler = undefined;
            };
          },
        },
      },
    });

    stop = onComponentThumbReady(() => undefined);
    readyHandler?.({
      projectPath: "/proj",
      id: "src/components/Hero.astro",
      mtimeMs: 10,
      dataUrl: "data:image/png;base64,abc",
    });

    expect(
      peekComponentThumb({
        projectPath: "/proj",
        id: "src/components/Hero.astro",
        mtimeMs: 10,
      }),
    ).toBe("data:image/png;base64,abc");

    const result = await getComponentThumb({
      projectPath: "/proj",
      id: "src/components/Hero.astro",
      mtimeMs: 10,
    });
    expect(result).toEqual({ dataUrl: "data:image/png;base64,abc" });
    expect(getComponent).not.toHaveBeenCalled();
  });
});
