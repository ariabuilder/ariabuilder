import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { packageManagerEnv } from "../toolEnv";

export function quoteAstroExecutableForShell(
  executable: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32" ? `"${executable}"` : executable;
}

export function runAstroSync(
  root: string,
  onLog: (chunk: string) => void,
): Promise<void> {
  const executable = path.join(
    root,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "astro.cmd" : "astro",
  );
  if (!fs.existsSync(executable)) {
    return Promise.reject(new Error("The project-local Astro CLI is unavailable after installation."));
  }
  onLog("> astro sync\n\n");
  return new Promise((resolve, reject) => {
    const child = spawn(quoteAstroExecutableForShell(executable), ["sync"], {
      cwd: root,
      env: packageManagerEnv(),
      shell: process.platform === "win32",
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
