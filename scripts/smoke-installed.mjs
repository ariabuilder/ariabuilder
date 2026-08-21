import { constants as fsConstants, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startExternalAstroPreview, stopProcessTree } from "./lib/external-astro-preview.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(path.join(tmpdir(), "aria-installed-smoke-"));
const fixtureSource = path.join(root, "tests", "fixtures", "astro-smoke");
const fixture = path.join(scratch, "astro-smoke");

cpSync(fixtureSource, fixture, {
  recursive: true,
  mode: fsConstants.COPYFILE_FICLONE,
  filter(source) {
    const relative = path.relative(fixtureSource, source).replace(/\\/g, "/");
    if (!relative) return true;
    return ![
      ".astro",
      ".aria",
      "src/aria",
      "src/middleware.ts",
    ].some((generated) => relative === generated || relative.startsWith(`${generated}/`));
  },
});

function firstRelease(suffix) {
  const releaseDir = path.join(root, "release");
  const file = readdirSync(releaseDir)
    .filter((name) => name.endsWith(suffix))
    .sort((left, right) => statSync(path.join(releaseDir, right)).mtimeMs - statSync(path.join(releaseDir, left)).mtimeMs)[0];
  if (!file) throw new Error(`No ${suffix} artifact found under release/`);
  return path.join(root, "release", file);
}

let executable;
let resourcesDir;
let mountedVolume;
let externalPreview;

try {
  if (process.platform === "darwin") {
    const dmg = firstRelease(".dmg");
    mountedVolume = path.join(scratch, "volume");
    execFileSync("mkdir", ["-p", mountedVolume]);
    execFileSync("hdiutil", ["attach", dmg, "-nobrowse", "-readonly", "-mountpoint", mountedVolume]);
    const source = path.join(mountedVolume, "Aria.app");
    const destination = path.join(scratch, "Aria.app");
    execFileSync("ditto", [source, destination]);
    executable = path.join(destination, "Contents", "MacOS", "Aria");
    resourcesDir = path.join(destination, "Contents", "Resources");
  } else if (process.platform === "win32") {
    const installer = firstRelease(".exe");
    const installDir = path.join(scratch, "Aria");
    execFileSync(installer, ["/S", `/D=${installDir}`], { windowsHide: true });
    executable = path.join(installDir, "Aria.exe");
    resourcesDir = path.join(installDir, "resources");
  } else {
    executable = firstRelease(".AppImage");
    execFileSync("chmod", ["+x", executable]);
    execFileSync(executable, ["--appimage-extract"], { cwd: scratch, stdio: "ignore" });
    const extracted = path.join(scratch, "squashfs-root");
    const desktop = readdirSync(extracted).find((name) => name.endsWith(".desktop"));
    if (!desktop) throw new Error("AppImage is missing desktop integration metadata");
    const metadata = readFileSync(path.join(extracted, desktop), "utf8");
    if (!/^Name=Aria$/m.test(metadata) || !/^Icon=\S+/m.test(metadata)) {
      throw new Error("AppImage desktop metadata is missing its Aria name or icon");
    }
    if (!existsSync(path.join(extracted, ".DirIcon"))) {
      throw new Error("AppImage is missing its desktop icon");
    }
    resourcesDir = path.join(extracted, "resources");
  }

  if (!existsSync(executable)) throw new Error(`Installed executable missing: ${executable}`);
  if (!resourcesDir) throw new Error("Installed resources directory could not be resolved");
  externalPreview = (await startExternalAstroPreview(fixture)).child;
  execFileSync(process.execPath, [path.join(root, "scripts", "smoke-packaged.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      ARIA_PACKAGED_EXECUTABLE: executable,
      ARIA_PACKAGED_RESOURCES_DIR: resourcesDir,
      ARIA_SMOKE_OPEN: fixture,
      ARIA_SMOKE_EXTERNAL_PID: String(externalPreview.pid),
    },
    stdio: "inherit",
  });
  console.log("smoke-installed: ok");
} finally {
  stopProcessTree(externalPreview);
  if (mountedVolume) {
    try { execFileSync("hdiutil", ["detach", mountedVolume, "-force"]); } catch {}
  }
  rmSync(scratch, { recursive: true, force: true });
}
