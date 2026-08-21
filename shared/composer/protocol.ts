/**
 * Composer preview postMessage protocol v12 (`aria:` prefix).
 *
 * Site iframe → host: geometry, interaction, viewport, reconcile results
 * Host → site iframe: tracking, reveal, direct patches, reconciliation
 *
 * Security: no privileged app API in the site world; host must validate
 * origin (localhost preview) and message shape.
 */

export const ARIA_PROTOCOL_VERSION = 12 as const;
/** Update whenever a preview bridge build is no longer host-compatible. */
export const ARIA_BRIDGE_ID = "aria-composer-bridge-v12.0" as const;
export const ARIA_BRIDGE_HEALTH_PATH = "/__aria/bridge-health" as const;

export const ARIA_MSG = {
  /** Iframe announces its current origin/version before host traffic begins. */
  ready: "aria:ready",
  /** Host asks the current iframe document to repeat its ready handshake. */
  bridgePing: "aria:bridge-ping",
  rects: "aria:rects",
  hover: "aria:hover",
  click: "aria:click",
  /** Double-click a node → host drills into that component/layout file. */
  open: "aria:open",
  track: "aria:track",
  scrollTo: "aria:scroll-to",
  viewport: "aria:viewport",
  restoreViewport: "aria:restore-viewport",
  /** Design-mode key chords forwarded when the iframe has focus. */
  shortcut: "aria:shortcut",
  /** Clipboard formats captured inside the preview iframe. */
  paste: "aria:paste",
  /** Host pointer coordinates for palette/tree drag hit-testing. */
  dragOver: "aria:drag-over",
  dragLeave: "aria:drag-leave",
  /** Preview-computed DOM hit returned to the source-model host. */
  dropHit: "aria:drop-hit",
  /** Temporary editor-only CSS declaration preview. */
  previewStyle: "aria:preview-style",
  clearPreviewStyle: "aria:clear-preview-style",
  /** Load or remove the generated Motion runtime without navigating the canvas. */
  syncMotionAssets: "aria:sync-motion-assets",
  /** Load the enabled Google Fonts stylesheet in the authoring canvas. */
  syncFontStylesheet: "aria:sync-font-stylesheet",
  /** Immediate source-model DOM mutations that do not require Astro execution. */
  patchNodes: "aria:patch-nodes",
  /** Iframe acknowledgement for an optimistic patch revision. */
  patchResult: "aria:patch-result",
  /** Register marked boundaries to replace when this server revision is ready. */
  reconcile: "aria:reconcile",
  reconcileResult: "aria:reconcile-result",
  computedStyleRequest: "aria:computed-style-request",
  computedStyleResponse: "aria:computed-style-response",
  /** Editor-only canvas display treatment for the real Astro preview. */
  displayOptions: "aria:display-options",
  /**
   * Host toggles design selection interaction without remounting the iframe.
   * `enabled: false` = immersive preview (links/forms work; no select chrome).
   */
  designInteraction: "aria:design-interaction",
  /** Open or close a native popover for editor-only Design authoring. */
  popoverPreview: "aria:popover-preview",
  /**
   * Host freezes vh units to a breakpoint viewport height so stretched
   * all-breakpoints frames do not make 100vh heroes fill the page.
   */
  setVh: "aria:set-vh",
  /** Iframe reports content height after vh freeze (body, not the iframe viewport). */
  pageHeight: "aria:page-height",
} as const;

export type AriaMsgType = (typeof ARIA_MSG)[keyof typeof ARIA_MSG];

export type AriaRect = { x: number; y: number; w: number; h: number };

export type AriaReadyMessage = {
  type: typeof ARIA_MSG.ready;
  version: typeof ARIA_PROTOCOL_VERSION;
  bridgeId: typeof ARIA_BRIDGE_ID;
  pathname: string;
  /** Identifies the active or warming iframe without trusting DOM timing. */
  frameToken: string;
};

