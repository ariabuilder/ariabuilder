import type { ProjectTranslationCatalogResult } from "../../shared/composer/projectTranslations";

export type TranslationWorkerResponse =
  | { ok: true; result: ProjectTranslationCatalogResult }
  | { ok: false; error: string };

export type TranslationCatalogWorker = {
  once(event: "message", listener: (message: TranslationWorkerResponse) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "exit", listener: (code: number) => void): unknown;
  off(event: "message", listener: (message: TranslationWorkerResponse) => void): unknown;
  off(event: "error", listener: (error: Error) => void): unknown;
  off(event: "exit", listener: (code: number) => void): unknown;
  terminate(): Promise<number>;
};

export type TranslationWorkerTask = {
  promise: Promise<ProjectTranslationCatalogResult>;
  cancel: () => void;
};

export function runTranslationCatalogWorker(
  worker: TranslationCatalogWorker,
  timeoutMs: number,
): TranslationWorkerTask {
  let cancel: () => void = () => undefined;
  const promise = new Promise<ProjectTranslationCatalogResult>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const stopWorker = (): void => {
      try {
        void worker.terminate().catch(() => undefined);
      } catch {
        // The worker may already have stopped.
      }
    };
    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
    };
    const finish = (
      outcome: { result: ProjectTranslationCatalogResult } | { error: Error },
    ): void => {
      if (settled) return;
      settled = true;
      cleanup();
      stopWorker();
      if ("result" in outcome) resolve(outcome.result);
      else reject(outcome.error);
    };
    const onMessage = (message: TranslationWorkerResponse): void => {
      if (message.ok) finish({ result: message.result });
      else finish({ error: new Error(message.error) });
    };
    const onError = (error: Error): void => finish({ error });
    const onExit = (code: number): void => finish({
      error: new Error(
        code === 0
          ? "Translation discovery worker stopped before returning a result."
          : `Translation discovery worker stopped with code ${code}.`,
      ),
    });

    cancel = () => finish({ error: new Error("Translation discovery was cancelled.") });
    worker.once("message", onMessage);
    worker.once("error", onError);
    worker.once("exit", onExit);
    timer = setTimeout(() => {
      finish({ error: new Error(`Translation discovery timed out after ${timeoutMs}ms.`) });
    }, timeoutMs);
  });
  return { promise, cancel: () => cancel() };
}

export class TranslationCatalogWorkerRegistry {
  private readonly active = new Map<string, TranslationWorkerTask>();

  public run(
    key: string,
    worker: TranslationCatalogWorker,
    timeoutMs: number,
  ): Promise<ProjectTranslationCatalogResult> {
    this.cancel(key);
    const task = runTranslationCatalogWorker(worker, timeoutMs);
    this.active.set(key, task);
    const clear = (): void => {
      if (this.active.get(key) === task) this.active.delete(key);
    };
    void task.promise.then(clear, clear);
    return task.promise;
  }

  public cancel(key: string): void {
    this.active.get(key)?.cancel();
    this.active.delete(key);
  }
}
