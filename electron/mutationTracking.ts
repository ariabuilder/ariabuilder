import { AsyncLocalStorage } from "node:async_hooks";

export type MutationPathState = {
  beforeHash: string | null;
  afterHash: string | null;
  beforeBytes: Buffer | null;
  afterBytes: Buffer | null;
};

export type MutationTracker = {
  beforePath(absolutePath: string, intendedAfter?: Buffer | null): void;
  afterPath(absolutePath: string): void;
  registerCommittedPath(absolutePath: string, state: MutationPathState): void;
};

const storage = new AsyncLocalStorage<MutationTracker | null>();

export function withMutationTracker<T>(
  tracker: MutationTracker,
  task: () => T,
): T {
  return storage.run(tracker, task);
}

export function withoutMutationTracking<T>(task: () => T): T {
  return storage.run(null, task);
}

export function beforeTrackedMutation(
  absolutePath: string,
  intendedAfter?: Buffer | null,
): void {
  storage.getStore()?.beforePath(absolutePath, intendedAfter);
}

export function afterTrackedMutation(absolutePath: string): void {
  storage.getStore()?.afterPath(absolutePath);
}

export function registerCommittedMutationPath(
  absolutePath: string,
  state: MutationPathState,
): void {
  storage.getStore()?.registerCommittedPath(absolutePath, state);
}
