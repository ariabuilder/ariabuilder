import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  HistoryActor,
  HistoryFileSnapshot,
  HistoryListResult,
  HistoryMutationResult,
  HistoryOutcome,
  HistoryRecord,
  HistoryRestoreDirection,
} from "../shared/history";
import { ProjectMutationError } from "../shared/history";
import {
  canonicalDirectory,
  canonicalPathAllowMissing,
  removePathTracked,
  resolveWithinRoot,
  writeBinaryFileAtomic,
  writeTextFileAtomic,
} from "./pathSafety";
import {
  withMutationTracker,
  type MutationPathState,
  type MutationTracker,
} from "./mutationTracking";

const HISTORY_VERSION = 1;
const TRANSACTION_VERSION = 1;
const HISTORY_LIMIT = 200;
const MAX_TOUCHED_FILES = 4_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_HISTORY_BYTES = 24 * 1024 * 1024;
const MAX_ROLLBACK_BYTES = 512 * 1024 * 1024;
const LEGACY_TRANSACTION_GRACE_MS = 24 * 60 * 60 * 1_000;

type JournalState = {
  version: number;
  projectRoot: string;
  fingerprint: string;
  records: HistoryRecord[];
  undoStack: string[];
  redoStack: string[];
};

type DurableTransactionFile = {
  path: string;
  beforeHash: string | null;
  afterHash: string | null;
  beforeBlob?: string;
};

type DurableTransactionJournal = {
  version: 1;
  id: string;
  projectRoot: string;
  fingerprint: string;
  state: "prepared" | "applied" | "committed" | "conflicted";
  createdAt: string;
  historyRecordId?: string;
  files: DurableTransactionFile[];
};

type TrackedFile = DurableTransactionFile & {
  absolute: string;
  beforeBytes: Buffer | null;
  afterBytes: Buffer | null;
};

export type ProjectMutationMeta = {
  actor: HistoryActor;
  surface: string;
  operation: string;
  targets?: string[];
};

let historyRoot: string | null = null;
let mutationShutdown = false;
const projectQueues = new Map<string, Promise<void>>();

export function configureMutationCoordinator(userData: string): void {
  historyRoot = path.join(userData, "history");
  mutationShutdown = false;
  fs.mkdirSync(historyRoot, { recursive: true });
  cleanupLegacyTransactions();
}