export type AriaRectsMessage = {
  type: typeof ARIA_MSG.rects;
  /** Echoes the host track request that owns this geometry snapshot. */
  trackingRevision: number;
  rects: Record<string, AriaRect[] | null>;
  classes: Record<string, string[][]>;
  /** Outermost-to-innermost rendered owner markers for repeated/nested instances. */
  owners?: Record<string, string[][]>;
};

export type AriaHoverMessage = {
  type: typeof ARIA_MSG.hover;
  path: string | null;
  occurrence: number;
};

export type AriaClickMessage = {
  type: typeof ARIA_MSG.click;
  path: string | null;
  occurrence: number;
  shift: boolean;
  meta: boolean;
};

export type AriaOpenMessage = {
  type: typeof ARIA_MSG.open;
  path: string;
  occurrence: number;
};

export type AriaShortcutMessage = {
  type: typeof ARIA_MSG.shortcut;
  key: string;
  meta: boolean;
  shift: boolean;
};

export type AriaPasteMessage = {
  type: typeof ARIA_MSG.paste;
  text: string;
  html: string;
  aria: string;
};

export type AriaDragOverMessage = {
  type: typeof ARIA_MSG.dragOver;
  x: number;
  y: number;
};

export type AriaDragLeaveMessage = {
  type: typeof ARIA_MSG.dragLeave;
};

export type AriaDropHitMessage = {
  type: typeof ARIA_MSG.dropHit;
  path: string | null;
  occurrence: number;
  mode: "before" | "after" | "inside";
  axis: "horizontal" | "vertical";
  rect: AriaRect | null;
};

export type AriaPreviewStyleMessage = {
  type: typeof ARIA_MSG.previewStyle;
  path: string;
  relativePath?: string;
  cssText: string;
};

export type AriaClearPreviewStyleMessage = {
  type: typeof ARIA_MSG.clearPreviewStyle;
  path?: string;
  relativePath?: string;
};

export type AriaSyncMotionAssetsMessage = {
  type: typeof ARIA_MSG.syncMotionAssets;
  enabled: boolean;
};

export type AriaSyncFontStylesheetMessage = {
  type: typeof ARIA_MSG.syncFontStylesheet;
  url?: string | null;
  urls?: string[];
};

export type AriaPatchNodesMessage = {
  type: typeof ARIA_MSG.patchNodes;
  revision: number;
  patches: import("./previewDiff").ComposerDomPatch[];
};

export const ARIA_PATCH_FAILURE_REASONS = [
  "invalid-patch", "path-unavailable", "occurrence-mismatch",
  "dom-shape-mismatch", "hydration-boundary", "unsafe-element",
  "stale-revision", "patch-exception",
] as const;
export type AriaPatchFailureReason = (typeof ARIA_PATCH_FAILURE_REASONS)[number];

export type AriaPatchResultMessage = {
  type: typeof ARIA_MSG.patchResult;
  revision: number;
  status: "applied" | "rejected" | "stale";
  paths: string[];
  reason?: AriaPatchFailureReason;
};

export const ARIA_RELOAD_REASONS = [
  "imports-changed", "executable-assets-changed",
  "hydration-ownership-changed", "markers-irrecoverable",
  "reconciliation-failed", "controlled-reload-retry",
] as const;
export type AriaReloadReason = (typeof ARIA_RELOAD_REASONS)[number];

export type AriaReconcileMessage = {
  type: typeof ARIA_MSG.reconcile;
  revision: number;
  paths: string[];
  reloadReason?: AriaReloadReason;
};

export type AriaReconcileResultMessage = {
  type: typeof ARIA_MSG.reconcileResult;
  revision: number;
  ok: boolean;
  paths: string[];
  status?: "patched" | "morphed" | "reload-required";
  reason?: AriaReloadReason;
  detail?: string;
  hardReload?: boolean;
};

export type AriaComputedStyleRequestMessage = {
  type: typeof ARIA_MSG.computedStyleRequest;
  requestId: string;
  path: string;
  occurrence: number;
  relativePath: string;
  properties: string[];
};

export type AriaComputedStyleResponseMessage = {
  type: typeof ARIA_MSG.computedStyleResponse;
  requestId: string;
  values: Record<string, string>;
};

