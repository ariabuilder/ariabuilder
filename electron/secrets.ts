import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import { writeTextFileAtomic } from "./pathSafety";
import {
  CREDENTIAL_BACKEND_IDS,
  StoredProviderCredentialsSchema,
  type ConfiguredBackends,
  type CredentialBackendId,
  type CredentialStorageCapability,
  type CredentialStorageKind,
  type StoredProviderCredentials,
  type UpdateAgentProviderInput,
} from "../shared/agent";

type EncryptedCredential = {
  ciphertext: string;
  encoding: "safeStorage";
  storage?: "keychain" | "insecure";
};

type CredentialStoreFile = {
  version: 3;
  legacyCredentials: Partial<
    Record<CredentialBackendId, EncryptedCredential>
  >;
  profiles: Record<
    string,
    EncryptedCredential & { backend: CredentialBackendId }
  >;
};

const sessionCredentials = new Map<string, StoredProviderCredentials>();

function legacyKey(backend: CredentialBackendId): string {
  return `legacy:${backend}`;
}

function credentialsPath(userData: string): string {
  mkdirSync(userData, { recursive: true });
  return path.join(userData, "agent-credentials.json");
}

function readStore(userData: string): CredentialStoreFile {
  const file = credentialsPath(userData);
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (
      !raw ||
      typeof raw !== "object" ||
      ![1, 2, 3].includes(Number((raw as { version?: unknown }).version))
    ) {
      return { version: 3, legacyCredentials: {}, profiles: {} };
    }
    if ((raw as { version: number }).version === 1) {
      return {
        version: 3,
        legacyCredentials:
          (raw as { credentials?: CredentialStoreFile["legacyCredentials"] })
            .credentials ?? {},
        profiles: {},
      };
    }
    return {
      version: 3,
      legacyCredentials:
        (raw as CredentialStoreFile).legacyCredentials ?? {},
      profiles: (raw as CredentialStoreFile).profiles ?? {},
    };
  } catch {
    if (existsSync(file)) {
      try {
        renameSync(file, `${file}.corrupt-${Date.now()}`);
      } catch {
        // ignore
      }
    }
    return { version: 3, legacyCredentials: {}, profiles: {} };
  }
}

function writeStore(userData: string, store: CredentialStoreFile): void {
  writeTextFileAtomic(
    credentialsPath(userData),
    `${JSON.stringify(store, null, 2)}\n`,
  );
}

function encryptPayload(plaintext: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "SECURE_STORAGE_UNAVAILABLE: Secure credential storage is unavailable on this system",
    );
  }
  return safeStorage.encryptString(plaintext).toString("base64");
}

export function getCredentialStorageCapability(): CredentialStorageCapability {
  const persistent = safeStorage.isEncryptionAvailable();
  const backend =
    typeof safeStorage.getSelectedStorageBackend === "function"
      ? safeStorage.getSelectedStorageBackend()
      : persistent
        ? "unknown-secure"
        : "unavailable";
  const secure = persistent && backend !== "basic_text";
  return {
    backend,
    secure,
    persistent,
    defaultStorage: secure ? "keychain" : "session",
  };
}

function persistentStorageKind(): "keychain" | "insecure" | null {
  const capability = getCredentialStorageCapability();
  if (!capability.persistent) return null;
  return capability.secure ? "keychain" : "insecure";
}

function decryptPayload(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, "base64");
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "SECURE_STORAGE_UNAVAILABLE: Secure credential storage is unavailable on this system",
    );
  }
  return safeStorage.decryptString(buf);
}

function isSecureStorageUnavailable(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith("SECURE_STORAGE_UNAVAILABLE:")
  );
}

