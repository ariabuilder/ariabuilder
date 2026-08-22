import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ComponentThumbReadyPayload,
  PageThumbReadyPayload,
} from "@/types/aria";
import {
  getComponentThumb,
  invalidateComponentThumbCache,
  onComponentThumbReady,
  onPageThumbReady,
  peekComponentThumb,
} from "./thumbs";

describe("page thumb ready subscriptions", () => {
  const stops: Array<() => void> = [];

  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    vi.unstubAllGlobals();
  });

  it("shares one IPC listener across subscribers", () => {
    let readyHandler: ((payload: PageThumbReadyPayload) => void) | undefined;
    const stopBridge = vi.fn();
    const onPageReady = vi.fn(
      (handler: (payload: PageThumbReadyPayload) => void) => {
        readyHandler = handler;
        return stopBridge;
      },
    );
    vi.stubGlobal("window", {
      aria: {
        thumbs: { onPageReady },
      },
    });

    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = onPageThumbReady(first);
    const stopSecond = onPageThumbReady(second);
    stops.push(stopFirst, stopSecond);

    expect(onPageReady).toHaveBeenCalledTimes(1);

    const payload: PageThumbReadyPayload = {
      projectPath: "/proj",
      route: "/about",
    };
    readyHandler?.(payload);

    expect(first).toHaveBeenCalledWith(payload);
    expect(second).toHaveBeenCalledWith(payload);

    stopFirst();
    expect(stopBridge).not.toHaveBeenCalled();
    readyHandler?.(payload);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);

    stopSecond();
    expect(stopBridge).toHaveBeenCalledTimes(1);
  });
});

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