export type AriaDisplayOptionsMessage = {
  type: typeof ARIA_MSG.displayOptions;
  mode: "normal" | "outlines" | "wireframe";
  accent: string;
};

export type AriaDesignInteractionMessage = {
  type: typeof ARIA_MSG.designInteraction;
  /** When true, design selection / inert chrome is active. */
  enabled: boolean;
};

export type AriaPopoverPreviewMessage = {
  type: typeof ARIA_MSG.popoverPreview;
  targetId: string | null;
  open: boolean;
};

export type AriaBridgePingMessage = {
  type: typeof ARIA_MSG.bridgePing;
  /** Host-owned token repairs documents reached through a query-dropping reload. */
  frameToken: string;
};

export type AriaTrackMessage = {
  type: typeof ARIA_MSG.track;
  /** Monotonic host revision used to reject geometry from an older scope. */
  trackingRevision: number;
  paths: string[];
  scope?: string;
};

export type AriaScrollToMessage = {
  type: typeof ARIA_MSG.scrollTo;
  path: string;
  occ?: number;
  policy?: "if-needed" | "center";
};

export type AriaViewportMessage = {
  type: typeof ARIA_MSG.viewport;
  href: string;
  x: number;
  y: number;
};

export type AriaRestoreViewportMessage = {
  type: typeof ARIA_MSG.restoreViewport;
  x: number;
  y: number;
};

export type AriaSetVhMessage = {
  type: typeof ARIA_MSG.setVh;
  px: number;
};

export type AriaPageHeightMessage = {
  type: typeof ARIA_MSG.pageHeight;
  height: number;
};

export type AriaIframeToHostMessage =
  | AriaReadyMessage
  | AriaRectsMessage
  | AriaHoverMessage
  | AriaClickMessage
  | AriaOpenMessage
  | AriaShortcutMessage
  | AriaPasteMessage
  | AriaDropHitMessage
  | AriaViewportMessage
  | AriaPageHeightMessage
  | AriaComputedStyleResponseMessage
  | AriaPatchResultMessage
  | AriaReconcileResultMessage;

export type AriaHostToIframeMessage =
  | AriaBridgePingMessage
  | AriaTrackMessage
  | AriaScrollToMessage
  | AriaRestoreViewportMessage
  | AriaDragOverMessage
  | AriaDragLeaveMessage
  | AriaPreviewStyleMessage
  | AriaClearPreviewStyleMessage
  | AriaSyncMotionAssetsMessage
  | AriaSyncFontStylesheetMessage
  | AriaComputedStyleRequestMessage
  | AriaDisplayOptionsMessage
  | AriaDesignInteractionMessage
  | AriaPopoverPreviewMessage
  | AriaSetVhMessage
  | AriaPatchNodesMessage
  | AriaReconcileMessage;

