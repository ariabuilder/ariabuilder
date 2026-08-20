import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import path from "node:path";
import { writeTextFileAtomic } from "./pathSafety";
import {
  DEFAULT_APP_APPEARANCE_PREFS,
  parseAppAppearancePrefs,
  toAppAppearanceWritePayload,
  type AppAppearancePrefs,
} from "../shared/appearance";

export type { AppAppearancePrefs } from "../shared/appearance";

function appearancePath(userData: string): string {
  mkdirSync(userData, { recursive: true });
  return path.join(userData, "appearance.json");
}

export function readAppearancePrefs(userData: string): AppAppearancePrefs {
  const file = appearancePath(userData);
  try {
    const raw = readFileSync(file, "utf8");
    return parseAppAppearancePrefs(JSON.parse(raw));
  } catch {
    if (existsSync(file)) {
      try {
        renameSync(file, `${file}.corrupt-${Date.now()}`);
      } catch {
        // Read-only profile should still return defaults.
      }
    }
    return { ...DEFAULT_APP_APPEARANCE_PREFS };
  }
}

export function writeAppearancePrefs(
  userData: string,
  prefs: AppAppearancePrefs,
): AppAppearancePrefs {
  const normalized = toAppAppearanceWritePayload(prefs);
  const file = appearancePath(userData);
  writeTextFileAtomic(file, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}
