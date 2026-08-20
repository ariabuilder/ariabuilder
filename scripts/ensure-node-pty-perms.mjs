import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const prebuilds = path.join(root, "node_modules", "node-pty", "prebuilds");

if (!fs.existsSync(prebuilds)) process.exit(0);

for (const platformDir of fs.readdirSync(prebuilds)) {
  const helper = path.join(prebuilds, platformDir, "spawn-helper");
  if (!fs.existsSync(helper)) continue;
  try {
    fs.chmodSync(helper, 0o755);
  } catch (error) {
    console.warn(`[ensure-node-pty-perms] could not chmod ${helper}:`, error);
  }
}