export function isAriaProtocolMessage(
  data: unknown,
): data is AriaIframeToHostMessage | AriaHostToIframeMessage {
  if (!data || typeof data !== "object") return false;
  const message = data as {
    type?: unknown;
    version?: unknown;
    bridgeId?: unknown;
    pathname?: unknown;
    frameToken?: unknown;
    targetId?: unknown;
    open?: unknown;
    enabled?: unknown;
    url?: unknown;
    urls?: unknown;
    px?: unknown;
    height?: unknown;
    trackingRevision?: unknown;
    revision?: unknown;
    patches?: unknown;
    paths?: unknown;
    ok?: unknown;
    status?: unknown;
    reason?: unknown;
    reloadReason?: unknown;
  };
  const type = message.type;
  if (type === ARIA_MSG.ready) {
    return (
      message.version === ARIA_PROTOCOL_VERSION &&
      message.bridgeId === ARIA_BRIDGE_ID &&
      typeof message.pathname === "string" &&
      message.pathname.startsWith("/") &&
      typeof message.frameToken === "string"
    );
  }
  if (type === ARIA_MSG.patchNodes) {
    return Number.isFinite(message.revision) && Array.isArray(message.patches);
  }
  if (type === ARIA_MSG.patchResult) {
    return (
      Number.isFinite(message.revision) &&
      Array.isArray(message.paths) &&
      ["applied", "rejected", "stale"].includes(String(message.status)) &&
      (message.reason === undefined || ARIA_PATCH_FAILURE_REASONS.includes(message.reason as AriaPatchFailureReason))
    );
  }
  if (type === ARIA_MSG.reconcile) {
    return (
      Number.isFinite(message.revision) &&
      Array.isArray(message.paths) &&
      (message.reloadReason === undefined || ARIA_RELOAD_REASONS.includes(message.reloadReason as AriaReloadReason))
    );
  }
  if (type === ARIA_MSG.reconcileResult) {
    return (
      Number.isFinite(message.revision) &&
      Array.isArray(message.paths) &&
      typeof message.ok === "boolean" &&
      (message.reason === undefined || ARIA_RELOAD_REASONS.includes(message.reason as AriaReloadReason))
    );
  }
  if (type === ARIA_MSG.syncMotionAssets) {
    return typeof message.enabled === "boolean";
  }
  if (type === ARIA_MSG.syncFontStylesheet) {
    const urlOk =
      message.url === undefined ||
      message.url === null ||
      typeof message.url === "string";
    const urlsOk =
      message.urls === undefined ||
      (Array.isArray(message.urls) &&
        message.urls.every((item) => typeof item === "string"));
    return urlOk && urlsOk;
  }
  if (type === ARIA_MSG.bridgePing) {
    return typeof message.frameToken === "string";
  }
  if (type === ARIA_MSG.popoverPreview) {
    return (message.targetId === null || typeof message.targetId === "string")
      && typeof message.open === "boolean";
  }
  if (type === ARIA_MSG.setVh) {
    return Number.isFinite(message.px);
  }
  if (type === ARIA_MSG.pageHeight) {
    return Number.isFinite(message.height);
  }
  if (type === ARIA_MSG.track) {
    return (
      Number.isInteger(message.trackingRevision) &&
      Number(message.trackingRevision) >= 0 &&
      Array.isArray(message.paths)
    );
  }
  if (type === ARIA_MSG.rects) {
    return (
      Number.isInteger(message.trackingRevision) &&
      Number(message.trackingRevision) >= 0
    );
  }
  return (
    type === ARIA_MSG.hover ||
    type === ARIA_MSG.click ||
    type === ARIA_MSG.open ||
    type === ARIA_MSG.shortcut ||
    type === ARIA_MSG.paste ||
    type === ARIA_MSG.dragOver ||
    type === ARIA_MSG.dragLeave ||
    type === ARIA_MSG.dropHit ||
    type === ARIA_MSG.previewStyle ||
    type === ARIA_MSG.clearPreviewStyle ||
    type === ARIA_MSG.syncMotionAssets ||
    type === ARIA_MSG.syncFontStylesheet ||
    type === ARIA_MSG.computedStyleRequest ||
    type === ARIA_MSG.computedStyleResponse ||
    type === ARIA_MSG.displayOptions ||
    type === ARIA_MSG.designInteraction ||
    type === ARIA_MSG.popoverPreview ||
    type === ARIA_MSG.scrollTo ||
    type === ARIA_MSG.viewport ||
    type === ARIA_MSG.restoreViewport
  );
}

/** True when the message is from the iframe (site → host). */
export function isAriaIframeToHostMessage(
  data: unknown,
): data is AriaIframeToHostMessage {
  if (!isAriaProtocolMessage(data)) return false;
  return (
    data.type === ARIA_MSG.ready ||
    data.type === ARIA_MSG.rects ||
    data.type === ARIA_MSG.hover ||
    data.type === ARIA_MSG.click ||
    data.type === ARIA_MSG.open ||
    data.type === ARIA_MSG.shortcut ||
    data.type === ARIA_MSG.paste ||
    data.type === ARIA_MSG.dropHit ||
    data.type === ARIA_MSG.viewport ||
    data.type === ARIA_MSG.pageHeight ||
    data.type === ARIA_MSG.computedStyleResponse ||
    data.type === ARIA_MSG.patchResult ||
    data.type === ARIA_MSG.reconcileResult
  );
}