function requireHistoryRoot(): string {
  if (!historyRoot) throw new Error("Project History is not initialized");
  return historyRoot;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function projectFingerprint(root: string): string {
  let packageIdentity = "";
  try {
    const raw = fs.readFileSync(path.join(root, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { name?: unknown };
    packageIdentity = typeof parsed.name === "string" ? parsed.name : "";
  } catch {
    packageIdentity = "";
  }
  return sha256(`${root}\0${packageIdentity}`);
}

function journalFile(root: string): string {
  return path.join(requireHistoryRoot(), `${projectFingerprint(root)}.json`);
}

function transactionProjectDirectory(root: string): string {
  return path.join(requireHistoryRoot(), "transactions", projectFingerprint(root));
}

function emptyJournal(root: string): JournalState {
  return {
    version: HISTORY_VERSION,
    projectRoot: root,
    fingerprint: projectFingerprint(root),
    records: [],
    undoStack: [],
    redoStack: [],
  };
}

function readJournal(root: string): JournalState {
  try {
    const parsed = JSON.parse(fs.readFileSync(journalFile(root), "utf8")) as Partial<JournalState>;
    if (
      parsed.version !== HISTORY_VERSION ||
      parsed.projectRoot !== root ||
      parsed.fingerprint !== projectFingerprint(root) ||
      !Array.isArray(parsed.records) ||
      !Array.isArray(parsed.undoStack) ||
      !Array.isArray(parsed.redoStack)
    ) {
      return emptyJournal(root);
    }
    return parsed as JournalState;
  } catch {
    return emptyJournal(root);
  }
}

function writeJournal(root: string, state: JournalState): void {
  state.records = state.records.slice(-HISTORY_LIMIT);
  const retained = new Set(state.records.map((record) => record.id));
  state.undoStack = state.undoStack.filter((id) => retained.has(id));
  state.redoStack = state.redoStack.filter((id) => retained.has(id));
  writeTextFileAtomic(journalFile(root), `${JSON.stringify(state, null, 2)}\n`);
}

function currentState(absolute: string): {
  hash: string | null;
  bytes: Buffer | null;
} {
  try {
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error("Mutation targets cannot be symlinks");
    if (!stat.isFile()) return { hash: null, bytes: null };
    const bytes = fs.readFileSync(absolute);
    return { hash: sha256(bytes), bytes };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { hash: null, bytes: null };
    }
    throw error;
  }
}

function isIgnoredMutationPath(relative: string): boolean {
  const normalized = relative.split(path.sep).join("/");
  return (
    normalized === ".aria/transactions" ||
    normalized.startsWith(".aria/transactions/") ||
    normalized === ".aria/recovery" ||
    normalized.startsWith(".aria/recovery/") ||
    normalized === "node_modules" ||
    normalized.startsWith("node_modules/") ||
    normalized === ".git" ||
    normalized.startsWith(".git/")
  );
}

class ProjectTransaction implements MutationTracker {
  readonly id = randomUUID();
  readonly directory: string;
  readonly journalPath: string;
  readonly files = new Map<string, TrackedFile>();
  private rollbackBytes = 0;
  private journal: DurableTransactionJournal;

  constructor(readonly root: string) {
    this.directory = path.join(transactionProjectDirectory(root), this.id);
    this.journalPath = path.join(this.directory, "journal.json");
    this.journal = {
      version: TRANSACTION_VERSION,
      id: this.id,
      projectRoot: root,
      fingerprint: projectFingerprint(root),
      state: "prepared",
      createdAt: new Date().toISOString(),
      files: [],
    };
    fs.mkdirSync(this.directory, { recursive: true });
    this.persist();
  }

  private relativeFor(absolutePath: string): string | null {
    const canonical = canonicalPathAllowMissing(absolutePath);
    const relative = path.relative(this.root, canonical);
    if (
      relative === "" ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      isIgnoredMutationPath(relative)
    ) {
      return null;
    }
    return relative.split(path.sep).join("/");
  }

  private persist(): void {
    this.journal.files = [...this.files.values()].map((file) => ({
      path: file.path,
      beforeHash: file.beforeHash,
      afterHash: file.afterHash,
      ...(file.beforeBlob ? { beforeBlob: file.beforeBlob } : {}),
    }));
    writeTextFileAtomic(this.journalPath, `${JSON.stringify(this.journal, null, 2)}\n`);
  }

  beforePath(absolutePath: string, intendedAfter?: Buffer | null): void {
    const relative = this.relativeFor(absolutePath);
    if (!relative || this.files.has(relative)) return;
    if (this.files.size >= MAX_TOUCHED_FILES) {
      throw new Error("Mutation touches too many files to capture safely");
    }
    const before = currentState(absolutePath);
    if (before.bytes && this.rollbackBytes + before.bytes.byteLength > MAX_ROLLBACK_BYTES) {
      throw new Error("Mutation rollback snapshot exceeds the safety limit");
    }
    let beforeBlob: string | undefined;
    if (before.bytes) {
      beforeBlob = path.join("before", `${sha256(relative)}.bin`);
      const target = path.join(this.directory, beforeBlob);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      writeBinaryFileAtomic(target, before.bytes, { overwrite: false });
      this.rollbackBytes += before.bytes.byteLength;
    }
    this.files.set(relative, {
      path: relative,
      absolute: canonicalPathAllowMissing(absolutePath),
      beforeHash: before.hash,
      afterHash:
        intendedAfter === undefined
          ? before.hash
          : intendedAfter === null
            ? null
            : sha256(intendedAfter),
      beforeBytes: before.bytes,
      afterBytes:
        intendedAfter === undefined
          ? before.bytes
          : intendedAfter === null
            ? null
            : intendedAfter,
      ...(beforeBlob ? { beforeBlob } : {}),
    });
    // The before-image and its journal entry are durable before the caller is
    // allowed to perform the project write.
    this.persist();
  }

  afterPath(absolutePath: string): void {
    const relative = this.relativeFor(absolutePath);
    if (!relative) return;
    this.beforePath(absolutePath);
    const file = this.files.get(relative);
    if (!file) return;
    const after = currentState(absolutePath);
    file.afterHash = after.hash;
    file.afterBytes = after.bytes;
    this.journal.state = "applied";
    this.persist();
  }

  registerCommittedPath(absolutePath: string, state: MutationPathState): void {
    const relative = this.relativeFor(absolutePath);
    if (!relative) return;
    if (!this.files.has(relative)) {
      if (this.files.size >= MAX_TOUCHED_FILES) {
        throw new Error("Mutation touches too many files to capture safely");
      }
      if (
        state.beforeBytes &&
        this.rollbackBytes + state.beforeBytes.byteLength > MAX_ROLLBACK_BYTES
      ) {
        throw new Error("Mutation rollback snapshot exceeds the safety limit");
      }
      if (state.beforeBytes) {
        const beforeBlob = path.join("before", `${sha256(relative)}.bin`);
        const target = path.join(this.directory, beforeBlob);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        writeBinaryFileAtomic(target, state.beforeBytes, { overwrite: false });
        this.rollbackBytes += state.beforeBytes.byteLength;
        this.files.set(relative, {
          path: relative,
          absolute: canonicalPathAllowMissing(absolutePath),
          beforeHash: state.beforeHash,
          afterHash: state.afterHash,
          beforeBytes: state.beforeBytes,
          afterBytes: state.afterBytes,
          beforeBlob,
        });
      } else {
        this.files.set(relative, {
          path: relative,
          absolute: canonicalPathAllowMissing(absolutePath),
          beforeHash: state.beforeHash,
          afterHash: state.afterHash,
          beforeBytes: null,
          afterBytes: state.afterBytes,
        });
      }
    }
    const file = this.files.get(relative)!;
    file.afterHash = state.afterHash;
    file.afterBytes = state.afterBytes;
    this.journal.state = "applied";
    this.persist();
  }

  historyFiles(): HistoryFileSnapshot[] {
    let historyBytes = 0;
    return [...this.files.values()]
      .sort((a, b) => a.path.localeCompare(b.path))
      .flatMap((file): HistoryFileSnapshot[] => {
        const current = currentState(file.absolute);
        file.afterHash = current.hash;
        file.afterBytes = current.bytes;
        if (file.beforeHash === file.afterHash) return [];
        const beforeFits =
          !file.beforeBytes ||
          (file.beforeBytes.byteLength <= MAX_FILE_BYTES &&
            historyBytes + file.beforeBytes.byteLength <= MAX_HISTORY_BYTES);
        if (beforeFits && file.beforeBytes) historyBytes += file.beforeBytes.byteLength;
        const afterFits =
          !file.afterBytes ||
          (file.afterBytes.byteLength <= MAX_FILE_BYTES &&
            historyBytes + file.afterBytes.byteLength <= MAX_HISTORY_BYTES);
        if (afterFits && file.afterBytes) historyBytes += file.afterBytes.byteLength;
        return [{
          path: file.path,
          beforeHash: file.beforeHash,
          afterHash: file.afterHash,
          ...(beforeFits && file.beforeBytes
            ? { before: file.beforeBytes.toString("base64") }
            : {}),
          ...(afterFits && file.afterBytes
            ? { after: file.afterBytes.toString("base64") }
            : {}),
        }];
      });
  }

  prepareCommit(historyRecordId: string): void {
    this.journal.state = "applied";
    this.journal.historyRecordId = historyRecordId;
    this.persist();
  }

  markCommitted(): void {
    this.journal.state = "committed";
    this.persist();
  }

  rollback(): void {
    const changed = [...this.files.values()].filter(
      (file) => file.beforeHash !== file.afterHash,
    );
    const conflicts = changed
      .filter((file) => {
        const hash = currentState(file.absolute).hash;
        return hash !== file.afterHash && hash !== file.beforeHash;
      })
      .map((file) => file.path);
    if (conflicts.length > 0) {
      this.journal.state = "conflicted";
      this.persist();
      throw new ProjectMutationError(
        "MUTATION_ROLLBACK_FAILED",
        "Files changed outside Aria while the operation was rolling back. Current bytes were preserved.",
        conflicts,
      );
    }
    for (const file of changed) {
      if (currentState(file.absolute).hash === file.afterHash) {
        restoreDurableFile(this.directory, file);
      }
    }
  }

  cleanup(): void {
    fs.rmSync(this.directory, { recursive: true, force: true });
  }
}

function restoreDurableFile(
  directory: string,
  file: Pick<DurableTransactionFile, "path" | "beforeHash" | "beforeBlob"> & {
    absolute?: string;
  },
  root?: string,
): void {
  const absolute = file.absolute ?? resolveWithinRoot(root!, path.join(root!, file.path), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
  if (file.beforeHash === null) {
    removePathTracked(absolute, { recursive: true, force: true });
    return;
  }
  if (!file.beforeBlob) throw new Error(`Missing rollback bytes for ${file.path}`);
  const bytes = fs.readFileSync(path.join(directory, file.beforeBlob));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  writeBinaryFileAtomic(absolute, bytes);
}

function aggregateHash(files: HistoryFileSnapshot[], side: "before" | "after"): string {
  return sha256(
    files
      .map((file) => `${file.path}:${side === "before" ? file.beforeHash : file.afterHash}`)
      .join("\n"),
  );
}

function makeRecord(input: {
  meta: ProjectMutationMeta;
  files: HistoryFileSnapshot[];
  outcome?: HistoryOutcome;
  sourceRecordId?: string;
}): HistoryRecord {
  return {
    id: randomUUID(),
    actor: input.meta.actor,
    surface: input.meta.surface,
    operation: input.meta.operation,
    targets: [...new Set(input.meta.targets ?? input.files.map((file) => file.path))],
    timestamp: new Date().toISOString(),
    beforeHash: aggregateHash(input.files, "before"),
    afterHash: aggregateHash(input.files, "after"),
    files: input.files,
    outcome: input.outcome ?? "committed",
    restorable: input.files.length > 0 && input.files.every((file) =>
      (file.beforeHash === null || Boolean(file.before)) &&
      (file.afterHash === null || Boolean(file.after))),
    ...(input.sourceRecordId ? { sourceRecordId: input.sourceRecordId } : {}),
  };
}

function appendCommittedRecord(state: JournalState, record: HistoryRecord): string {
  const previous = state.records.at(-1);
  const canCoalesce =
    record.surface === "composer" &&
    previous?.surface === "composer" &&
    previous.operation === record.operation &&
    previous.outcome === "committed" &&
    Date.parse(record.timestamp) - Date.parse(previous.timestamp) <= 2_000 &&
    previous.files.map((file) => file.path).join("\0") ===
      record.files.map((file) => file.path).join("\0");
  if (canCoalesce && previous) {
    const previousByPath = new Map(previous.files.map((file) => [file.path, file]));
    previous.timestamp = record.timestamp;
    previous.afterHash = record.afterHash;
    previous.targets = [...new Set([...previous.targets, ...record.targets])];
    previous.files = record.files.map((file) => {
      const first = previousByPath.get(file.path);
      return {
        ...file,
        beforeHash: first?.beforeHash ?? file.beforeHash,
        ...(first?.before ? { before: first.before } : {}),
      };
    });
    previous.restorable = previous.files.every((file) =>
      (file.beforeHash === null || Boolean(file.before)) &&
      (file.afterHash === null || Boolean(file.after)));
    state.redoStack = [];
    return previous.id;
  }
  state.records.push(record);
  state.undoStack.push(record.id);
  state.redoStack = [];
  return record.id;
}

function queueForProject<T>(root: string, task: () => Promise<T>): Promise<T> {
  if (mutationShutdown) {
    return Promise.reject(
      new ProjectMutationError(
        "MUTATION_SHUTTING_DOWN",
        "Aria is waiting for project changes to finish before quitting.",
      ),
    );
  }
  const previous = projectQueues.get(root) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(task);
  const settled = result.then(() => undefined, () => undefined);
  projectQueues.set(root, settled);
  void settled.finally(() => {
    if (projectQueues.get(root) === settled) projectQueues.delete(root);
  });
  return result;
}

async function executeMutation<T>(input: {
  root: string;
  meta: ProjectMutationMeta;
  task: () => T | Promise<T>;
  outcome?: HistoryOutcome;
  sourceRecordId?: string;
}): Promise<{ value: T; record: HistoryRecord | null }> {
  const transaction = new ProjectTransaction(input.root);
  try {
    const value = await withMutationTracker(transaction, input.task);
    const files = transaction.historyFiles();
    if (files.length === 0) {
      transaction.cleanup();
      return { value, record: null };
    }
    const record = makeRecord({
      meta: input.meta,
      files,
      outcome: input.outcome,
      sourceRecordId: input.sourceRecordId,
    });
    const state = readJournal(input.root);
    const retainedId = appendCommittedRecord(state, record);
    transaction.prepareCommit(retainedId);
    writeJournal(input.root, state);
    transaction.markCommitted();
    transaction.cleanup();
    return { value, record };
  } catch (error) {
    try {
      transaction.rollback();
      transaction.cleanup();
    } catch (rollbackError) {
      if (rollbackError instanceof ProjectMutationError) throw rollbackError;
      throw new ProjectMutationError(
        "MUTATION_ROLLBACK_FAILED",
        `The operation failed and Aria could not fully roll it back: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
      );
    }
    throw error;
  }
}

export async function runProjectMutation<T>(
  projectPath: string,
  meta: ProjectMutationMeta,
  task: () => T | Promise<T>,
): Promise<T> {
  const root = canonicalDirectory(projectPath);
  return queueForProject(root, async () =>
    (await executeMutation({ root, meta, task })).value,
  );
}

export function listProjectHistory(projectPath: string): HistoryListResult {
  const state = readJournal(canonicalDirectory(projectPath));
  return {
    records: [...state.records].reverse(),
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
  };
}

function recordById(state: JournalState, recordId: string): HistoryRecord {
  const record = state.records.find((item) => item.id === recordId);
  if (!record) {
    throw new ProjectMutationError(
      "HISTORY_RECORD_NOT_FOUND",
      "This History record is no longer available.",
    );
  }
  if (!record.restorable) {
    throw new ProjectMutationError(
      "HISTORY_NOT_RESTORABLE",
      "This change cannot be restored because one or more files exceed the History limit.",
      record.targets,
    );
  }
  return record;
}

function currentHash(absolute: string): string | null {
  return currentState(absolute).hash;
}

function applySnapshots(
  root: string,
  files: HistoryFileSnapshot[],
  direction: HistoryRestoreDirection,
  expectedDirection: HistoryRestoreDirection,
): void {
  const conflicts: string[] = [];
  for (const file of files) {
    const absolute = resolveWithinRoot(root, path.join(root, file.path), {
      allowMissing: true,
      rejectFinalSymlink: true,
    });
    const expectedHash = expectedDirection === "before" ? file.beforeHash : file.afterHash;
    if (currentHash(absolute) !== expectedHash) conflicts.push(file.path);
  }
  if (conflicts.length > 0) {
    throw new ProjectMutationError(
      "HISTORY_CONFLICT",
      "These files changed outside Aria. Reveal or compare them before restoring.",
      conflicts,
    );
  }
  for (const file of files) {
    const absolute = resolveWithinRoot(root, path.join(root, file.path), {
      allowMissing: true,
      rejectFinalSymlink: true,
    });
    const encoded = direction === "before" ? file.before : file.after;
    const targetHash = direction === "before" ? file.beforeHash : file.afterHash;
    if (targetHash === null) {
      removePathTracked(absolute, { recursive: true, force: true });
      continue;
    }
    if (!encoded) {
      throw new ProjectMutationError(
        "HISTORY_NOT_RESTORABLE",
        "This change includes a file that is too large to restore from History.",
        [file.path],
      );
    }
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    writeBinaryFileAtomic(absolute, Buffer.from(encoded, "base64"));
  }
}

async function restoreRecord(input: {
  root: string;
  recordId: string;
  direction: HistoryRestoreDirection;
  expectedDirection: HistoryRestoreDirection;
  outcome: HistoryOutcome;
}): Promise<HistoryRecord> {
  const source = recordById(readJournal(input.root), input.recordId);
  const result = await executeMutation({
    root: input.root,
    meta: {
      actor: "user",
      surface: "history",
      operation: input.direction === "before" ? "Revert change" : "Restore change",
      targets: source.targets,
    },
    task: () => applySnapshots(
      input.root,
      source.files,
      input.direction,
      input.expectedDirection,
    ),
    outcome: input.outcome,
    sourceRecordId: source.id,
  });
  if (!result.record) throw new Error("History restore made no changes");
  return result.record;
}

export async function undoProjectHistory(
  projectPath: string,
): Promise<HistoryMutationResult> {
  const root = canonicalDirectory(projectPath);
  return queueForProject(root, async () => {
    const state = readJournal(root);
    const recordId = state.undoStack.at(-1);
    if (!recordId) {
      throw new ProjectMutationError(
        "HISTORY_RECORD_NOT_FOUND",
        "There is nothing to undo.",
      );
    }
    const record = await restoreRecord({
      root,
      recordId,
      direction: "before",
      expectedDirection: "after",
      outcome: "reverted",
    });
    const next = readJournal(root);
    next.undoStack = next.undoStack.filter((id) => id !== recordId && id !== record.id);
    next.redoStack.push(recordId);
    writeJournal(root, next);
    return { ok: true, record };
  });
}

export async function redoProjectHistory(
  projectPath: string,
): Promise<HistoryMutationResult> {
  const root = canonicalDirectory(projectPath);
  return queueForProject(root, async () => {
    const state = readJournal(root);
    const recordId = state.redoStack.at(-1);
    if (!recordId) {
      throw new ProjectMutationError(
        "HISTORY_RECORD_NOT_FOUND",
        "There is nothing to redo.",
      );
    }
    const record = await restoreRecord({
      root,
      recordId,
      direction: "after",
      expectedDirection: "before",
      outcome: "restored",
    });
    const next = readJournal(root);
    next.redoStack = next.redoStack.filter((id) => id !== recordId);
    next.undoStack = next.undoStack.filter((id) => id !== record.id);
    next.undoStack.push(recordId);
    writeJournal(root, next);
    return { ok: true, record };
  });
}

export async function restoreProjectHistory(
  projectPath: string,
  recordId: string,
  direction: HistoryRestoreDirection,
): Promise<HistoryMutationResult> {
  const root = canonicalDirectory(projectPath);
  if (direction !== "before" && direction !== "after") {
    throw new Error("Invalid History restore direction");
  }
  return queueForProject(root, async () => {
    const record = await restoreRecord({
      root,
      recordId,
      direction,
      expectedDirection: direction === "before" ? "after" : "before",
      outcome: direction === "before" ? "reverted" : "restored",
    });
    const state = readJournal(root);
    state.undoStack = state.undoStack.filter((id) => id !== record.id);
    state.undoStack.push(record.id);
    state.redoStack = [];
    writeJournal(root, state);
    return { ok: true, record };
  });
}

function parseTransactionJournal(file: string): DurableTransactionJournal {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as DurableTransactionJournal;
  if (
    parsed.version !== TRANSACTION_VERSION ||
    !/^[a-zA-Z0-9-]+$/.test(parsed.id ?? "") ||
    !Array.isArray(parsed.files) ||
    !["prepared", "applied", "committed", "conflicted"].includes(parsed.state)
  ) {
    throw new Error(`Invalid project transaction journal: ${file}`);
  }
  return parsed;
}

export function recoverProjectMutations(projectPath: string): {
  recovered: number;
  conflicts: string[];
} {
  const root = canonicalDirectory(projectPath);
  const directory = transactionProjectDirectory(root);
  if (!fs.existsSync(directory)) return { recovered: 0, conflicts: [] };
  const historyIds = new Set(readJournal(root).records.map((record) => record.id));
  let recovered = 0;
  const conflicts: string[] = [];
  for (const name of fs.readdirSync(directory)) {
    const transactionDirectory = path.join(directory, name);
    const file = path.join(transactionDirectory, "journal.json");
    if (!fs.existsSync(file)) continue;
    const journal = parseTransactionJournal(file);
    if (
      journal.projectRoot !== root ||
      journal.fingerprint !== projectFingerprint(root)
    ) {
      throw new ProjectMutationError(
        "MUTATION_RECOVERY_FAILED",
        "A project transaction journal does not belong to this project.",
      );
    }
    if (
      journal.state === "committed" ||
      (journal.historyRecordId && historyIds.has(journal.historyRecordId))
    ) {
      fs.rmSync(transactionDirectory, { recursive: true, force: true });
      continue;
    }
    const transactionConflicts = journal.files
      .filter((entry) => entry.beforeHash !== entry.afterHash)
      .filter((entry) => {
        const absolute = resolveWithinRoot(root, path.join(root, entry.path), {
          allowMissing: true,
          rejectFinalSymlink: true,
        });
        const hash = currentHash(absolute);
        return hash !== entry.afterHash && hash !== entry.beforeHash;
      })
      .map((entry) => entry.path);
    if (transactionConflicts.length > 0) {
      journal.state = "conflicted";
      writeTextFileAtomic(file, `${JSON.stringify(journal, null, 2)}\n`);
      conflicts.push(...transactionConflicts);
      continue;
    }
    for (const entry of journal.files) {
      if (entry.beforeHash === entry.afterHash) continue;
      const absolute = resolveWithinRoot(root, path.join(root, entry.path), {
        allowMissing: true,
        rejectFinalSymlink: true,
      });
      if (currentHash(absolute) === entry.afterHash) {
        restoreDurableFile(transactionDirectory, entry, root);
      }
    }
    fs.rmSync(transactionDirectory, { recursive: true, force: true });
    recovered += 1;
  }
  if (conflicts.length > 0) {
    throw new ProjectMutationError(
      "MUTATION_RECOVERY_FAILED",
      "Aria preserved files that changed after an interrupted operation. Recovery material remains in Project History.",
      [...new Set(conflicts)],
    );
  }
  return { recovered, conflicts: [] };
}

function cleanupLegacyTransactions(): void {
  const root = historyRoot;
  if (!root || !fs.existsSync(root)) return;
  const cutoff = Date.now() - LEGACY_TRANSACTION_GRACE_MS;
  for (const name of fs.readdirSync(root)) {
    if (!name.startsWith(".mutation-")) continue;
    const absolute = path.join(root, name);
    try {
      if (fs.statSync(absolute).mtimeMs < cutoff) {
        fs.rmSync(absolute, { recursive: true, force: true });
      }
    } catch {
      // Cleanup is best-effort and never blocks startup.
    }
  }
}

export function beginMutationShutdown(): void {
  mutationShutdown = true;
}

export async function drainProjectMutations(projectPath?: string): Promise<void> {
  if (projectPath) {
    const root = canonicalDirectory(projectPath);
    await projectQueues.get(root);
    return;
  }
  await Promise.all([...projectQueues.values()]);
}

const MUTATION_CHANNELS = new Set([
  "cms:archive_entry",
  "cms:create_entry",
  "cms:create_translation_drafts",
  "cms:delete_collection_entries",
  "cms:delete_collections",
  "cms:delete_entry",
  "cms:duplicate_entry",
  "cms:import_markdown",
  "cms:migrate_collection",
  "cms:publish_entry",
  "cms:restore_revision",
  "cms:seed_blog",
  "cms:unpublish_entry",
  "cms:update_entry",
  "composer:write_page",
  "composer:commit_transaction",
  "composer:edit_translation_value",
  "composer:apply_translation_cutover",
  "design:create_stylesheet",
  "design:delete_font",
  "design:delete_stylesheet",
  "design:ensure_entry",
  "design:patch",
  "design:rename_class",
  "design:upload_font",
  "design:write_stylesheet",
  "media:delete",
  "media:delete_variant",
  "media:duplicate",
  "media:rename",
  "media:save_profile",
  "media:save_variant",
  "media:save_variant_with_profile",
  "media:update_grouping",
  "utilities:activate",
  "utilities:disable",
  "workspace:confirm_seo_takeover",
  "workspace:create_component",
  "workspace:duplicate_studio_document",
  "workspace:create_page",
  "workspace:create_redirect",
  "workspace:delete_component",
  "workspace:delete_studio_document",
  "workspace:delete_component_folder",
  "workspace:delete_page",
  "workspace:delete_redirect",
  "workspace:flatten_redirect_chain",
  "workspace:import_redirects_csv",
  "workspace:scan_seo_sources",
  "workspace:set_site_settings",
  "workspace:update_analytics",
  "workspace:update_collections",
  "workspace:update_component_grouping",
  "workspace:update_discovery",
  "workspace:update_pages_meta",
  "workspace:update_page_config",
  "workspace:update_redirect",
  "workspace:update_seo_defaults",
  "workspace:update_source_injection",
]);

export function mutationMetaForChannel(
  channel: string,
  args: unknown[],
): ProjectMutationMeta | null {
  if (!MUTATION_CHANNELS.has(channel)) return null;
  if (channel === "composer:commit_transaction") {
    const transaction = args[0] as
      | import("../shared/composer").ComposerEditTransaction
      | undefined;
    const targets = [
      ...(transaction?.page ? [transaction.page.relativeFile] : []),
      ...(transaction?.pages ?? []).map((edit) => edit.relativeFile),
      ...(transaction?.sources ?? []).map((edit) => edit.relativeFile),
      ...(transaction?.stylesheets ?? []).map((edit) => edit.relativeFile),
      ...(transaction?.managedArtifacts ?? []).map((edit) => edit.relativeFile),
    ];
    return {
      actor: "user",
      surface: "composer",
      operation: transaction?.sources?.length ? "apply code" : "commit transaction",
      targets: [...new Set(targets)].slice(0, 16),
    };
  }
  const surface = channel.split(":", 1)[0] || "studio";
  const targets = args
    .slice(1, 4)
    .filter((value): value is string =>
      typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim().slice(0, 240));
  return {
    actor: "user",
    surface,
    operation: channel.replace(/^[^:]+:/, "").replaceAll("_", " "),
    targets,
  };
}
