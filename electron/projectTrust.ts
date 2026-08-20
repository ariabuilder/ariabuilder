import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  ProjectTrustChallenge,
  ProjectTrustOrigin,
  ProjectTrustRevocationResult,
} from "../shared/types";
import { canonicalDirectory, writeTextFileAtomic } from "./pathSafety";

const STORE_VERSION = 2;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

type DirectoryIdentity = {
  dev?: string;
  ino?: string;
  birthtimeMs: number;
};

type TrustRecord = {
  path: string;
  identity: DirectoryIdentity;
  origin: ProjectTrustOrigin;
  approvedAt: string;
};

type TrustStore = {
  version: typeof STORE_VERSION;
  projects: TrustRecord[];
};

type PendingChallenge = ProjectTrustChallenge & {
  ownerId: number;
  expiresAt: number;
  origin: ProjectTrustOrigin;
};

const pendingChallenges = new Map<string, PendingChallenge>();

function trustStorePath(userData: string): string {
  fs.mkdirSync(userData, { recursive: true });
  return path.join(userData, "project-trust.json");
}

function pathKey(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function directoryIdentity(projectPath: string): DirectoryIdentity {
  const stat = fs.statSync(projectPath, { bigint: true });
  const dev = stat.dev > 0n ? stat.dev.toString() : undefined;
  const ino = stat.ino > 0n ? stat.ino.toString() : undefined;
  return {
    ...(dev ? { dev } : {}),
    ...(ino ? { ino } : {}),
    birthtimeMs: Number(stat.birthtimeMs),
  };
}

function sameIdentity(a: DirectoryIdentity, b: DirectoryIdentity): boolean {
  if (a.birthtimeMs !== b.birthtimeMs) return false;
  if (a.dev && a.ino && b.dev && b.ino) {
    return a.dev === b.dev && a.ino === b.ino;
  }
  return !a.dev && !a.ino && !b.dev && !b.ino;
}

function readStore(userData: string): TrustStore {
  const file = trustStorePath(userData);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<TrustStore>;
    if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.projects)) {
      return { version: STORE_VERSION, projects: [] };
    }
    const projects = parsed.projects.filter((record): record is TrustRecord =>
      Boolean(
        record &&
          typeof record === "object" &&
          typeof record.path === "string" &&
          record.identity &&
          typeof record.identity === "object" &&
          Number.isFinite(record.identity.birthtimeMs) &&
          ((typeof record.identity.dev === "string" &&
            typeof record.identity.ino === "string") ||
            (record.identity.dev === undefined &&
              record.identity.ino === undefined)) &&
          typeof record.origin === "string" &&
          typeof record.approvedAt === "string",
      ),
    );
    return { version: STORE_VERSION, projects };
  } catch {
    // Missing and corrupt stores both fail closed. Never infer trust from recents.
    return { version: STORE_VERSION, projects: [] };
  }
}

function writeStore(userData: string, store: TrustStore): void {
  writeTextFileAtomic(
    trustStorePath(userData),
    `${JSON.stringify(store, null, 2)}\n`,
  );
}

export function isProjectTrusted(userData: string, projectPath: string): boolean {
  const canonical = canonicalDirectory(projectPath);
  const identity = directoryIdentity(canonical);
  const record = readStore(userData).projects.find(
    (candidate) => pathKey(candidate.path) === pathKey(canonical),
  );
  return Boolean(record && sameIdentity(record.identity, identity));
}

export function trustProject(
  userData: string,
  projectPath: string,
  origin: ProjectTrustOrigin,
): void {
  const canonical = canonicalDirectory(projectPath);
  const store = readStore(userData);
  const next: TrustRecord = {
    path: canonical,
    identity: directoryIdentity(canonical),
    origin,
    approvedAt: new Date().toISOString(),
  };
  store.projects = [
    next,
    ...store.projects.filter(
      (record) => pathKey(record.path) !== pathKey(canonical),
    ),
  ];
  writeStore(userData, store);
}

export function createProjectTrustChallenge(input: {
  projectPath: string;
  ownerId: number;
  origin?: ProjectTrustOrigin;
}): ProjectTrustChallenge {
  const canonical = canonicalDirectory(input.projectPath);
  const challenge: PendingChallenge = {
    id: randomUUID(),
    projectPath: canonical,
    projectName: path.basename(canonical) || canonical,
    ownerId: input.ownerId,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
    origin: input.origin ?? "user-approved",
  };
  pendingChallenges.set(challenge.id, challenge);
  return {
    id: challenge.id,
    projectPath: challenge.projectPath,
    projectName: challenge.projectName,
  };
}

export function consumeProjectTrustChallenge(input: {
  userData: string;
  challengeId: string;
  ownerId: number;
}): string {
  const challenge = pendingChallenges.get(input.challengeId);
  pendingChallenges.delete(input.challengeId);
  if (!challenge || challenge.ownerId !== input.ownerId) {
    throw new Error("Project trust request is invalid or has already been used");
  }
  if (challenge.expiresAt < Date.now()) {
    throw new Error("Project trust request expired; open the project again");
  }
  trustProject(input.userData, challenge.projectPath, challenge.origin);
  return challenge.projectPath;
}

export function discardProjectTrustChallengesForOwner(ownerId: number): void {
  for (const [id, challenge] of pendingChallenges) {
    if (challenge.ownerId === ownerId) pendingChallenges.delete(id);
  }
}

export function revokeProjectTrust(
  userData: string,
  projectPath: string,
): ProjectTrustRevocationResult {
  const canonical = canonicalDirectory(projectPath);
  const store = readStore(userData);
  const projects = store.projects.filter(
    (record) => pathKey(record.path) !== pathKey(canonical),
  );
  if (projects.length === store.projects.length) {
    return { status: "not_trusted", projectPath: canonical };
  }
  writeStore(userData, { ...store, projects });
  return { status: "revoked", projectPath: canonical };
}
