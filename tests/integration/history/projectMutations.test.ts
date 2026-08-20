import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectMutationError } from "@shared/history";
import {
  configureMutationCoordinator,
  beginMutationShutdown,
  drainProjectMutations,
  listProjectHistory,
  recoverProjectMutations,
  redoProjectHistory,
  runProjectMutation,
  undoProjectHistory,
} from "@electron/mutations";
import { runCmsTransaction } from "@electron/cms/mutationCoordinator";
import { writeBinaryFileAtomic, writeTextFileAtomic } from "@electron/pathSafety";

describe.sequential("project mutation coordinator", () => {
  let tempRoot = "";
  let projectRoot = "";
  let pageFile = "";
  let userData = "";

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aria-mutations-"));
    projectRoot = path.join(tempRoot, "site");
    pageFile = path.join(projectRoot, "src", "pages", "index.astro");
    fs.mkdirSync(path.dirname(pageFile), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "history-test", dependencies: { astro: "latest" } }),
    );
    fs.writeFileSync(pageFile, "<h1>Before</h1>\n");
    userData = path.join(tempRoot, "user-data");
    configureMutationCoordinator(userData);
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("records successful mutations and restores undo and redo", async () => {
    await runProjectMutation(
      projectRoot,
      { actor: "user", surface: "pages", operation: "Update home" },
      () => writeTextFileAtomic(pageFile, "<h1>After</h1>\n"),
    );

    const listed = listProjectHistory(projectRoot);
    expect(listed.records).toHaveLength(1);
    expect(listed.records[0]).toMatchObject({
      actor: "user",
      surface: "pages",
      operation: "Update home",
      restorable: true,
    });

    await undoProjectHistory(projectRoot);
    expect(fs.readFileSync(pageFile, "utf8")).toBe("<h1>Before</h1>\n");
    expect(listProjectHistory(projectRoot).canRedo).toBe(true);

    await redoProjectHistory(projectRoot);
    expect(fs.readFileSync(pageFile, "utf8")).toBe("<h1>After</h1>\n");
  });

  it("rolls back every tracked file when a mutation fails", async () => {
    const created = path.join(projectRoot, "src", "pages", "created.astro");
    await expect(
      runProjectMutation(
        projectRoot,
        { actor: "system", surface: "cms", operation: "Injected failure" },
        () => {
          writeTextFileAtomic(pageFile, "<h1>Partial</h1>\n");
          writeTextFileAtomic(created, "<p>Created</p>\n");
          throw new Error("injected write failure");
        },
      ),
    ).rejects.toThrow("injected write failure");

    expect(fs.readFileSync(pageFile, "utf8")).toBe("<h1>Before</h1>\n");
    expect(fs.existsSync(created)).toBe(false);
    expect(listProjectHistory(projectRoot).records).toHaveLength(0);
  });

  it("uses a temporary transaction backup for files above the History limit", async () => {
    const mediaFile = path.join(projectRoot, "public", "large-media.bin");
    fs.mkdirSync(path.dirname(mediaFile), { recursive: true });
    const before = Buffer.alloc(2 * 1024 * 1024 + 1, 17);
    fs.writeFileSync(mediaFile, before);

    await expect(
      runProjectMutation(
        projectRoot,
        { actor: "user", surface: "media", operation: "Replace media" },
        () => {
          writeBinaryFileAtomic(mediaFile, Buffer.alloc(before.length, 23));
          throw new Error("injected media failure");
        },
      ),
    ).rejects.toThrow("injected media failure");

    expect(fs.readFileSync(mediaFile)).toEqual(before);
    expect(listProjectHistory(projectRoot).records).toHaveLength(0);
  }, 60_000);

  it("blocks undo when an external process changed a target", async () => {
    await runProjectMutation(
      projectRoot,
      { actor: "agent", surface: "agent", operation: "Update page" },
      () => writeTextFileAtomic(pageFile, "<h1>Agent</h1>\n"),
    );
    fs.writeFileSync(pageFile, "<h1>Changed in IDE</h1>\n");

    const error = await undoProjectHistory(projectRoot).catch((value) => value);
    expect(error).toBeInstanceOf(ProjectMutationError);
    expect((error as ProjectMutationError).code).toBe("HISTORY_CONFLICT");
    expect(fs.readFileSync(pageFile, "utf8")).toContain("Changed in IDE");
  });

  it("rolls back files already restored when a later snapshot cannot be applied", async () => {
    const secondFile = path.join(projectRoot, "src", "pages", "second.astro");
    fs.writeFileSync(secondFile, "<p>Second before</p>\n");
    await runProjectMutation(
      projectRoot,
      { actor: "user", surface: "pages", operation: "Update two pages" },
      () => {
        writeTextFileAtomic(pageFile, "<h1>After</h1>\n");
        writeTextFileAtomic(secondFile, "<p>Second after</p>\n");
      },
    );

    const historyDir = path.join(tempRoot, "user-data", "history");
    const journalFile = fs.readdirSync(historyDir)
      .map((name) => path.join(historyDir, name))
      .find((file) => file.endsWith(".json"));
    expect(journalFile).toBeTruthy();
    const journal = JSON.parse(fs.readFileSync(journalFile!, "utf8")) as {
      records: Array<{ restorable: boolean; files: Array<{ path: string; before?: string }> }>;
    };
    const record = journal.records[0]!;
    const later = record.files.find((file) => file.path.endsWith("second.astro"))!;
    delete later.before;
    record.restorable = true;
    fs.writeFileSync(journalFile!, `${JSON.stringify(journal, null, 2)}\n`);

    await expect(undoProjectHistory(projectRoot)).rejects.toMatchObject({
      code: "HISTORY_NOT_RESTORABLE",
    });
    expect(fs.readFileSync(pageFile, "utf8")).toBe("<h1>After</h1>\n");
    expect(fs.readFileSync(secondFile, "utf8")).toBe("<p>Second after</p>\n");
  });

  it("coalesces adjacent Composer disk commits without losing the first snapshot", async () => {
    await runProjectMutation(
      projectRoot,
      { actor: "user", surface: "composer", operation: "write page" },
      () => writeTextFileAtomic(pageFile, "<h1>Typing one</h1>\n"),
    );
    await runProjectMutation(
      projectRoot,
      { actor: "user", surface: "composer", operation: "write page" },
      () => writeTextFileAtomic(pageFile, "<h1>Typing two</h1>\n"),
    );

    expect(listProjectHistory(projectRoot).records).toHaveLength(1);
    await undoProjectHistory(projectRoot);
    expect(fs.readFileSync(pageFile, "utf8")).toBe("<h1>Before</h1>\n");
  });

  it("does not absorb an unrelated external edit made during a mutation", async () => {
    const external = path.join(projectRoot, "src", "pages", "external.astro");
    fs.writeFileSync(external, "<p>External before</p>\n");

    await runProjectMutation(
      projectRoot,
      { actor: "user", surface: "pages", operation: "Update home" },
      async () => {
        writeTextFileAtomic(pageFile, "<h1>After</h1>\n");
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            fs.writeFileSync(external, "<p>External after</p>\n");
            resolve();
          }, 5);
        });
      },
    );

    expect(listProjectHistory(projectRoot).records[0]?.files.map((file) => file.path))
      .toEqual(["src/pages/index.astro"]);
    await undoProjectHistory(projectRoot);
    expect(fs.readFileSync(external, "utf8")).toBe("<p>External after</p>\n");
  });

  it("records the committed CMS manifest without journal or staging files", async () => {
    const canonical = path.join(projectRoot, ".aria", "cms", "posts", "one.json");
    const projection = path.join(projectRoot, "src", "content", "posts", "one.md");
    fs.mkdirSync(path.dirname(canonical), { recursive: true });
    fs.mkdirSync(path.dirname(projection), { recursive: true });
    fs.writeFileSync(canonical, "before");
    fs.writeFileSync(projection, "before");

    await runProjectMutation(
      projectRoot,
      { actor: "user", surface: "cms", operation: "Update entry" },
      () => runCmsTransaction(projectRoot, "Update entry", () => {
        fs.writeFileSync(canonical, "after");
        fs.writeFileSync(projection, "after");
      }),
    );

    expect(listProjectHistory(projectRoot).records[0]?.files.map((file) => file.path))
      .toEqual([".aria/cms/posts/one.json", "src/content/posts/one.md"]);
  });

  it("does not scan or reject projects with more than 4,000 unrelated files", async () => {
    const unrelated = path.join(projectRoot, "public", "generated");
    fs.mkdirSync(unrelated, { recursive: true });
    for (let index = 0; index < 4_050; index += 1) {
      fs.writeFileSync(path.join(unrelated, `${index}.txt`), "x");
    }
    await runProjectMutation(
      projectRoot,
      { actor: "user", surface: "pages", operation: "Update home" },
      () => writeTextFileAtomic(pageFile, "<h1>Large project</h1>\n"),
    );
    expect(listProjectHistory(projectRoot).records[0]?.files).toHaveLength(1);
  }, 20_000);

  it("recovers an interrupted exact write set without touching unrelated files", () => {
    const external = path.join(projectRoot, "src", "pages", "external.astro");
    fs.writeFileSync(external, "<p>Keep</p>\n");
    const before = fs.readFileSync(pageFile);
    const after = Buffer.from("<h1>Applied</h1>\n");
    fs.writeFileSync(pageFile, after);
    const canonicalRoot = fs.realpathSync.native(projectRoot);
    const fingerprint = createHash("sha256")
      .update(`${canonicalRoot}\0history-test`)
      .digest("hex");
    const transaction = path.join(
      userData,
      "history",
      "transactions",
      fingerprint,
      "crash-fixture",
    );
    fs.mkdirSync(path.join(transaction, "before"), { recursive: true });
    fs.writeFileSync(path.join(transaction, "before", "page.bin"), before);
    fs.writeFileSync(
      path.join(transaction, "journal.json"),
      JSON.stringify({
        version: 1,
        id: "crash-fixture",
        projectRoot: canonicalRoot,
        fingerprint,
        state: "applied",
        createdAt: new Date().toISOString(),
        files: [{
          path: "src/pages/index.astro",
          beforeHash: createHash("sha256").update(before).digest("hex"),
          afterHash: createHash("sha256").update(after).digest("hex"),
          beforeBlob: "before/page.bin",
        }],
      }),
    );

    expect(recoverProjectMutations(projectRoot)).toEqual({
      recovered: 1,
      conflicts: [],
    });
    expect(fs.readFileSync(pageFile)).toEqual(before);
    expect(fs.readFileSync(external, "utf8")).toBe("<p>Keep</p>\n");
  });

  it("rejects new writes during shutdown and drains the active mutation", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const active = runProjectMutation(
      projectRoot,
      { actor: "user", surface: "pages", operation: "Long write" },
      async () => {
        writeTextFileAtomic(pageFile, "<h1>Pending</h1>\n");
        await gate;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    beginMutationShutdown();
    await expect(
      runProjectMutation(
        projectRoot,
        { actor: "user", surface: "pages", operation: "Rejected" },
        () => writeTextFileAtomic(pageFile, "<h1>Wrong</h1>\n"),
      ),
    ).rejects.toMatchObject({ code: "MUTATION_SHUTTING_DOWN" });
    let drained = false;
    const drain = drainProjectMutations().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await active;
    await drain;
    expect(fs.readFileSync(pageFile, "utf8")).toBe("<h1>Pending</h1>\n");
  });
});
