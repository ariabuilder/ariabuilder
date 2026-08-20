import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  consumeProjectTrustChallenge,
  createProjectTrustChallenge,
  isProjectTrusted,
  revokeProjectTrust,
  trustProject,
} from "./projectTrust";

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-project-trust-"));
  roots.push(root);
  const userData = path.join(root, "user-data");
  const project = path.join(root, "project");
  fs.mkdirSync(project);
  return { root, userData, project };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("project trust", () => {
  it("fails closed until a renderer-bound, one-use challenge is approved", () => {
    const { userData, project } = fixture();
    expect(isProjectTrusted(userData, project)).toBe(false);
    const challenge = createProjectTrustChallenge({ projectPath: project, ownerId: 7 });
    expect(() => consumeProjectTrustChallenge({ userData, challengeId: challenge.id, ownerId: 8 })).toThrow(/invalid/);
    expect(isProjectTrusted(userData, project)).toBe(false);

    const retry = createProjectTrustChallenge({ projectPath: project, ownerId: 7 });
    expect(consumeProjectTrustChallenge({ userData, challengeId: retry.id, ownerId: 7 })).toBe(fs.realpathSync.native(project));
    expect(isProjectTrusted(userData, project)).toBe(true);
    expect(() => consumeProjectTrustChallenge({ userData, challengeId: retry.id, ownerId: 7 })).toThrow(/already been used/);
  });

  it("does not trust corrupt stores or a replacement at the same path", () => {
    const { userData, project } = fixture();
    trustProject(userData, project, "user-approved");
    expect(isProjectTrusted(userData, project)).toBe(true);

    fs.rmSync(project, { recursive: true });
    fs.mkdirSync(project);
    expect(isProjectTrusted(userData, project)).toBe(false);

    fs.writeFileSync(path.join(userData, "project-trust.json"), "not-json");
    expect(isProjectTrusted(userData, project)).toBe(false);
  });

  it("stores birth identity alongside device and inode", () => {
    const { userData, project } = fixture();
    trustProject(userData, project, "user-approved");

    const store = JSON.parse(
      fs.readFileSync(path.join(userData, "project-trust.json"), "utf8"),
    ) as {
      version: number;
      projects: Array<{
        identity: { dev?: string; ino?: string; birthtimeMs?: number };
      }>;
    };
    expect(store.version).toBe(2);
    expect(store.projects[0]?.identity.birthtimeMs).toBeTypeOf("number");
    if (store.projects[0]?.identity.dev && store.projects[0]?.identity.ino) {
      expect(store.projects[0].identity).toEqual(
        expect.objectContaining({
          dev: expect.any(String),
          ino: expect.any(String),
          birthtimeMs: expect.any(Number),
        }),
      );
    }
  });

  it("rejects a changed birth identity when device and inode still match", () => {
    const { userData, project } = fixture();
    trustProject(userData, project, "user-approved");
    const file = path.join(userData, "project-trust.json");
    const store = JSON.parse(fs.readFileSync(file, "utf8")) as {
      projects: Array<{ identity: { birthtimeMs: number } }>;
    };

    store.projects[0]!.identity.birthtimeMs += 1;
    fs.writeFileSync(file, JSON.stringify(store));
    expect(isProjectTrusted(userData, project)).toBe(false);
  });

  it("fails closed for v1 and incomplete v2 trust records", () => {
    const { userData, project } = fixture();
    trustProject(userData, project, "user-approved");
    const file = path.join(userData, "project-trust.json");
    const store = JSON.parse(fs.readFileSync(file, "utf8")) as {
      version: number;
      projects: Array<{ identity: { birthtimeMs?: number } }>;
    };

    fs.writeFileSync(file, JSON.stringify({ ...store, version: 1 }));
    expect(isProjectTrusted(userData, project)).toBe(false);

    delete store.projects[0]?.identity.birthtimeMs;
    fs.writeFileSync(file, JSON.stringify(store));
    expect(isProjectTrusted(userData, project)).toBe(false);
  });

  it("revokes persisted trust without touching the project", () => {
    const { userData, project } = fixture();
    trustProject(userData, project, "aria-created");
    expect(revokeProjectTrust(userData, project).status).toBe("revoked");
    expect(isProjectTrusted(userData, project)).toBe(false);
    expect(fs.existsSync(project)).toBe(true);
  });
});
