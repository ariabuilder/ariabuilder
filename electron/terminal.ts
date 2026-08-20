import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { IPty } from "node-pty";
import * as pty from "node-pty";
import { webContents, type WebContents } from "electron";
import { projectProcessEnv } from "./toolEnv";

export type TerminalSessionInfo = {
  id: string;
  cwd: string;
};

type TerminalSession = {
  id: string;
  cwd: string;
  pty: IPty;
  webContentsId: number;
};

const sessions = new Map<string, TerminalSession>();
/** One live session per requesting window and project cwd. */
const sessionByOwnerCwd = new Map<string, string>();

function normalizeCwd(cwd: string): string {
  return path.resolve(cwd);
}

function ownerCwdKey(webContentsId: number, cwd: string): string {
  return `${webContentsId}:${normalizeCwd(cwd)}`;
}

function resolveShell(): { file: string; args: string[] } {
  if (process.platform === "win32") {
    const comspec = process.env.ComSpec?.trim();
    if (comspec && fs.existsSync(comspec)) {
      return { file: comspec, args: [] };
    }
    return { file: "powershell.exe", args: [] };
  }
  const shell = process.env.SHELL?.trim();
  if (shell && shell.startsWith("/") && fs.existsSync(shell)) {
    return { file: shell, args: ["-l"] };
  }
  if (fs.existsSync("/bin/zsh")) return { file: "/bin/zsh", args: ["-l"] };
  if (fs.existsSync("/bin/bash")) return { file: "/bin/bash", args: ["-l"] };
  return { file: "/bin/sh", args: ["-l"] };
}

/** Color-friendly env for interactive shells (PATH still from toolEnv). */
export function terminalProcessEnv(): NodeJS.ProcessEnv {
  const base = projectProcessEnv();
  const { FORCE_COLOR: _forceColor, ...rest } = base;
  return {
    ...rest,
    TERM: process.env.TERM || "xterm-256color",
    COLORTERM: process.env.COLORTERM || "truecolor",
    FORCE_COLOR: "1",
  };
}

function disposeSession(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  const key = ownerCwdKey(session.webContentsId, session.cwd);
  if (sessionByOwnerCwd.get(key) === id) {
    sessionByOwnerCwd.delete(key);
  }
  try {
    session.pty.kill();
  } catch {
    // Process may already have exited.
  }
}

function sendToOwner(
  webContentsId: number,
  channel: string,
  payload: unknown,
): void {
  try {
    const wc = webContents.fromId(webContentsId);
    if (!wc || wc.isDestroyed()) return;
    wc.send(channel, payload);
  } catch {
    // Owner window may have closed.
  }
}

export function createTerminalSession(opts: {
  cwd: string;
  cols?: number;
  rows?: number;
  webContents: WebContents;
}): TerminalSessionInfo {
  const cwd = normalizeCwd(opts.cwd);
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error(`Terminal cwd does not exist: ${cwd}`);
  }

  const key = ownerCwdKey(opts.webContents.id, cwd);
  const existingId = sessionByOwnerCwd.get(key);
  if (existingId) {
    const existing = sessions.get(existingId);
    if (existing) {
      const cols = Math.max(2, Math.floor(opts.cols ?? 80));
      const rows = Math.max(1, Math.floor(opts.rows ?? 24));
      try {
        existing.pty.resize(cols, rows);
      } catch {
        // Ignore resize failures on a dying PTY.
      }
      return { id: existing.id, cwd: existing.cwd };
    }
    sessionByOwnerCwd.delete(key);
  }

  const { file, args } = resolveShell();
  const cols = Math.max(2, Math.floor(opts.cols ?? 80));
  const rows = Math.max(1, Math.floor(opts.rows ?? 24));
  const id = randomUUID();

  const child = pty.spawn(file, args, {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: terminalProcessEnv() as Record<string, string>,
  });

  const session: TerminalSession = {
    id,
    cwd,
    pty: child,
    webContentsId: opts.webContents.id,
  };
  sessions.set(id, session);
  sessionByOwnerCwd.set(key, id);

  child.onData((data) => {
    sendToOwner(session.webContentsId, "terminal:data", { id, data });
  });

  child.onExit(({ exitCode }) => {
    sendToOwner(session.webContentsId, "terminal:exit", {
      id,
      exitCode: exitCode ?? 0,
    });
    sessions.delete(id);
    if (sessionByOwnerCwd.get(key) === id) {
      sessionByOwnerCwd.delete(key);
    }
  });

  return { id, cwd };
}

function ownedSession(id: string, webContentsId: number): TerminalSession {
  const session = sessions.get(id);
  if (!session) throw new Error("Terminal session not found");
  if (session.webContentsId !== webContentsId) {
    throw new Error("Terminal session belongs to another window");
  }
  return session;
}

export function writeTerminal(id: string, data: string, webContentsId: number): void {
  const session = ownedSession(id, webContentsId);
  if (typeof data !== "string") throw new Error("Terminal data must be a string");
  session.pty.write(data);
}

export function resizeTerminal(id: string, cols: number, rows: number, webContentsId: number): void {
  const session = ownedSession(id, webContentsId);
  const nextCols = Math.max(2, Math.floor(cols));
  const nextRows = Math.max(1, Math.floor(rows));
  session.pty.resize(nextCols, nextRows);
}

export function disposeTerminal(id: string, webContentsId: number): void {
  ownedSession(id, webContentsId);
  disposeSession(id);
}

export function disposeTerminalsForCwd(cwd: string): void {
  const normalized = normalizeCwd(cwd);
  for (const session of [...sessions.values()]) {
    if (normalizeCwd(session.cwd) === normalized) disposeSession(session.id);
  }
}

export function disposeTerminalsForOwnerCwd(webContentsId: number, cwd: string): void {
  const id = sessionByOwnerCwd.get(ownerCwdKey(webContentsId, cwd));
  if (id) disposeSession(id);
}

export function disposeAllTerminals(): void {
  for (const id of [...sessions.keys()]) {
    disposeSession(id);
  }
}

export function disposeTerminalsForWebContents(webContentsId: number): void {
  for (const session of [...sessions.values()]) {
    if (session.webContentsId === webContentsId) {
      disposeSession(session.id);
    }
  }
}

export function restartTerminalSession(opts: {
  id: string;
  cols?: number;
  rows?: number;
  webContents: WebContents;
}): TerminalSessionInfo {
  const prev = sessions.get(opts.id);
  if (prev && prev.webContentsId !== opts.webContents.id) {
    throw new Error("Terminal session belongs to another window");
  }
  const cwd = prev?.cwd;
  if (!cwd) throw new Error("Terminal session not found");
  disposeSession(opts.id);
  return createTerminalSession({
    cwd,
    cols: opts.cols,
    rows: opts.rows,
    webContents: opts.webContents,
  });
}
