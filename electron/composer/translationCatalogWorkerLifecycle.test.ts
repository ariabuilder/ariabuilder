import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TranslationCatalogWorkerRegistry,
  type TranslationCatalogWorker,
} from "./translationCatalogWorkerLifecycle";

class FakeWorker extends EventEmitter {
  public readonly terminate = vi.fn(async () => 0);
}

const result = { catalogs: [], unsupported: [], scannedAt: "2026-08-21T00:00:00.000Z" };

afterEach(() => vi.useRealTimers());

describe("translation catalog worker lifecycle", () => {
  it("terminates and detaches the worker after a successful result", async () => {
    const registry = new TranslationCatalogWorkerRegistry();
    const worker = new FakeWorker();
    const promise = registry.run("project", worker as TranslationCatalogWorker, 1_000);
    worker.emit("message", { ok: true, result });

    await expect(promise).resolves.toEqual(result);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.eventNames()).toEqual([]);
  });

  it("times out, terminates, and rejects a worker that never responds", async () => {
    vi.useFakeTimers();
    const registry = new TranslationCatalogWorkerRegistry();
    const worker = new FakeWorker();
    const promise = registry.run("project", worker as TranslationCatalogWorker, 250);
    const rejection = expect(promise).rejects.toThrow("timed out after 250ms");

    await vi.advanceTimersByTimeAsync(250);
    await rejection;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.eventNames()).toEqual([]);
  });

  it("cancels and terminates active work when its project is disposed", async () => {
    const registry = new TranslationCatalogWorkerRegistry();
    const worker = new FakeWorker();
    const promise = registry.run("project", worker as TranslationCatalogWorker, 1_000);
    const rejection = expect(promise).rejects.toThrow("cancelled");

    registry.cancel("project");
    await rejection;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.eventNames()).toEqual([]);
  });
});
