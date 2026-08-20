import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  recoverCmsTransactions,
  runCmsTransaction,
} from "./mutationCoordinator";

describe.sequential("CMS mutation coordinator", () => {
  let root = "";
  let canonical = "";
  let projection = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-cms-transaction-"));
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "cms-transaction-test" }),
    );
    canonical = path.join(root, ".aria", "cms", "posts", "entry.json");
    projection = path.join(root, "src", "content", "posts", "entry.md");
    fs.mkdirSync(path.dirname(canonical), { recursive: true });
    fs.mkdirSync(path.dirname(projection), { recursive: true });
    fs.writeFileSync(canonical, "before-canonical");
    fs.writeFileSync(projection, "before-projection");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("rolls canonical and derived output back together on projection failure", async () => {
    await expect(
      runCmsTransaction(root, "fault injection", () => {
        fs.writeFileSync(canonical, "after-canonical");
        fs.writeFileSync(projection, "partial-projection");
        throw new Error("injected projection failure");
      }),
    ).rejects.toThrow("injected projection failure");

    expect(fs.readFileSync(canonical, "utf8")).toBe("before-canonical");
    expect(fs.readFileSync(projection, "utf8")).toBe("before-projection");
    expect(
      fs.readdirSync(path.join(root, ".aria", "transactions")),
    ).toEqual([]);
    const recoveryRoot = path.join(root, ".aria", "recovery");
    const recovery = fs.readdirSync(recoveryRoot);
    expect(recovery).toHaveLength(1);
    expect(
      fs.readFileSync(
        path.join(recoveryRoot, recovery[0]!, "files", "src", "content", "posts", "entry.md"),
        "utf8",
      ),
    ).toBe("partial-projection");
  });

  it("commits canonical and projection state as one completed operation", async () => {
    await runCmsTransaction(root, "commit", () => {
      fs.writeFileSync(canonical, "after-canonical");
      fs.writeFileSync(projection, "after-projection");
    });
    expect(fs.readFileSync(canonical, "utf8")).toBe("after-canonical");
    expect(fs.readFileSync(projection, "utf8")).toBe("after-projection");
    expect(
      fs.readdirSync(path.join(root, ".aria", "transactions")),
    ).toEqual([]);
  });

  it("commits deletions from the complete staged after-state", async () => {
    await runCmsTransaction(root, "delete", () => {
      fs.rmSync(canonical);
      fs.writeFileSync(projection, "replacement-projection");
    });
    expect(fs.existsSync(canonical)).toBe(false);
    expect(fs.readFileSync(projection, "utf8")).toBe("replacement-projection");
    expect(fs.readdirSync(path.join(root, ".aria", "transactions"))).toEqual([]);
  });

  it("runs the next queued mutation after the prior mutation rolls back", async () => {
    let releaseFirst!: () => void;
    const firstCanFail = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = runCmsTransaction(root, "first", async () => {
      fs.writeFileSync(canonical, "failed-first");
      await firstCanFail;
      throw new Error("first failed");
    });
    const second = runCmsTransaction(root, "second", () => {
      fs.writeFileSync(canonical, "committed-second");
    });

    releaseFirst();
    await expect(first).rejects.toThrow("first failed");
    await expect(second).resolves.toBeUndefined();
    expect(fs.readFileSync(canonical, "utf8")).toBe("committed-second");
  });

  it("keeps multiple waiters serialized behind the same transaction", async () => {
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    let markSecondStarted!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const secondStarted = new Promise<void>((resolve) => { markSecondStarted = resolve; });
    let thirdStarted = false;

    const first = runCmsTransaction(root, "first", () => firstGate);
    const second = runCmsTransaction(root, "second", async () => {
      markSecondStarted();
      await secondGate;
    });
    const third = runCmsTransaction(root, "third", () => {
      thirdStarted = true;
    });

    releaseFirst();
    await secondStarted;
    await Promise.resolve();
    expect(thirdStarted).toBe(false);
    releaseSecond();
    await Promise.all([first, second, third]);
    expect(thirdStarted).toBe(true);
  });

  it("serializes recovery behind an active transaction", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const active = runCmsTransaction(root, "active", async () => {
      fs.writeFileSync(canonical, "active-write");
      await gate;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    let recoveryFinished = false;
    const recovery = recoverCmsTransactions(root).then((count) => {
      recoveryFinished = true;
      return count;
    });
    await Promise.resolve();
    expect(recoveryFinished).toBe(false);

    release();
    await active;
    await expect(recovery).resolves.toBe(0);
  });
});
