import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const legalFiles = new Map([
  ["LICENSE", "Apache License"],
  ["NOTICE", "Copyright 2026 Statice Origins Inc."],
  ["acknowledgements.md", "# Acknowledgements"],
  ["THIRD_PARTY_NOTICES.txt", "THIRD-PARTY SOFTWARE NOTICES AND INFORMATION"],
]);

export function assertLegalResources(resourcesDir) {
  const legalDir = path.join(resourcesDir, "legal");
  for (const [name, expected] of legalFiles) {
    const file = path.join(legalDir, name);
    if (!existsSync(file)) throw new Error(`Packaged legal resource missing: ${file}`);
    const content = readFileSync(file, "utf8");
    if (!content.includes(expected)) {
      throw new Error(`Packaged legal resource is invalid: ${file}`);
    }
  }

  for (const name of ["LICENSE.electron.txt", "LICENSES.chromium.html"]) {
    const file = path.join(legalDir, name);
    if (!existsSync(file)) throw new Error(`Electron legal resource missing: ${file}`);
  }
}
