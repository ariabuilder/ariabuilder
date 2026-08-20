import { describe, expect, it } from "vitest";
import { parseAstro } from "./parseAstro";
import { serializeAstro } from "./serializeAstro";
import {
  clearNativeButtonPopover,
  insertComposerPopoverCloseButton,
  insertComposerPopoverTrigger,
  listComposerPopoverTargets,
  renameComposerPopoverId,
  setComposerPopoverMode,
  setNativeButtonPopover,
  setNativeButtonPopoverAction,
} from "./popoverAuthoring";
import { deleteNodeAtPath } from "./mutate";

async function modelFor(source: string) {
  const parsed = await parseAstro(`---\n---\n${source}\n`);
  if (!parsed.editable) throw new Error("expected editable source");
  return parsed.model;
}

describe("popover authoring relationships", () => {
  it("discovers native targets and multiple trigger actions", async () => {
    const model = await modelFor(`<button popovertarget="help">Open</button>
<div id="help" popover><button popovertarget="help" popovertargetaction="hide">Dismiss</button></div>`);
    expect(listComposerPopoverTargets(model)).toMatchObject([{
      path: "1",
      id: "help",
      idState: "static",
      mode: "auto",
      triggers: [
        { path: "0", label: "Open", action: "toggle" },
        { path: "1.0", label: "Dismiss", action: "hide" },
      ],
    }]);
  });

  it("connects, changes, and removes a native button relationship", async () => {
    const model = await modelFor(`<button type="button">Details</button><div popover>Content</div>`);
    expect(setNativeButtonPopover(model, "0", "1", "show").ok).toBe(true);
    let source = serializeAstro(model);
    const id = listComposerPopoverTargets(model)[0]?.id;
    expect(id).toMatch(/^aria-popover-/);
    expect(source).toContain(`popovertarget="${id}"`);
    expect(source).toContain('popovertargetaction="show"');

    expect(setNativeButtonPopoverAction(model, "0", "hide").ok).toBe(true);
    expect(serializeAstro(model)).toContain('popovertargetaction="hide"');
    expect(clearNativeButtonPopover(model, "0").ok).toBe(true);
    source = serializeAstro(model);
    expect(source).not.toContain("popovertarget");
  });

  it("renames a static target and rewrites every same-source trigger", async () => {
    const model = await modelFor(`<button popovertarget="old">One</button><button popovertarget="old">Two</button><div id="old" popover>Content</div>`);
    expect(renameComposerPopoverId(model, "2", "account-menu").ok).toBe(true);
    const source = serializeAstro(model);
    expect(source.match(/popovertarget="account-menu"/g)).toHaveLength(2);
    expect(source).toContain('id="account-menu"');
    expect(renameComposerPopoverId(model, "2", "bad id")).toMatchObject({ ok: false });
  });

  it("refuses to connect a button to a duplicate target ID", async () => {
    const model = await modelFor(`<button type="button">Open</button><div id="duplicate" popover>One</div><div id="duplicate" popover>Two</div>`);
    expect(setNativeButtonPopover(model, "0", "1")).toMatchObject({
      ok: false,
      reason: 'Popover ID "duplicate" is not unique',
    });
    expect(serializeAstro(model)).not.toContain("popovertarget");
  });

  it("creates opening and closing buttons and supports manual behavior", async () => {
    const model = await modelFor(`<div id="menu" popover>Content</div>`);
    expect(setComposerPopoverMode(model, "0", "manual").ok).toBe(true);
    expect(insertComposerPopoverTrigger(model, "0").ok).toBe(true);
    expect(insertComposerPopoverCloseButton(model, "1").ok).toBe(true);
    const source = serializeAstro(model);
    expect(source).toContain('popover="manual"');
    expect(source).toContain("Open popover");
    expect(source).toContain('popovertargetaction="hide"');
  });

  it("clears surviving trigger references when a target is deleted", async () => {
    const model = await modelFor(`<button popovertarget="gone" popovertargetaction="show">Open</button><div id="gone" popover>Content</div>`);
    expect(deleteNodeAtPath(model, "1").ok).toBe(true);
    const source = serializeAstro(model);
    expect(source).toContain("<button>Open</button>");
    expect(source).not.toContain("popovertarget");
  });
});
