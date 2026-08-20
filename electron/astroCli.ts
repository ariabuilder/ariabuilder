import fs from "node:fs";
import path from "node:path";
import { isPathInside } from "./pathSafety";

export type LocalAstroCommand = {
  entry: string;
  args: string[];
};

/** Resolve only the project's declared Astro package entry; never PATH or .bin shims. */
export function resolveLocalAstroCommand(
  projectRoot: string,
  args: readonly string[],
): LocalAstroCommand | null {
  const packageRoot = path.join(projectRoot, "node_modules", "astro");
  const packageFile = path.join(packageRoot, "package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.astro;
    if (!bin) return null;
    const entry = path.resolve(packageRoot, bin);
    if (!fs.statSync(entry).isFile() || !isPathInside(packageRoot, entry)) {
      return null;
    }
    return { entry, args: [entry, ...args] };
  } catch {
    return null;
  }
}
