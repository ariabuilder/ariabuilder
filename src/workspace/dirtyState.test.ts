import { describe, expect, it, vi } from "vitest";
import {
  guardDirtyNavigation,
  registerDirtyState,
  useDirtyPromptState,
} from "./dirtyState";

describe.sequential("workspace dirty navigation", () => {
  it("saves all dirty handlers before allowing navigation", async () => {
    let dirty = true;
    const save = vi.fn(() => {
      dirty = false;
      return true;
    });
    const unregister = registerDirtyState("/project-save", "general", {
      label: "General",
      isDirty: () => dirty,
      save,
      discard: vi.fn(),
    });

    const guarded = guardDirtyNavigation("/project-save");
    await Promise.resolve();
    useDirtyPromptState().settle("save");
    await expect(guarded).resolves.toBe(true);
    expect(save).toHaveBeenCalledOnce();
    unregister();
  });

  it("keeps the draft when navigation is canceled", async () => {
    const unregister = registerDirtyState("/project-cancel", "seo", {
      label: "SEO",
      isDirty: () => true,
      save: vi.fn(),
      discard: vi.fn(),
    });

    const guarded = guardDirtyNavigation("/project-cancel");
    await Promise.resolve();
    useDirtyPromptState().settle("cancel");
    await expect(guarded).resolves.toBe(false);
    unregister();
  });

  it("exposes action-specific labels for a Code draft", async () => {
    const unregister = registerDirtyState("/project-code", "composer", {
      label: "Code draft · src/pages/index.astro",
      saveLabel: "Apply code",
      discardLabel: "Discard draft",
      isDirty: () => true,
      save: vi.fn(),
      discard: vi.fn(),
    });
    const guarded = guardDirtyNavigation("/project-code");
    await Promise.resolve();
    const prompt = useDirtyPromptState();
    expect(prompt.saveLabel.value).toBe("Apply code");
    expect(prompt.discardLabel.value).toBe("Discard draft");
    prompt.settle("cancel");
    await expect(guarded).resolves.toBe(false);
    unregister();
  });
});
