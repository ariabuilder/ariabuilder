import { resolveLocalAstroCommand } from "../astroCli";
import { spawnElectronNode } from "../processLaunch";
import { packageManagerEnv } from "../toolEnv";

export function runAstroSync(
  root: string,
  onLog: (chunk: string) => void,
): Promise<void> {
  const command = resolveLocalAstroCommand(root, ["sync"]);
  if (!command) {
    return Promise.reject(new Error("The project-local Astro CLI is unavailable after installation."));
  }
  onLog("> astro sync\n\n");
  return new Promise((resolve, reject) => {
    const child = spawnElectronNode(command.args, {
      cwd: root,
      env: packageManagerEnv(),
      windowsHide: true,
    });
    const append = (buffer: Buffer) => {
      const text = buffer.toString("utf8").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
      if (text) onLog(text);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("error", (error) => reject(new Error(`Could not run Astro sync: ${error.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Astro sync failed${code === null ? "" : ` with code ${code}`}.`));
    });
  });
}
