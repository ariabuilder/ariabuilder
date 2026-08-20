import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeSession,
  getSession,
  openSession,
  requireSessionOwner,
  sessionOwnerCount,
  stopAllSessions,
} from "./sessions";
import { configureMutationCoordinator } from "./mutations";

const roots: string[] = [];
afterEach(async () => {
  await stopAllSessions();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("project session ownership", () => {
  it("keeps shared infrastructure alive until the final window releases it", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-session-owner-"));
    roots.push(root);
    configureMutationCoordinator(path.join(root, "user-data"));
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { astro: "1.0.0" } }));
    await openSession(root, 11);
    await openSession(root, 22);
    expect(sessionOwnerCount(root)).toBe(2);
    expect(requireSessionOwner(root, 11)).toBe(fs.realpathSync.native(root));
    expect(() => requireSessionOwner(root, 33)).toThrow(/not attached/);

    expect(await closeSession(root, 11)).toBe(false);
    expect(getSession(root)).not.toBeNull();
    expect(sessionOwnerCount(root)).toBe(1);
    expect(await closeSession(root, 22)).toBe(true);
    expect(getSession(root)).toBeNull();
  });

  it("clears every reserved owner when a concurrent first-open fails", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-session-owner-fail-"));
    roots.push(root);
    configureMutationCoordinator(path.join(root, "user-data"));
    const results = await Promise.allSettled([
      openSession(root, 11),
      openSession(root, 22),
    ]);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(sessionOwnerCount(root)).toBe(0);
    expect(getSession(root)).toBeNull();
  });
});
