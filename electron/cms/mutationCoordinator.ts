import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { canonicalDirectory, resolveWithinRoot, writeTextFileAtomic } from "../pathSafety";
import {
  registerCommittedMutationPath,
  withoutMutationTracking,
} from "../mutationTracking";

const JOURNAL_VERSION = 1;
const MAX_SNAPSHOT_FILES = 20_000;
const MAX_SNAPSHOT_BYTES = 96 * 1024 * 1024;
const TRACKED_PATHS = [
  ".aria/cms",
  ".aria/collections.json",
  "src/content",
  "src/content.config.ts",
  "src/content.config.mts",
  "src/content.config.js",
  "src/content.config.mjs",
  "public/uploads/aria-cms",
] as const;

type SnapshotFile = {
  path: string;
  contents: string;
};

type CmsTransactionJournal = {
  version: 1;
  id: string;
  projectPath: string;
  operation: string;
  state: "prepared" | "staged" | "committed";
  createdAt: string;
  before: SnapshotFile[];
  intended?: Array<{ path: string; bytes: number; sha256: string }>;
};

const activeTransactions = new Map<string, Promise<unknown>>();
let cmsMutationShutdown = false;

function transactionDirectory(root: string): string {
  return resolveWithinRoot(root, path.join(root, ".aria", "transactions"), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
}

function journalPath(root: string, id: string): string {
  return resolveWithinRoot(root, path.join(transactionDirectory(root), `cms-${id}.json`), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
}

function recoveryDirectory(root: string, id: string): string {
  return resolveWithinRoot(
    root,
    path.join(root, ".aria", "recovery", `cms-${id}`),
    { allowMissing: true, rejectFinalSymlink: true },
  );
}

function stageDirectory(root: string, id: string): string {
  return resolveWithinRoot(
    root,
    path.join(transactionDirectory(root), `cms-${id}-stage`),
    { allowMissing: true, rejectFinalSymlink: true },
  );
}

function snapshotDigest(contents: string): { bytes: number; sha256: string } {
  const bytes = Buffer.from(contents, "base64");
  return {
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function writeStage(root: string, id: string, files: readonly SnapshotFile[]): void {
  const directory = stageDirectory(root, id);
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
  for (const file of files) {
    const target = resolveWithinRoot(root, path.join(directory, file.path), {
      allowMissing: true,
      rejectFinalSymlink: true,
    });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(file.contents, "base64"), { flag: "wx" });
  }
}

function applyStagedState(root: string, journal: CmsTransactionJournal): void {
  if (!journal.intended) throw new Error("CMS transaction has no intended state");
  const directory = stageDirectory(root, journal.id);
  for (const intended of journal.intended) {
    const source = resolveWithinRoot(root, path.join(directory, intended.path), {
      rejectFinalSymlink: true,
    });
    const bytes = fs.readFileSync(source);
    if (
      bytes.byteLength !== intended.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== intended.sha256
    ) {
      throw new Error(`CMS staged file failed integrity validation: ${intended.path}`);
    }
  }
  clearTrackedPaths(root);
  for (const intended of journal.intended) {
    const source = resolveWithinRoot(root, path.join(directory, intended.path), {
      rejectFinalSymlink: true,
    });
    const target = resolveWithinRoot(root, path.join(root, intended.path), {
      allowMissing: true,
      rejectFinalSymlink: true,
    });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.aria-cms-${journal.id}.tmp`;
    fs.writeFileSync(temporary, fs.readFileSync(source), { flag: "wx" });
    fs.renameSync(temporary, target);
  }
}

function captureBefore(root: string): SnapshotFile[] {
  const files: SnapshotFile[] = [];
  let totalBytes = 0;

  const capture = (absolute: string): void => {
    if (!fs.existsSync(absolute)) return;
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error("CMS transaction targets cannot contain symlinks");
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absolute)) capture(path.join(absolute, entry));
      return;
    }
    if (!stat.isFile()) return;
    const contents = fs.readFileSync(absolute);
    totalBytes += contents.byteLength;
    if (files.length >= MAX_SNAPSHOT_FILES || totalBytes > MAX_SNAPSHOT_BYTES) {
      throw new Error("CMS transaction snapshot exceeds the safety limit");
    }
    files.push({
      path: path.relative(root, absolute).split(path.sep).join("/"),
      contents: contents.toString("base64"),
    });
  };

  for (const relative of TRACKED_PATHS) {
    capture(resolveWithinRoot(root, path.join(root, relative), { allowMissing: true }));
  }
  return files;
}

function clearTrackedPaths(root: string): void {
  for (const relative of TRACKED_PATHS) {
    const absolute = resolveWithinRoot(root, path.join(root, relative), {
      allowMissing: true,
      rejectFinalSymlink: true,
    });
    fs.rmSync(absolute, { recursive: true, force: true });
  }
}

function restoreBefore(root: string, files: readonly SnapshotFile[]): void {
  clearTrackedPaths(root);
  for (const file of files) {
    const absolute = resolveWithinRoot(root, path.join(root, file.path), {
      allowMissing: true,
      rejectFinalSymlink: true,
    });
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, Buffer.from(file.contents, "base64"), { flag: "wx" });
  }
}

/** Preserve post-snapshot bytes before rollback so concurrent edits are recoverable. */
function preserveChangedFiles(
  root: string,
  journal: CmsTransactionJournal,
): string | null {
  const current = captureBefore(root);
  const beforeByPath = new Map(
    journal.before.map((file) => [file.path, file.contents] as const),
  );
  const changed = current.filter(
    (file) => beforeByPath.get(file.path) !== file.contents,
  );
  const currentPaths = new Set(current.map((file) => file.path));
  const deleted = journal.before
    .map((file) => file.path)
    .filter((file) => !currentPaths.has(file));
  if (changed.length === 0 && deleted.length === 0) return null;

  const directory = recoveryDirectory(root, journal.id);
  fs.mkdirSync(directory, { recursive: true });
  for (const file of changed) {
    const target = resolveWithinRoot(
      root,
      path.join(directory, "files", file.path),
      { allowMissing: true, rejectFinalSymlink: true },
    );
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(file.contents, "base64"), {
      flag: "wx",
    });
  }
  writeTextFileAtomic(
    path.join(directory, "manifest.json"),
    `${JSON.stringify(
      {
        transactionId: journal.id,
        operation: journal.operation,
        capturedAt: new Date().toISOString(),
        changed: changed.map((file) => file.path),
        deleted,
      },
      null,
      2,
    )}\n`,
  );
  return path.relative(root, directory).split(path.sep).join("/");
}

function parseJournal(file: string): CmsTransactionJournal {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as CmsTransactionJournal;
  if (
    parsed.version !== JOURNAL_VERSION ||
    !/^[a-zA-Z0-9-]+$/.test(parsed.id ?? "") ||
    !parsed.projectPath ||
    !Array.isArray(parsed.before) ||
    (parsed.state !== "prepared" &&
      parsed.state !== "staged" &&
      parsed.state !== "committed")
  ) {
    throw new Error(`Invalid CMS transaction journal: ${path.basename(file)}`);
  }
  return parsed;
}

/** Recover or discard journals left by a process crash before project reads. */
function recoverCmsTransactionsNow(projectPath: string): number {
  const root = canonicalDirectory(projectPath);
  const directory = transactionDirectory(root);
  if (!fs.existsSync(directory)) return 0;
  let recovered = 0;
  for (const name of fs.readdirSync(directory)) {
    if (!/^cms-[a-zA-Z0-9-]+\.json$/.test(name)) continue;
    const file = resolveWithinRoot(root, path.join(directory, name), {
      rejectFinalSymlink: true,
    });
    const journal = parseJournal(file);
    if (canonicalDirectory(journal.projectPath) !== root) {
      throw new Error("CMS transaction journal belongs to another project");
    }
    if (journal.state === "prepared") {
      preserveChangedFiles(root, journal);
      restoreBefore(root, journal.before);
      recovered += 1;
    } else if (journal.state === "staged") {
      try {
        applyStagedState(root, journal);
      } catch {
        restoreBefore(root, journal.before);
      }
      recovered += 1;
    }
    fs.rmSync(stageDirectory(root, journal.id), { recursive: true, force: true });
    fs.rmSync(file, { force: true });
  }
  return recovered;
}

/** Serialize startup recovery behind any active transaction for this project. */
export async function recoverCmsTransactions(projectPath: string): Promise<number> {
  const root = canonicalDirectory(projectPath);
  const previous = activeTransactions.get(root) ?? Promise.resolve();
  const recovery = previous.catch(() => undefined).then(() =>
    recoverCmsTransactionsNow(root),
  );
  activeTransactions.set(root, recovery);
  try {
    return await recovery;
  } finally {
    if (activeTransactions.get(root) === recovery) activeTransactions.delete(root);
  }
}

function publishCommittedManifest(
  root: string,
  before: readonly SnapshotFile[],
  after: readonly SnapshotFile[],
): void {
  const beforeByPath = new Map(before.map((entry) => [entry.path, entry]));
  const afterByPath = new Map(after.map((entry) => [entry.path, entry]));
  const paths = new Set([...beforeByPath.keys(), ...afterByPath.keys()]);
  for (const relative of paths) {
    const previous = beforeByPath.get(relative);
    const next = afterByPath.get(relative);
    if (previous?.contents === next?.contents) continue;
    const beforeBytes = previous
      ? Buffer.from(previous.contents, "base64")
      : null;
    const afterBytes = next ? Buffer.from(next.contents, "base64") : null;
    registerCommittedMutationPath(path.join(root, relative), {
      beforeHash: beforeBytes
        ? createHash("sha256").update(beforeBytes).digest("hex")
        : null,
      afterHash: afterBytes
        ? createHash("sha256").update(afterBytes).digest("hex")
        : null,
      beforeBytes,
      afterBytes,
    });
  }
}

/**
 * Durable rollback boundary shared by UI IPC, Agent, imports, and setup.
 * Per-file writes stay atomic; this journal restores the
 * complete canonical/projection set if the process dies between replacements.
 */
export async function runCmsTransaction<T>(
  projectPath: string,
  operation: string,
  task: () => T | Promise<T>,
): Promise<T> {
  const root = canonicalDirectory(projectPath);
  if (cmsMutationShutdown) {
    throw new Error(
      "MUTATION_SHUTTING_DOWN: Aria is waiting for CMS changes to finish before quitting.",
    );
  }
  const previous = activeTransactions.get(root) ?? Promise.resolve();
  const transaction = previous.catch(() => undefined).then(async () => {
    recoverCmsTransactionsNow(root);
    const id = randomUUID();
    const file = journalPath(root, id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const journal: CmsTransactionJournal = {
      version: JOURNAL_VERSION,
      id,
      projectPath: root,
      operation,
      state: "prepared",
      createdAt: new Date().toISOString(),
      before: captureBefore(root),
    };
    writeTextFileAtomic(file, `${JSON.stringify(journal)}\n`);
    try {
      const result = await withoutMutationTracking(task);
      const intendedFiles = captureBefore(root);
      writeStage(root, id, intendedFiles);
      journal.intended = intendedFiles.map((entry) => ({
        path: entry.path,
        ...snapshotDigest(entry.contents),
      }));
      // Return tracked files to the known before-state before publishing the
      // staged manifest. A crash in the computation pass therefore rolls back;
      // a crash after the staged marker deterministically rolls forward.
      restoreBefore(root, journal.before);
      journal.state = "staged";
      writeTextFileAtomic(file, `${JSON.stringify(journal)}\n`);
      applyStagedState(root, journal);
      publishCommittedManifest(root, journal.before, intendedFiles);
      journal.state = "committed";
      writeTextFileAtomic(file, `${JSON.stringify(journal)}\n`);
      fs.rmSync(stageDirectory(root, id), { recursive: true, force: true });
      fs.rmSync(file, { force: true });
      return result;
    } catch (error) {
      preserveChangedFiles(root, journal);
      restoreBefore(root, journal.before);
      fs.rmSync(stageDirectory(root, id), { recursive: true, force: true });
      fs.rmSync(file, { force: true });
      throw error;
    }
  });

  activeTransactions.set(root, transaction);
  try {
    return await transaction;
  } finally {
    if (activeTransactions.get(root) === transaction) activeTransactions.delete(root);
  }
}

export function beginCmsMutationShutdown(): void {
  cmsMutationShutdown = true;
}

export async function drainCmsTransactions(projectPath?: string): Promise<void> {
  if (projectPath) {
    const root = canonicalDirectory(projectPath);
    await activeTransactions.get(root);
    return;
  }
  await Promise.all([...activeTransactions.values()]);
}