function decryptCredentialEntry(
  entry: EncryptedCredential,
): StoredProviderCredentials | null {
  if (!entry.ciphertext) return null;
  const persistence = persistentStorageKind();
  if (!persistence) {
    throw new Error(
      "SECURE_STORAGE_UNAVAILABLE: Secure credential storage is unavailable on this system",
    );
  }
  if (persistence === "insecure" && entry.storage !== "insecure") return null;
  try {
    const parsed = JSON.parse(decryptPayload(entry.ciphertext)) as unknown;
    const result = StoredProviderCredentialsSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch (error) {
    // An unavailable keychain is materially different from corrupt or stale
    // credentials. Callers must surface it and must not silently treat an
    // existing encrypted profile as unconfigured.
    if (isSecureStorageUnavailable(error)) throw error;
    return null;
  }
}

function clearBackendProfiles(
  store: CredentialStoreFile,
  backend: CredentialBackendId,
): void {
  for (const [id, profile] of Object.entries(store.profiles)) {
    if (profile.backend === backend) {
      delete store.profiles[id];
      sessionCredentials.delete(id);
    }
  }
}

/**
 * Persist a resolved ciphertext under the requested instance id (and legacy
 * mirror) so subsequent loads hit the direct path.
 */
function healInstanceProfile(
  userData: string,
  store: CredentialStoreFile,
  backend: CredentialBackendId,
  profileId: string,
  encrypted: EncryptedCredential,
): void {
  store.profiles[profileId] = {
    ...encrypted,
    backend,
  };
  store.legacyCredentials[backend] = {
    ciphertext: encrypted.ciphertext,
    encoding: "safeStorage",
    storage: encrypted.storage,
  };
  writeStore(userData, store);
}

function findBestSiblingProfile(
  store: CredentialStoreFile,
  backend: CredentialBackendId,
  excludeProfileId?: string,
): {
  id: string;
  entry: EncryptedCredential & { backend: CredentialBackendId };
  credentials: StoredProviderCredentials;
} | null {
  let best: {
    id: string;
    entry: EncryptedCredential & { backend: CredentialBackendId };
    credentials: StoredProviderCredentials;
  } | null = null;

  for (const [id, profile] of Object.entries(store.profiles)) {
    if (profile.backend !== backend || !profile.ciphertext) continue;
    if (excludeProfileId && id === excludeProfileId) continue;
    const credentials = decryptCredentialEntry(profile);
    if (!credentials) continue;
    if (
      !best ||
      (credentials.updatedAt ?? "") > (best.credentials.updatedAt ?? "")
    ) {
      best = { id, entry: profile, credentials };
    }
  }
  return best;
}

export function listConfiguredBackends(userData: string): ConfiguredBackends {
  const out: ConfiguredBackends = {};
  for (const backend of CREDENTIAL_BACKEND_IDS) {
    try {
      out[backend] = Boolean(loadProviderCredentials(userData, backend));
    } catch {
      out[backend] = false;
    }
  }
  return out;
}

/**
 * Backfill legacyCredentials from instance profiles when the mirror is missing
 * (stores written before instance saves also updated the backend lazy default).
 */
export function ensureLegacyCredentialMirrors(userData: string): void {
  if (!safeStorage.isEncryptionAvailable()) return;
  const store = readStore(userData);
  let changed = false;
  for (const backend of CREDENTIAL_BACKEND_IDS) {
    if (store.legacyCredentials[backend]?.ciphertext) continue;
    const sibling = findBestSiblingProfile(store, backend);
    if (!sibling) continue;
    store.legacyCredentials[backend] = {
      ciphertext: sibling.entry.ciphertext,
      encoding: "safeStorage",
      storage: sibling.entry.storage,
    };
    changed = true;
  }
  if (changed) writeStore(userData, store);
}

export function loadProviderCredentials(
  userData: string,
  backend: CredentialBackendId,
  profileId?: string,
): StoredProviderCredentials | null {
  const key = profileId ?? legacyKey(backend);
  const session = sessionCredentials.get(key);
  if (session) return session;

  const store = readStore(userData);

  if (profileId) {
    const entry =
      store.profiles[profileId]?.backend === backend
        ? store.profiles[profileId]
        : undefined;
    if (entry?.ciphertext) {
      return decryptCredentialEntry(entry);
    }

    // Existing backend-keyed credentials remain the lazy default until the user
    // edits credentials for a specific provider instance.
    const legacy = store.legacyCredentials[backend];
    if (legacy?.ciphertext) {
      const credentials = decryptCredentialEntry(legacy);
      if (credentials) {
        healInstanceProfile(userData, store, backend, profileId, legacy);
        return credentials;
      }
    }

    // Heal orphaned stores where a key was saved under another instance UUID
    // (e.g. another project) without a legacy mirror.
    const sibling = findBestSiblingProfile(store, backend, profileId);
    if (sibling) {
      healInstanceProfile(userData, store, backend, profileId, sibling.entry);
      return sibling.credentials;
    }
    return null;
  }

  const legacy = store.legacyCredentials[backend];
  if (legacy?.ciphertext) {
    return decryptCredentialEntry(legacy);
  }

  const sibling = findBestSiblingProfile(store, backend);
  return sibling?.credentials ?? null;
}

export function saveProviderCredentials(
  userData: string,
  input: Omit<UpdateAgentProviderInput, "persistence"> & {
    persistence?: "session" | "persistent";
  },
): { configured: true; storage: CredentialStorageKind } {
  const credentials: StoredProviderCredentials =
    StoredProviderCredentialsSchema.parse({
      apiKey: input.apiKey,
      // Instance profiles keep endpoints in validated project settings. The
      // legacy backend profile retains its historical endpoint for migration.
      baseUrl: input.instanceId ? undefined : input.baseUrl,
      updatedAt: new Date().toISOString(),
    });

  const key = input.instanceId ?? legacyKey(input.provider);
  const capability = getCredentialStorageCapability();
  if (
    input.persistence === "session" ||
    !capability.persistent ||
    (!capability.secure &&
      input.insecurePersistenceConfirmation !== "PERSIST_INSECURELY")
  ) {
    sessionCredentials.set(key, credentials);
    sessionCredentials.set(legacyKey(input.provider), credentials);
    return { configured: true, storage: "session" };
  }
  sessionCredentials.delete(key);
  sessionCredentials.delete(legacyKey(input.provider));
  const store = readStore(userData);
  const encrypted = {
    ciphertext: encryptPayload(JSON.stringify(credentials)),
    encoding: "safeStorage" as const,
    storage: capability.secure ? "keychain" as const : "insecure" as const,
  };
  if (input.instanceId) {
    // BYOK is user-level per provider type: mirror into legacy so any new
    // instance UUID (other projects / re-add) can resolve the same key.
    store.profiles[input.instanceId] = {
      ...encrypted,
      backend: input.provider,
    };
    store.legacyCredentials[input.provider] = encrypted;
  } else {
    store.legacyCredentials[input.provider] = encrypted;
  }
  writeStore(userData, store);
  return { configured: true, storage: encrypted.storage };
}

export function removeProviderCredentials(
  userData: string,
  backend: CredentialBackendId,
  profileId?: string,
): { removed: true } {
  sessionCredentials.delete(profileId ?? legacyKey(backend));
  sessionCredentials.delete(legacyKey(backend));
  const store = readStore(userData);
  // Explicit key removal is a global BYOK disconnect for this provider type.
  // Clear the requested profile (if any), the legacy mirror, and sibling
  // profiles so cross-project fallback cannot resurrect the key.
  if (profileId && store.profiles[profileId]?.backend === backend) {
    delete store.profiles[profileId];
  }
  delete store.legacyCredentials[backend];
  clearBackendProfiles(store, backend);
  writeStore(userData, store);
  return { removed: true };
}

export function getProviderCredentialStatus(
  userData: string,
  backend: CredentialBackendId,
  profileId?: string,
): {
  configured: boolean;
  storage?: CredentialStorageKind;
  legacyInsecure?: boolean;
  baseUrl?: string;
  updatedAt?: string;
} {
  const creds = loadProviderCredentials(userData, backend, profileId);
  const store = readStore(userData);
  const persisted = profileId
    ? store.profiles[profileId]?.backend === backend
      ? store.profiles[profileId]
      : store.legacyCredentials[backend]
    : store.legacyCredentials[backend];
  if (!creds) {
    return {
      configured: false,
      ...(persistentStorageKind() === "insecure" &&
      persisted?.ciphertext &&
      persisted.storage !== "insecure"
        ? { storage: "insecure" as const, legacyInsecure: true }
        : {}),
    };
  }
  return {
    configured: true,
    storage: sessionCredentials.has(profileId ?? legacyKey(backend))
      ? "session"
      : persisted?.storage ?? "keychain",
    baseUrl: creds.baseUrl,
    updatedAt: creds.updatedAt,
  };
}

export function confirmLegacyInsecureCredentials(
  userData: string,
  backend: CredentialBackendId,
  profileId: string | undefined,
  confirmation: string,
): { configured: true; storage: "insecure" } {
  if (
    persistentStorageKind() !== "insecure" ||
    confirmation !== "PERSIST_INSECURELY"
  ) {
    throw new Error("INSECURE_STORAGE_CONFIRMATION_REQUIRED");
  }
  const store = readStore(userData);
  const legacy = store.legacyCredentials[backend];
  if (legacy?.ciphertext) legacy.storage = "insecure";
  if (profileId && store.profiles[profileId]?.backend === backend) {
    store.profiles[profileId]!.storage = "insecure";
  }
  for (const profile of Object.values(store.profiles)) {
    if (profile.backend === backend) profile.storage = "insecure";
  }
  writeStore(userData, store);
  if (!loadProviderCredentials(userData, backend, profileId)) {
    throw new Error("Saved credentials could not be read");
  }
  return { configured: true, storage: "insecure" };
}
