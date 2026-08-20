/**
 * Composer Astro editable-tree kernel (Phase 0).
 *
 * Document SoT: disk `.astro` only.
 * Rejected: `.aria/composer/*.json` DSL sidecar as SoT (see COMPOSER_SOT_POLICY).
 */

export {
  ARIA_DESIGN_HASH,
  ARIA_DESIGN_QUERY,
  ARIA_LAYER_LABEL_ATTR,
  ARIA_MARKER_DIR,
  ARIA_MARKER_END,
  ARIA_MARKER_START,
  ARIA_PATH_ATTR,
  COMPOSER_SOT_POLICY,
  INLINE_TAGS,
  RAW_ELEMENTS,
  VOID_ELEMENTS,
} from "./constants";

export {
  BAIL_TAXONOMY,
  OPAQUE_NOT_BAIL,
  formatBailReason,
} from "./bail";

export { extractPropSchema } from "./props";
export type { PropSchemaResult } from "./props";

export {
  commitBooleanValue,
  commitStringValue,
  decodeAttr,
  encodeAttr,
  isBooleanChecked,
  isOpaquePropValue,
  stringFieldDisplay,
} from "./propValueCodec";

export {
  addClassName,
  appendClassListToken,
  diffRenderedClasses,
  joinClassNames,
  removeClassName,
  splitClassNames,
  staticClassListTokens,
  removeClassListTokens,
} from "./classAttr";

export * from "./motion";
export * from "./cmsBindings";
export * from "./contentBindingSource";
export * from "./collectionBindings";
export * from "./projectData";
export * from "./projectTranslations";
export * from "./translationBindings";
export * from "./elementInspector";
export * from "./buttonIcon";
export * from "./alertIcon";
export * from "./popoverAuthoring";
export * from "./conditions";
export * from "./conditionalValues";
export * from "./listStyle";
export * from "./svgImport";
export * from "./dynamicContent";
export * from "./renameClassReferences";
export * from "../conditions";

export {
  getStyleProp,
  normalizePositionValue,
  parseSpacingShorthand,
  parseStyleAttr,
  resolveInsetSides,
  resolveSpacingSides,
  serializeStyleAttr,
  setStyleProp,
  withPreviewImportant,
} from "./styleAttr";
export type { PositionOffsetKey, PositionValueKey, SpacingSides } from "./styleAttr";

export * from "./cornerCss";
export * from "./filterCss";
export * from "./shadowCss";

export {
  TRANSFORM_DEFAULTS,
  TRANSFORM_LEGACY_PROPERTIES,
  TRANSFORM_SECTION_PROPERTIES,
  cssToTransformState,
  defaultTransformState,
  hasUnsupportedTransformFunctions,
  isOriginPresetActive,
  styleMapToTransformState,
  transformOriginStateToCSS,
  transformStateToCSS,
  transformStateToStyleUpdates,
} from "./transform";
export type { TransformState, TransformStyleKey } from "./transform";

export {
  BACKGROUND_ATTACHMENT_OPTIONS,
  BACKGROUND_BLEND_MODE_OPTIONS,
  BACKGROUND_REPEAT_OPTIONS,
  BACKGROUND_SECTION_PROPERTIES,
  BACKGROUND_SIZE_OPTIONS,
  DEFAULT_GRADIENT,
  buildBackgroundImageValue,
  clearedBackgroundUpdates,
  colorBackgroundUpdates,
  cssToGradient,
  expandBackgroundShorthand,
  extractBackgroundImageUrl,
  gradientBackgroundUpdates,
  gradientToCSS,
  imageBackgroundUpdates,
  inferBackgroundType,
  resolveBackgroundStyleValues,
} from "./backgroundCss";
export type {
  BackgroundAttachment,
  BackgroundBlendMode,
  BackgroundRepeat,
  BackgroundSize,
  BackgroundStyleKey,
  BackgroundType,
  GradientConfig,
  GradientStop,
  GradientType,
} from "./backgroundCss";

