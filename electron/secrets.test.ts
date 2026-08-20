import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const secureStorageState = vi.hoisted(() => ({
  available: true,
  backend: "keychain" as string,
}));

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => secureStorageState.available,
    getSelectedStorageBackend: () => secureStorageState.backend,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value: Buffer) => {
      const text = value.toString("utf8");
      if (!text.startsWith("encrypted:")) throw new Error("invalid ciphertext");
      return text.slice("encrypted:".length);
    },
  },
}));

import {
  ensureLegacyCredentialMirrors,
  getProviderCredentialStatus,
  listConfiguredBackends,
  loadProviderCredentials,
  removeProviderCredentials,
  saveProviderCredentials,
} from "./secrets";
import { resolveProjectAgentSettings } from "./agent/projectSettings";

describe.sequential("provider credential profiles", () => {
  let userData = "";

  beforeEach(() => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), "aria-secrets-"));
    secureStorageState.available = true;
    secureStorageState.backend = "keychain";
  });

  afterEach(() => {
    fs.rmSync(userData, { recursive: true, force: true });
  });

  it("mirrors instance saves into legacy so a new instance UUID can resolve the key", () => {
    const instanceA = "2bb67ea8-a91c-4eed-ac2f-b90ea70384df";
    const instanceB = "9f3c1d2e-4a5b-6c7d-8e9f-0a1b2c3d4e5f";
    saveProviderCredentials(userData, {
      provider: "opencode",
      instanceId: instanceA,
      apiKey: "opencode-secret",
    });

    expect(loadProviderCredentials(userData, "opencode", instanceA)?.apiKey).toBe(
      "opencode-secret",
    );
    expect(loadProviderCredentials(userData, "opencode")?.apiKey).toBe(
      "opencode-secret",
    );
    expect(loadProviderCredentials(userData, "opencode", instanceB)?.apiKey).toBe(
      "opencode-secret",
    );
    expect(listConfiguredBackends(userData).opencode).toBe(true);
    expect(
      getProviderCredentialStatus(userData, "opencode", instanceB).configured,
    ).toBe(true);
  });

  it("activates the saved provider automatically in every project", () => {
    const projects = ["site-a", "site-b"].map((name) => {
      const root = path.join(userData, name);
      fs.mkdirSync(root);
      return root;
    });
    saveProviderCredentials(userData, {
      provider: "openai",
      instanceId: "2bb67ea8-a91c-4eed-ac2f-b90ea70384df",
      apiKey: "shared-openai-secret",
    });

    for (const project of projects) {
      const { settings, configuredBackends } = resolveProjectAgentSettings(
        userData,
        project,
      );
      const provider = Object.values(settings.inference.providerInstances)[0];
      expect(configuredBackends.openai).toBe(true);
      expect(provider).toMatchObject({ backend: "openai", enabled: true });
      expect(settings.inference.default?.instanceId).toBe(provider?.id);
      expect(
        JSON.parse(
          fs.readFileSync(
            path.join(project, ".aria", "site-settings.json"),
            "utf8",
          ),
        ).agent.inference.providerInstances,
      ).toHaveProperty(provider!.id);
    }
  });

  it("heals orphaned sibling profiles that predate the legacy mirror", () => {
    const instanceA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const instanceB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const credentials = {
      apiKey: "orphaned-secret",
      updatedAt: "2026-08-08T12:00:00.000Z",
    };
    fs.writeFileSync(
      path.join(userData, "agent-credentials.json"),
      JSON.stringify({
        version: 2,
        legacyCredentials: {},
        profiles: {
          [instanceA]: {
            ciphertext: Buffer.from(
              `encrypted:${JSON.stringify(credentials)}`,
              "utf8",
            ).toString("base64"),
            encoding: "safeStorage",
            backend: "openai",
          },
        },
      }),
    );

    expect(loadProviderCredentials(userData, "openai", instanceB)?.apiKey).toBe(
      "orphaned-secret",
    );

    const store = JSON.parse(
      fs.readFileSync(path.join(userData, "agent-credentials.json"), "utf8"),
    ) as {
      legacyCredentials: Record<string, { ciphertext?: string }>;
      profiles: Record<string, { backend?: string }>;
    };
    expect(store.profiles[instanceB]?.backend).toBe("openai");
    expect(store.legacyCredentials.openai?.ciphertext).toBeTruthy();
  });

  it("clears legacy and sibling profiles when removing a key", () => {
    const instanceA = "11111111-1111-4111-8111-111111111111";
    const instanceB = "22222222-2222-4222-8222-222222222222";
    saveProviderCredentials(userData, {
      provider: "openai",
      instanceId: instanceA,
      apiKey: "shared-secret",
    });
    // Simulate a second project that healed its own profile copy.
    saveProviderCredentials(userData, {
      provider: "openai",
      instanceId: instanceB,
      apiKey: "shared-secret",
    });

    removeProviderCredentials(userData, "openai", instanceA);

    expect(loadProviderCredentials(userData, "openai", instanceA)).toBeNull();
    expect(loadProviderCredentials(userData, "openai", instanceB)).toBeNull();
    expect(loadProviderCredentials(userData, "openai")).toBeNull();
    expect(listConfiguredBackends(userData).openai).toBeFalsy();
    expect(
      getProviderCredentialStatus(userData, "openai", instanceB).configured,
    ).toBe(false);
  });

  it("keeps legacy credentials readable until an instance save mirrors over them", () => {
    const legacy = {
      apiKey: "legacy-secret",
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(userData, "agent-credentials.json"),
      JSON.stringify({
        version: 1,
        credentials: {
          openai: {
            ciphertext: Buffer.from(
              `encrypted:${JSON.stringify(legacy)}`,
              "utf8",
            ).toString("base64"),
            encoding: "safeStorage",
          },
        },
      }),
    );

    expect(loadProviderCredentials(userData, "openai")?.apiKey).toBe(
      "legacy-secret",
    );
    const instanceId = "2bb67ea8-a91c-4eed-ac2f-b90ea70384df";
    expect(loadProviderCredentials(userData, "openai", instanceId)?.apiKey).toBe(
      "legacy-secret",
    );

    saveProviderCredentials(userData, {
      provider: "openai",
      instanceId,
      apiKey: "instance-secret",
    });
    expect(
      loadProviderCredentials(userData, "openai", instanceId)?.apiKey,
    ).toBe("instance-secret");
    expect(loadProviderCredentials(userData, "openai")?.apiKey).toBe(
      "instance-secret",
    );
  });

  it("uses session-only storage when secure storage is unavailable", () => {
    secureStorageState.available = false;
    const result = saveProviderCredentials(userData, {
      provider: "anthropic",
      instanceId: "be8ce8bd-2725-49e7-842f-30b21f14a419",
      apiKey: "secret-value",
      persistence: "persistent",
    });
    expect(result.storage).toBe("session");
    expect(fs.existsSync(path.join(userData, "agent-credentials.json"))).toBe(
      false,
    );
  });

  it("surfaces secure storage failure without deleting existing ciphertext", () => {
    const instanceId = "1b36103c-f3fa-478f-8f82-401251639fd6";
    saveProviderCredentials(userData, {
      provider: "openai",
      instanceId,
      apiKey: "instance-secret",
    });
    const file = path.join(userData, "agent-credentials.json");
    const before = fs.readFileSync(file, "utf8");

    secureStorageState.available = false;
    expect(() =>
      loadProviderCredentials(userData, "openai", instanceId),
    ).toThrow(/SECURE_STORAGE_UNAVAILABLE/);
    expect(removeProviderCredentials(userData, "openai", instanceId)).toEqual({
      removed: true,
    });
    expect(fs.readFileSync(file, "utf8")).not.toBe(before);
  });

  it("defaults Linux basic_text to session and persists only with explicit opt-in", () => {
    const instanceId = "1b36103c-f3fa-478f-8f82-401251639fd6";
    secureStorageState.backend = "basic_text";
    const session = saveProviderCredentials(userData, {
      provider: "openai",
      instanceId,
      apiKey: "session-secret",
      persistence: "persistent",
    });
    expect(session.storage).toBe("session");
    expect(fs.existsSync(path.join(userData, "agent-credentials.json"))).toBe(false);

    const persisted = saveProviderCredentials(userData, {
      provider: "openai",
      instanceId,
      apiKey: "persistent-secret",
      persistence: "persistent",
      insecurePersistenceConfirmation: "PERSIST_INSECURELY",
    });
    expect(persisted.storage).toBe("insecure");
    expect(getProviderCredentialStatus(userData, "openai", instanceId)).toMatchObject({
      configured: true,
      storage: "insecure",
    });
  });

  it("does not silently use legacy ciphertext on Linux basic_text", () => {
    const instanceId = "1b36103c-f3fa-478f-8f82-401251639fd6";
    const credentials = {
      apiKey: "legacy-basic-text-secret",
      updatedAt: "2026-08-08T12:00:00.000Z",
    };
    secureStorageState.backend = "basic_text";
    fs.writeFileSync(
      path.join(userData, "agent-credentials.json"),
      JSON.stringify({
        version: 2,
        legacyCredentials: {},
        profiles: {
          [instanceId]: {
            ciphertext: Buffer.from(
              `encrypted:${JSON.stringify(credentials)}`,
            ).toString("base64"),
            encoding: "safeStorage",
            backend: "openai",
          },
        },
      }),
    );
    expect(loadProviderCredentials(userData, "openai", instanceId)).toBeNull();
    expect(getProviderCredentialStatus(userData, "openai", instanceId)).toMatchObject({
      configured: false,
      storage: "insecure",
      legacyInsecure: true,
    });
  });

  it("backfills legacy mirrors from existing instance profiles", () => {
    const instanceA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const credentials = {
      apiKey: "mirror-me",
      updatedAt: "2026-08-08T12:00:00.000Z",
    };
    fs.writeFileSync(
      path.join(userData, "agent-credentials.json"),
      JSON.stringify({
        version: 2,
        legacyCredentials: {},
        profiles: {
          [instanceA]: {
            ciphertext: Buffer.from(
              `encrypted:${JSON.stringify(credentials)}`,
              "utf8",
            ).toString("base64"),
            encoding: "safeStorage",
            backend: "opencode",
          },
        },
      }),
    );

    ensureLegacyCredentialMirrors(userData);

    expect(loadProviderCredentials(userData, "opencode")?.apiKey).toBe(
      "mirror-me",
    );
    const instanceB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    expect(loadProviderCredentials(userData, "opencode", instanceB)?.apiKey).toBe(
      "mirror-me",
    );
  });
});
