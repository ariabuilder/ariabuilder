import { afterEach, describe, expect, it } from "vitest";
import {
  clearPendingConfirmationsForTests,
  clearPendingConfirmationsForProject,
  consumePendingConfirmation,
  denyPendingConfirmation,
  registerPendingConfirmation,
} from "./confirmationStore";

const proposed = {
  approvalId: "approval-1",
  toolCallId: "call-1",
  toolName: "aria_delete_entry",
  normalizedArgs: { collectionId: "posts", entryId: "one", version: "v1" },
  projectPath: "/project-a",
  webContentsId: 7,
};

afterEach(() => clearPendingConfirmationsForTests());

describe("pending agent confirmations", () => {
  it("is scoped to exact normalized arguments, project, and window", () => {
    registerPendingConfirmation({ ...proposed, now: 1_000 });
    expect(
      consumePendingConfirmation({
        ...proposed,
        webContentsId: 8,
        now: 2_000,
      }),
    ).toMatchObject({ ok: false });
    expect(
      consumePendingConfirmation({
        ...proposed,
        normalizedArgs: { ...proposed.normalizedArgs, entryId: "two" },
        now: 2_000,
      }),
    ).toMatchObject({ ok: false });
    expect(
      consumePendingConfirmation({ ...proposed, now: 2_000 }),
    ).toMatchObject({ ok: true, normalizedArgs: proposed.normalizedArgs });
  });

  it("expires and cannot be replayed", () => {
    registerPendingConfirmation({ ...proposed, now: 1_000 });
    expect(
      consumePendingConfirmation({ ...proposed, now: 301_001 }),
    ).toMatchObject({ ok: false });

    registerPendingConfirmation({ ...proposed, now: 1_000 });
    expect(
      consumePendingConfirmation({ ...proposed, now: 2_000 }),
    ).toMatchObject({ ok: true });
    expect(
      consumePendingConfirmation({ ...proposed, now: 2_001 }),
    ).toMatchObject({ ok: false });
  });

  it("removes a denied confirmation without executing it", () => {
    registerPendingConfirmation(proposed);
    denyPendingConfirmation(proposed);
    expect(consumePendingConfirmation(proposed)).toMatchObject({ ok: false });
  });

  it("clears pending work when its project closes", () => {
    registerPendingConfirmation(proposed);
    clearPendingConfirmationsForProject(proposed.projectPath);
    expect(consumePendingConfirmation(proposed)).toMatchObject({ ok: false });
  });
});