export {
  HEIGHT_SIZING_PROP,
  SIZE_SECTION_PROPERTIES,
  WIDTH_SIZING_PROP,
  applyExactDimensions,
  applySizeMode,
  applySizingResolution,
  axisHasExplicitSizing,
  formatExactInputValue,
  inferSizeModeFromCSSValue,
  layoutParentContextForPath,
  mergeParentLayoutContext,
  normalizeSizeValue,
  resizeAxesForHandle,
  resolveParentLayoutContext,
  resolveSizeMode,
  resolveSizingCss,
} from "./resolveSizingCss";
export type {
  ParentLayoutContext,
  SizeAxis,
  SizeMode,
} from "./resolveSizingCss";

export {
  GLOBAL_ATTRS,
  GLOBAL_ATTR_FIELDS,
  HTML_TAGS,
  PALETTE_HTML_TAGS,
  PHRASING_TAGS,
  VOID_TAGS,
  canContainTag,
  getElementPropsSchema,
  getElementSchema,
} from "./elementSchemas";
export type { PaletteHtmlTag } from "./elementSchemas";

export {
  COMPOSER_VISUAL_TAGS,
  canAppearInsideComposerRichText,
  composerRichTextFromJson,
  composerRichTextMode,
  composerRichTextOwnerPath,
  composerRichTextPlainText,
  composerRichTextToJson,
  isComposerRichTextBlock,
  isComposerRichTextHost,
  isComposerVisualElement,
  isComposerVisualTag,
} from "./richText";
export type {
  ComposerRichTextDocument,
  ComposerRichTextJson,
  ComposerRichTextMode,
} from "./richText";

export {
  ARIA_PALETTE_PRIMITIVES,
  ARIA_PRIMITIVE_IDS,
  BLOCK_DEFINITIONS,
  COMPOSER_BLOCK_IDS,
  COMPOSER_IMAGE_PLACEHOLDER_SRC,
  LEGACY_BRANDED_COMPOSER_IMAGE_PLACEHOLDER_SRC,
  LEGACY_COMPOSER_IMAGE_PLACEHOLDER_SRC,
  ariaPrimitiveDef,
  blankPageAstroSource,
  composerBlockDef,
  createAriaPrimitiveNode,
  insertAriaPrimitiveAt,
  isAriaPrimitiveId,
} from "./ariaPrimitives";
export * from "./ariaBem";
export { ARIA_BEM_PRIMITIVES_CSS } from "./ariaBemCss";
export {
  formatAgentNodeNormalizationIssues,
  getComposerNodeCapabilities,
  listComposerElementTypes,
  normalizeAgentNodeForInsert,
  normalizeAgentNodeTreeForInsert,
} from "./agentNodeNormalizer";
export type {
  AgentNodeNormalizationIssue,
  AgentNodeNormalizationPath,
  AgentNodeNormalizationResult,
  AgentNodeTreeNormalizationResult,
} from "./agentNodeNormalizer";
export {
  applyAgentComposerInsert,
  prepareAgentComposerInsert,
  resolveAgentComposerInsertPlacement,
  runAgentComposerInsertBoundary,
} from "./agentComposerInsert";
export * from "./agentUtilityClasses";
export type {
  AgentComposerInsertPlacement,
  AgentComposerInsertPlacementReason,
  AgentComposerInsertResult,
} from "./agentComposerInsert";
export {
  applyAgentNodeClassUpdate,
  CLASS_BREAKPOINTS,
  describeClassAuthoringCapabilities,
} from "./agentNodeClasses";
export type {
  AgentClassNamesInput,
  AgentUpdateNodeClassesInput,
  ClassBreakpoint,
} from "./agentNodeClasses";
export type {
  AriaPalettePrimitive,
  AriaPrimitiveId,
  BlockDefinition,
  BlankPageAstroOptions,
  ComposerBlockId,
} from "./ariaPrimitives";
export { chooseImportPath, importPathsFor } from "./importPath";
export type { ImportPathOptions } from "./importPath";

