import { execFile, spawn, type ExecFileOptions, type SpawnOptions } from "node:child_process";

export function electronNodeEnv(
  base: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return { ...base, ELECTRON_RUN_AS_NODE: "1" };
}

/** Launch JavaScript with Electron's embedded Node runtime, never a shell. */
export function spawnElectronNode(
  args: readonly string[],
  options: SpawnOptions = {},
) {
  return spawn(process.execPath, [...args], {
    ...options,
    env: electronNodeEnv(options.env),
    shell: false,
  });
}

export function execElectronNode(
  args: readonly string[],
  options: ExecFileOptions,
  callback: Parameters<typeof execFile>[3],
) {
  return execFile(
    process.execPath,
    [...args],
    { ...options, env: electronNodeEnv(options.env), shell: false },
    callback,
  );
}
