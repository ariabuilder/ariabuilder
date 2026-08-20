import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildMotionArtifactEdits,
  MOTION_CSS_REL,
  MOTION_GENERATED_REL,
  MOTION_JS_REL,
  projectHasMotion,
  syncMotionArtifacts,
} from "./motionAssets";

describe("motion project artifacts", () => {
  let root = "";
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-motion-assets-"));
    fs.mkdirSync(path.join(root, "src/pages"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/pages/index.astro"), "---\n---\n<div />\n");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("emits no public assets or HTML tags when motion is unused", () => {
    expect(projectHasMotion(root)).toBe(false);
    const edits = buildMotionArtifactEdits(root);
    expect(edits.find((edit) => edit.relativeFile === MOTION_CSS_REL)?.content).toBeNull();
    expect(edits.find((edit) => edit.relativeFile === MOTION_JS_REL)?.content).toBeNull();
    expect(edits.find((edit) => edit.relativeFile === MOTION_GENERATED_REL)?.content).not.toContain("<link");
  });

  it("writes both assets once and removes them after the last motion source", () => {
    fs.writeFileSync(path.join(root, "src/pages/index.astro"), '---\n---\n<div class="aria-motion aria-motion-fade" />\n');
    syncMotionArtifacts(root);
    expect(fs.existsSync(path.join(root, MOTION_CSS_REL))).toBe(true);
    expect(fs.existsSync(path.join(root, MOTION_JS_REL))).toBe(true);
    const generated = fs.readFileSync(path.join(root, MOTION_GENERATED_REL), "utf8");
    expect(generated.match(/<link/g)).toHaveLength(1);
    expect(generated.match(/<script/g)).toHaveLength(1);
    fs.writeFileSync(path.join(root, "src/pages/index.astro"), "---\n---\n<div />\n");
    syncMotionArtifacts(root);
    expect(fs.existsSync(path.join(root, MOTION_CSS_REL))).toBe(false);
    expect(fs.existsSync(path.join(root, MOTION_JS_REL))).toBe(false);
  });

  it("uses pending Composer source before it reaches disk", () => {
    const pending = new Map([["src/pages/index.astro", '---\n---\n<div class="aria-parallax" />\n']]);
    expect(projectHasMotion(root, pending)).toBe(true);
  });
});
