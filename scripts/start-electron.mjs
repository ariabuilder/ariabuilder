import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Cursor/CI sometimes sets this, which makes `require('electron')` return a path string.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const root = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "..", "package.json"), "utf8"),
);
const appVersion = typeof pkg.version === "string" ? pkg.version : "0.0.0";

function ensureAppIcons() {
  const repoRoot = path.join(root, "..");
  const badge = path.join(repoRoot, ".github", "aria-badge-light.png");
  const iconsDir = path.join(repoRoot, "build", "icons");
  const png = path.join(iconsDir, "icon.png");
  const icns = path.join(iconsDir, "icon.icns");
  if (!fs.existsSync(badge)) return;
  fs.mkdirSync(iconsDir, { recursive: true });
  const stamp = path.join(iconsDir, ".generated-from");
  const expected = `${path.relative(repoRoot, badge)}\n${fs.statSync(badge).mtimeMs}\n`;
  if (
    fs.existsSync(stamp) &&
    fs.readFileSync(stamp, "utf8") === expected &&
    fs.existsSync(icns) &&
    fs.existsSync(png)
  ) {
    return;
  }
  try {
    execFileSync(process.execPath, [path.join(root, "generate-app-icons.mjs"), badge], {
      stdio: "ignore",
    });
  } catch {
    try {
      fs.copyFileSync(badge, png);
    } catch {
      // Non-fatal — Electron may keep the previous icon until icons generate.
    }
  }
}

/**
 * `electron .` runs the stock Electron.app, so macOS menu bar shows "Electron"
 * and About shows Electron's version/icon. Patch Info.plist for local dev
 * (packaged builds use productName / version from electron-builder).
 */
function patchDevAppIdentity(binaryPath) {
  if (process.platform !== "darwin") return;
  // binary → …/Electron.app/Contents/MacOS/Electron → sibling Info.plist under Contents/
  const contentsPath = path.resolve(binaryPath, "..", "..");
  const plistPath = path.join(contentsPath, "Info.plist");
  if (!fs.existsSync(plistPath)) return;

  const setKey = (key, value) => {
    try {
      execFileSync(
        "/usr/libexec/PlistBuddy",
        ["-c", `Set :${key} ${value}`, plistPath],
        { stdio: "ignore" },
      );
    } catch {
      try {
        execFileSync(
          "/usr/libexec/PlistBuddy",
          ["-c", `Add :${key} string ${value}`, plistPath],
          { stdio: "ignore" },
        );
      } catch {
        // Non-fatal — menu may still say Electron until next electron upgrade/reinstall.
      }
    }
  };

  setKey("CFBundleName", "Aria");
  setKey("CFBundleDisplayName", "Aria");
  setKey("CFBundleShortVersionString", appVersion);
  setKey("CFBundleVersion", appVersion);
  setKey("NSHumanReadableCopyright", `Copyright © ${new Date().getFullYear()} Statice Origins Inc`);

  // AppKit ignores Electron's AboutPanel `iconPath` on macOS and reads the
  // application icon from CFBundleIconFile instead. Keep the stock Electron.app
  // executable for development, but give its bundle the same Aria icon used by
  // electron-builder for packaged releases.
  const sourceIconPath = path.join(root, "..", "build", "icons", "icon.icns");
  const bundledIconName = "aria.icns";
  const bundledIconPath = path.join(contentsPath, "Resources", bundledIconName);
  if (fs.existsSync(sourceIconPath)) {
    try {
      fs.copyFileSync(sourceIconPath, bundledIconPath);
      setKey("CFBundleIconFile", bundledIconName);
    } catch {
      // Non-fatal — Electron's icon may remain in About until the next launch.
    }
  }
}

ensureAppIcons();
patchDevAppIdentity(electronPath);

const child = spawn(electronPath, ["."], {
  stdio: "inherit",
  env,
});

function stopChild(signal) {
  if (!child.killed) child.kill(signal);
}

process.once("SIGINT", () => stopChild("SIGINT"));
process.once("SIGTERM", () => stopChild("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
