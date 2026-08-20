import { execFileSync } from "node:child_process";
import fs from "node:fs";

let cachedLoginPath: string | null | undefined;

/**
 * Candidate login shells for resolving a full user PATH (nvm/asdf/fnm, etc.).
 * Prefer $SHELL on Linux, then fall back to bash — fish/nushell do not accept -ilc.
 */
function loginShellCandidates(): string[] {
  if (process.platform === "darwin") return ["/bin/zsh"];
  if (process.platform === "linux") {
    const candidates: string[] = [];
    const shell = process.env.SHELL;
    if (shell && shell.startsWith("/") && fs.existsSync(shell)) {
      candidates.push(shell);
    }
    if (!candidates.includes("/bin/bash") && fs.existsSync("/bin/bash")) {
      candidates.push("/bin/bash");
    }
    return candidates;
  }
  return [];
}

function readLoginPath(shell: string): string | null {
  try {
    const output = execFileSync(shell, ["-ilc", "printenv PATH"], {
      encoding: "utf8",
      timeout: 2_000,
      killSignal: "SIGKILL",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.trim() || null;
  } catch {
    return null;
  }
}

/** Read a REG_SZ / REG_EXPAND_SZ Path value from `reg query` output. */
function parseRegPathValue(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    // REG_EXPAND_SZ    C:\...\nodejs;%USERPROFILE%\...
    const match = line.match(
      /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.+)$/i,
    );
    if (match?.[1]) return match[1].trim() || null;
  }
  return null;
}

function readRegistryPath(key: string): string | null {
  try {
    const output = execFileSync(
      "reg",
      ["query", key, "/v", "Path"],
      {
        encoding: "utf8",
        timeout: 2_000,
        killSignal: "SIGKILL",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      },
    );
    const raw = parseRegPathValue(output);
    if (!raw) return null;
    // Expand common %VAR% tokens so node/npm resolve without a shell.
    return raw.replace(/%([^%]+)%/g, (full, name: string) => {
      const value = process.env[name] ?? process.env[name.toUpperCase()];
      return value ?? full;
    });
  } catch {
    return null;
  }
}

/** User + system Path from the registry (what Explorer/Start Menu inherit). */
function windowsRegistryPath(): string | null {
  const parts = [
    readRegistryPath(
      "HKCU\\Environment",
    ),
    readRegistryPath(
      "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
    ),
  ].filter((p): p is string => Boolean(p));
  if (parts.length === 0) return null;
  // Deduplicate while preserving order (user before system).
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const part of parts.join(";").split(";")) {
    const entry = part.trim();
    if (!entry) continue;
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return merged.length > 0 ? merged.join(";") : null;
}

function enrichedToolPath(): string | null {
  if (cachedLoginPath !== undefined) return cachedLoginPath;
  if (process.platform === "win32") {
    cachedLoginPath = windowsRegistryPath();
    return cachedLoginPath;
  }
  for (const shell of loginShellCandidates()) {
    const path = readLoginPath(shell);
    if (path) {
      cachedLoginPath = path;
      return cachedLoginPath;
    }
  }
  cachedLoginPath = null;
  return null;
}

function pathDelimiter(): string {
  return process.platform === "win32" ? ";" : ":";
}

function withToolPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const toolPath = enrichedToolPath();
  if (!toolPath) return env;
  const sep = pathDelimiter();
  return {
    ...env,
    PATH: env.PATH ? `${toolPath}${sep}${env.PATH}` : toolPath,
  };
}

const NETWORK_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NPM_CONFIG_CAFILE",
  "GIT_SSL_CAINFO",
] as const;

function copyAllowedEnvironment(
  env: NodeJS.ProcessEnv,
  keys: readonly string[],
): void {
  const allowed = new Set(keys.map((key) => key.toUpperCase()));
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && allowed.has(key.toUpperCase())) env[key] = value;
  }
}

/** Environment for a user project process launched from the desktop app. */
export function projectProcessEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    FORCE_COLOR: "0",
    BROWSER: "none",
  };
  copyAllowedEnvironment(env, [
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "TERM",
    "COLORTERM",
    "SystemRoot",
    "ComSpec",
    "PATHEXT",
    ...NETWORK_ENV_KEYS,
  ]);
  return withToolPath(
    process.env.PATH ? { ...env, PATH: process.env.PATH } : env,
  );
}

/** Minimal environment for package-manager installation scripts. */
export function packageManagerEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    CI: "1",
  };
  copyAllowedEnvironment(env, [
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "SystemRoot",
    "ComSpec",
    "PATHEXT",
    ...NETWORK_ENV_KEYS,
  ]);
  return withToolPath(
    process.env.PATH ? { ...env, PATH: process.env.PATH } : env,
  );
}
