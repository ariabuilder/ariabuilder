import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  testIgnoredDirectories,
  testProjects,
  testScanRoots,
} from "../test-architecture.config.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set(testIgnoredDirectories);
const violations = [];
let testFileCount = 0;

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) return [];
      return walk(absolute);
    }
    return [absolute];
  });
}

function slashPath(absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function isTestLike(relative) {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relative);
}

function isDiscoverable(relative) {
  return testProjects.some(({ include }) => path.matchesGlob(relative, include));
}

for (const scanRoot of testScanRoots) {
  for (const absolute of walk(path.join(root, scanRoot))) {
    const relative = slashPath(absolute);
    if (!isTestLike(relative)) continue;
    testFileCount += 1;

    if (relative.startsWith("tests/fixtures/")) {
      violations.push(`${relative}: tests cannot live inside fixture trees`);
      continue;
    }
    if (!isDiscoverable(relative)) {
      violations.push(`${relative}: test location or extension is not discoverable`);
    }

    const source = fs.readFileSync(absolute, "utf8");
    if (/from\s+["']node:test["']|require\(\s*["']node:test["']\s*\)/.test(source)) {
      violations.push(`${relative}: use Vitest instead of node:test`);
    }
    const lineCount = source.split("\n").length;
    if (lineCount > 500) {
      violations.push(`${relative}: ${lineCount} lines exceeds the 500-line test limit`);
    }
  }
}

if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Test architecture check passed (${testFileCount} first-party files)`);
}
