import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SETTINGS_TAB_ORDER } from "./types";

const directory = path.dirname(fileURLToPath(import.meta.url));

describe("Utilities settings surface", () => {
  it("places Utilities directly after General in Site settings", () => {
    expect(SETTINGS_TAB_ORDER.slice(0, 2)).toEqual(["general", "utilities"]);
  });

  it("keeps progress announcements and consequential disable confirmation in the UI", () => {
    const source = fs.readFileSync(
      path.join(directory, "UtilitiesSettingsView.vue"),
      "utf8",
    );
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain("confirmDisable = true");
    expect(source).toContain('variant="destructive"');
    expect(source).toContain('openDesignSection("colors")');
  });

  it("guards asynchronous utility responses when the active project changes", () => {
    const source = fs.readFileSync(
      path.join(directory, "UtilitiesSettingsView.vue"),
      "utf8",
    );
    expect(source).toContain("let requestVersion = 0");
    expect(source).toContain("isCurrentRequest(request)");
    expect(source).toContain("request.projectRoot");
    expect(source).toContain("confirmDisable.value = false");
  });
});
