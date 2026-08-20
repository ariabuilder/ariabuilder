import { createHash } from "node:crypto";

const CONFIRMATION_TTL_MS = 5 * 60_000;

type PendingConfirmation = {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  normalizedArgs: unknown;
  argsDigest: string;
  projectPath: string;
  webContentsId: number;
  expiresAt: number;
};

const pending = new Map<string, PendingConfirmation>();

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function sweepExpired(now: number): void {
  for (const [approvalId, record] of pending) {
    if (record.expiresAt <= now) pending.delete(approvalId);
  }
}

export function registerPendingConfirmation(input: {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  normalizedArgs: unknown;
  projectPath: string;
  webContentsId: number;
  now?: number;
}): void {
  const now = input.now ?? Date.now();
  sweepExpired(now);
  pending.set(input.approvalId, {
    approvalId: input.approvalId,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    normalizedArgs: structuredClone(input.normalizedArgs),
    argsDigest: digest(input.normalizedArgs),
    projectPath: input.projectPath,
    webContentsId: input.webContentsId,
    expiresAt: now + CONFIRMATION_TTL_MS,
  });
}

export function consumePendingConfirmation(input: {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  normalizedArgs: unknown;
  projectPath: string;
  webContentsId: number;
  now?: number;
}): { ok: true; normalizedArgs: unknown } | { ok: false; reason: string } {
  const now = input.now ?? Date.now();
  sweepExpired(now);
  const record = pending.get(input.approvalId);
  if (!record) return { ok: false, reason: "Confirmation is expired or was already used." };
  if (
    record.projectPath !== input.projectPath ||
    record.webContentsId !== input.webContentsId
  ) {
    return { ok: false, reason: "Confirmation belongs to another project window." };
  }
  if (
    record.toolCallId !== input.toolCallId ||
    record.toolName !== input.toolName ||
    record.argsDigest !== digest(input.normalizedArgs)
  ) {
    return { ok: false, reason: "Confirmation arguments no longer match the proposed operation." };
  }
  pending.delete(input.approvalId);
  return { ok: true, normalizedArgs: structuredClone(record.normalizedArgs) };
}

export function denyPendingConfirmation(input: {
  approvalId: string;
  projectPath: string;
  webContentsId: number;
}): void {
  const record = pending.get(input.approvalId);
  if (
    record?.projectPath === input.projectPath &&
    record.webContentsId === input.webContentsId
  ) {
    pending.delete(input.approvalId);
  }
}

export function clearPendingConfirmationsForWebContents(webContentsId: number): void {
  for (const [approvalId, record] of pending) {
    if (record.webContentsId === webContentsId) pending.delete(approvalId);
  }
}

export function clearPendingConfirmationsForProject(projectPath: string): void {
  for (const [approvalId, record] of pending) {
    if (record.projectPath === projectPath) pending.delete(approvalId);
  }
}

export function clearPendingConfirmationsForTests(): void {
  pending.clear();
}
