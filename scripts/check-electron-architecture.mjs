import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronRoot = path.join(root, "electron");
const registrarPath = path.join(electronRoot, "ipc/registrar.ts");
const violations = [];

function productionTypeScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionTypeScriptFiles(absolute);
    if (
      !entry.name.endsWith(".ts") ||
      entry.name.endsWith(".test.ts") ||
      entry.name.endsWith(".spec.ts")
    ) {
      return [];
    }
    return [absolute];
  });
}

for (const absolute of productionTypeScriptFiles(electronRoot)) {
  const source = fs.readFileSync(absolute, "utf8");
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  if (absolute !== registrarPath && /\bipcMain\.handle\s*\(/.test(source)) {
    violations.push(`${relative}: direct ipcMain.handle call outside the registrar`);
  }
  const isIpcModule =
    relative.includes("/ipc/") || relative.endsWith("/ipc.ts");
  if (isIpcModule) {
    const lines = source.split("\n").length;
    if (lines > 600) {
      violations.push(`${relative}: ${lines} lines exceeds the 600-line IPC limit`);
    }
  }
}

const mainPath = path.join(electronRoot, "main.ts");
const mainSource = fs.readFileSync(mainPath, "utf8");
const mainLines = mainSource.split("\n").length;
if (mainLines > 300) {
  violations.push(`electron/main.ts: ${mainLines} lines exceeds the 300-line entrypoint limit`);
}
if (mainSource.indexOf("app.setName") > mainSource.indexOf('app.getPath("userData")')) {
  violations.push("electron/main.ts: app name must be set before resolving userData");
}

if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Electron architecture check passed (main: ${mainLines} lines)`);
}
