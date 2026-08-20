import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ptys: Array<{ write: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn> }> = [];
vi.mock("node-pty", () => ({
  spawn: vi.fn(() => {
    const pty = {
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
    };
    ptys.push(pty);
    return pty;
  }),
}));
vi.mock("electron", () => ({
  webContents: { fromId: vi.fn(() => null) },
}));

import {
  createTerminalSession,
  disposeAllTerminals,
  writeTerminal,
} from "./terminal";

const roots: string[] = [];
afterEach(() => {
  disposeAllTerminals();
  ptys.length = 0;
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
});

describe("terminal window ownership", () => {
  it("creates separate PTYs per window and rejects cross-window input", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aria-terminal-owner-"));
    roots.push(cwd);
    const first = createTerminalSession({ cwd, webContents: { id: 1 } as never });
    const second = createTerminalSession({ cwd, webContents: { id: 2 } as never });
    expect(first.id).not.toBe(second.id);
    expect(ptys).toHaveLength(2);

    expect(() => writeTerminal(first.id, "unsafe", 2)).toThrow(/another window/);
    writeTerminal(first.id, "safe", 1);
    expect(ptys[0]?.write).toHaveBeenCalledWith("safe");
  });
});
