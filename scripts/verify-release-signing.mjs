import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const release = path.join(root, "release");

if (process.env.ARIA_RELEASE_SIGNING !== "1") {
  throw new Error("Release signing verification is dormant. Set ARIA_RELEASE_SIGNING=1 only in the protected release workflow.");
}

if (process.platform === "darwin") {
  for (const key of ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]) {
    if (!process.env[key]) throw new Error(`Missing required macOS release credential: ${key}`);
  }
  const apps = readdirSync(release).filter((name) => name.startsWith("mac-")).map((name) => path.join(release, name, "Aria.app"));
  if (apps.length === 0) throw new Error("No macOS app bundle found to verify");
  for (const app of apps) {
    execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], { stdio: "inherit" });
    execFileSync("spctl", ["--assess", "--type", "execute", "--verbose=2", app], { stdio: "inherit" });
    execFileSync("xcrun", ["stapler", "validate", app], { stdio: "inherit" });
  }
} else if (process.platform === "win32") {
  for (const key of ["CSC_LINK", "CSC_KEY_PASSWORD"]) {
    if (!process.env[key]) throw new Error(`Missing required Windows release credential: ${key}`);
  }
  const installers = readdirSync(release).filter((name) => name.endsWith(".exe"));
  if (installers.length === 0) throw new Error("No Windows installer found to verify");
  for (const installer of installers) {
    execFileSync("powershell", ["-NoProfile", "-Command", `if ((Get-AuthenticodeSignature '${path.join(release, installer).replaceAll("'", "''")}').Status -ne 'Valid') { exit 1 }`], { stdio: "inherit" });
  }
} else {
  throw new Error("Release signing verification applies only to macOS and Windows");
}

console.log("release signing verification: ok");