export {
  sameSelection,
  selectionKey,
  toggleSelection,
  uniqueSelectionPaths,
} from "./selection";
export type { ComposerSelectionState, SelectionRef } from "./selection";
export {
  COMPOSER_COMPONENT_AUTHORING_ROUTE,
  COMPOSER_COMPONENT_THUMBNAIL_ROUTE,
  deriveComposerComponentPreviewData,
  isAriaManagedRoute,
  mergeComposerComponentPreviewData,
  previewDatePropKeys,
  previewDateRevivalSource,
  resolveCmsEntryPreviewRoute,
} from "./componentAuthoring";
export type {
  ComposerCmsEntryTemplatePreviewContext,
  ComposerCmsPreviewEntry,
  ComposerComponentInstanceSegment,
  ComposerComponentPreviewData,
  ComposerComponentPreviewDiagnostic,
  ComposerComponentPreviewSession,
  ComposerDocumentLaunchRequest,
  ComposerPreviewValue,
} from "./componentAuthoring";
export {
  COLLAPSED_AFFORDANCE_HEIGHT,
  visualAffordanceRect,
} from "./overlays";
export type {
  CanvasDropCandidate,
  OverlayDescriptor,
  ResizeHandle,
  ResizePreview,
} from "./overlays";
export {
  ARIA_COMPOSER_CLIPBOARD_MIME,
  clipboardPlainText,
  decodeComposerClipboard,
  encodeComposerClipboard,
  looksLikeSourceCodePaste,
  serializeClipboardHtml,
} from "./clipboard";
export {
  COMMON_UTILITY_CANDIDATES,
  FALLBACK_BREAKPOINTS,
  isLikelyUtilityClass,
} from "./frameworks";
export type {
  ComposerFrameworkCapabilities,
  ComposerUtilityFramework,
} from "./frameworks";
export {
  extractClassRuleCss,
  normalizeClassSelectorSuffix,
  parseCssRuleTree,
  patchClassDeclarations,
  preserveClassApplyDirectives,
  readClassDeclarations,
  writeClassDeclarations,
} from "./cssRuleAst";
export type { ClassRuleState, CssRuleRecord } from "./cssRuleAst";
export type {
  ComposerConflictResult,
  ComposerEditTransaction,
  ComposerEditTransactionResult,
  ComposerFileRevision,
  ComposerPageEdit,
  ComposerSourceEdit,
  ComposerStylesheetEdit,
  ComposerManagedArtifactEdit,
} from "./transaction";
export { patchComposerModelSource } from "./sourcePatches";
export type { ComposerSourcePatchResult } from "./sourcePatches";
export type {
  ComposerCodeCompletion,
  ComposerCodeDiagnostic,
  ComposerCodeLanguageResult,
  ComposerCodePosition,
  ComposerCodeRange,
} from "./language";
export type {
  ComposerClipboardClassRule,
  ComposerClipboardFormats,
  ComposerClipboardPayloadV1,
} from "./clipboard";
export {
  extractClipboardFragment,
  importExternalComposerClipboard,
  stripClipboardBom,
  unwrapEditorSourceHtml,
} from "./clipboardImport";
export type {
  ComposerClipboardImportFailureCode,
  ComposerClipboardImportKind,
  ComposerClipboardImportResult,
  ComposerClipboardImportWarning,
} from "./clipboardImport";

export { parseAstro } from "./parseAstro";
export {
  discoverAstroStyleClasses,
  duplicateAstroStyleClass,
  readAstroStyleClassDeclarations,
  writeAstroStyleClassDeclarations,
} from "./astroStyleRules";
export type { AstroStyleClassRule } from "./astroStyleRules";
export { serializeAstro, serializeAstroMarked, serializeAttrs } from "./serializeAstro";
export {
  openingSelectionNode,
  openingSelectionPath,
} from "./openingSelection";
export {
  bareMarkerPath,
  buildStructureTree,
  isMarkerPathInScope,
  isUnderFocusPath,
  labelForNode,
  markerPathForNodeId,
  markerScopeForFile,
  nodeAtMarkerPath,
  overlayInfoForPath,
  parseMarkerPath,
  scopedMarkerPath,
  tryParseMarkerPath,
} from "./paths";
export type {
  MarkerPathSeg,
  OverlayInfo,
  StructureKind,
  StructureRow,
} from "./paths";

