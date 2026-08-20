import type { ComposerClipboardFormats } from "../../shared/composer";

function clipboardApi() {
  if (!window.aria?.clipboard) {
    throw new Error("Desktop clipboard bridge is unavailable");
  }
  return window.aria.clipboard;
}

export function writeComposerClipboard(
  formats: ComposerClipboardFormats,
): Promise<{ ok: true }> {
  return clipboardApi().writeComposer(formats);
}

export function readComposerClipboard(): Promise<ComposerClipboardFormats> {
  return clipboardApi().readComposer();
}