export {
  buildComposerLayerTree,
  isComposerContentPath,
  resolveComposerLayerDropPosition,
  resolveDirectPageContentParentPath,
  resolveLayoutPageContentParentPath,
  resolvePageContentParentPath,
  scopeComposerLayerTreeToInstance,
  wrapComposerLayerTreeInActiveDocument,
} from "./layers";
export type {
  ComposerLayerDragSession,
  ComposerLayerAddress,
  ComposerLayerInstanceRef,
  ComposerLayerDropCandidate,
  ComposerLayerDropPosition,
  ComposerLayerRegion,
  ComposerLayerRow,
  ComposerLayerSemanticType,
  ComposerLayerTreeProjection,
} from "./layers";

export {
  COMPOSER_DEFAULT_SLOT_ID,
  assignComposerPageLayout,
  assignComposerPageNodesToSlot,
  blankLayoutAstroSource,
  blankPageWithLayoutAstroSource,
  buildComposerLayoutContract,
  buildComposerPageSlotGroups,
  composerPageUsesLayoutFile,
  datePropExpression,
  deleteComposerLayoutSlot,
  insertComposerLayoutSlot,
  isValidComposerSlotName,
  normalizeComposerPageSlotGroup,
  removeComposerPageLayout,
  renameComposerLayoutSlot,
  renameComposerPageSlotAssignments,
  seedLayoutCreationProps,
  titleFromPageFileName,
  todayDateInputValue,
  unwrapComposerPageSlotAssignments,
} from "./layoutAuthoring";
export type {
  ComposerAssignLayoutOptions,
  ComposerLayoutContract,
  ComposerLayoutSlotDefinition,
  ComposerPageSlotGroup,
  ComposerPageSlotGroupKind,
  ComposerPageSlotProjection,
} from "./layoutAuthoring";

export {
  DEFAULT_ELEMENT_TEXT,
  allocNodeId,
  canReorder,
  cloneNodeWithNewIds,
  cloneNodesWithNewIds,
  collectStaticDomIds,
  createComponentNode,
  createElementNode,
  deleteNodeAtPath,
  duplicateNodeAtPath,
  ensureComponentImport,
  insertComponentAt,
  insertDebugElement,
  insertElementAt,
  insertNodeAt,
  insertNodesAt,
  locateAtPath,
  nodeAcceptsChild,
  parentAcceptsChildAtPath,
  parentPathOf,
  pruneImports,
  renamePropAtPath,
  reorderNodeAtPath,
  reparentNodeAtPath,
  reparentNodesAtPaths,
  resolveInsertTarget,
  resolveCanvasDropTarget,
  setPropAtPath,
  setTextAtPath,
  setTagAtPath,
} from "./mutate";
export type {
  CloneNodeForestOptions,
  CloneNodeForestResult,
  InsertTarget,
  MutateResult,
  ParentListLocation,
  ReorderDirection,
} from "./mutate";

export {
  ARIA_MSG,
  ARIA_PROTOCOL_VERSION,
  isAriaIframeToHostMessage,
  isAriaProtocolMessage,
} from "./protocol";
export type {
  AriaClickMessage,
  AriaClearPreviewStyleMessage,
  AriaDragLeaveMessage,
  AriaDragOverMessage,
  AriaDesignInteractionMessage,
  AriaDisplayOptionsMessage,
  AriaDropHitMessage,
  AriaHoverMessage,
  AriaHostToIframeMessage,
  AriaIframeToHostMessage,
  AriaMsgType,
  AriaOpenMessage,
  AriaPageHeightMessage,
  AriaPasteMessage,
  AriaPatchNodesMessage,
  AriaPreviewStyleMessage,
  AriaReconcileMessage,
  AriaReconcileResultMessage,
  AriaRect,
  AriaRectsMessage,
  AriaScrollToMessage,
  AriaSetVhMessage,
  AriaShortcutMessage,
  AriaTrackMessage,
} from "./protocol";

export type * from "./types";
export * from "./previewDiff";
