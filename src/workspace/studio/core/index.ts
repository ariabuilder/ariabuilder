/** Public studio UI primitives and helpers used outside `studio/core`. */

export { default as EmptyState } from "./components/EmptyState.vue"
export { default as ExpandableSearchInput } from "./components/ExpandableSearchInput.vue"
export { default as FilterIconMenu } from "./components/FilterIconMenu.vue"
export type {
  FilterIconMenuOption,
  FilterIconMenuSection,
} from "./components/FilterIconMenu.vue"
export { default as FlickeringNavItem } from "./components/FlickeringNavItem.vue"
export { default as HeaderActionDropdownTooltip } from "./components/HeaderActionDropdownTooltip.vue"
export { default as HeaderActionTooltip } from "./components/HeaderActionTooltip.vue"
export { default as InventoryTableFooter } from "./components/InventoryTableFooter.vue"
export { default as PageHeader } from "./components/PageHeader.vue"
export { default as SearchOrBulkToolbar } from "./components/SearchOrBulkToolbar.vue"
export { default as SkeletonTable } from "./components/SkeletonTable.vue"
export { default as SlidingNavIndicator } from "./components/SlidingNavIndicator.vue"
export { default as StudioInlineCreateNavRow } from "./components/StudioInlineCreateNavRow.vue"
export { default as StudioLeftRailReveal } from "./components/StudioLeftRailReveal.vue"
export { default as StudioNameCreateDialog } from "./components/StudioNameCreateDialog.vue"
export { default as StudioDocumentDetailShell } from "./components/StudioDocumentDetailShell.vue"
export type { StudioDocumentDetailTab } from "./components/StudioDocumentDetailShell.vue"
export { default as StudioDocumentInspectorPanel } from "./components/StudioDocumentInspectorPanel.vue"
export type { StudioDocumentInspectorTab } from "./components/StudioDocumentInspectorPanel.vue"
export { default as StudioOrganizerRail } from "./components/StudioOrganizerRail.vue"
export { default as StudioPanelShell } from "./components/StudioPanelShell.vue"
export { default as StudioRailFrame } from "./components/StudioRailFrame.vue"
export { default as StudioSectionNavRail } from "./components/StudioSectionNavRail.vue"
export type { StudioSectionNavItem } from "./components/StudioSectionNavRail.vue"
export { default as StudioTableColGroup } from "./components/StudioTableColGroup.vue"
export { default as StudioTableColumnMenu } from "./components/StudioTableColumnMenu.vue"
export type { StudioTableColumnMenuColumn } from "./components/StudioTableColumnMenu.vue"
export { default as StudioTableHeader } from "./components/StudioTableHeader.vue"

export {
  beginOrganizerGridCardDrag,
  beginOrganizerListRowDrag,
  endOrganizerDragGhost,
} from "./lib/organizerDragGhost"

export {
  createStudioGroupingEngine,
  type StudioGroupingGroup,
  type StudioGroupingState,
} from "./composables/useStudioGroupingEngine"
export {
  getOrganizerDropCommit,
  ORGANIZER_DRAG_IDS_MIME,
  useStudioOrganizerDragState,
} from "./composables/useStudioOrganizerDragState"
export {
  useSlidingNavIndicator,
} from "./composables/useSlidingNavIndicator"
export { useStudioInventoryTable } from "./composables/useStudioInventoryTable"
export type { UseStudioInventoryTableOptions } from "./composables/useStudioInventoryTable"
export { useStudioSectionNav } from "./composables/useStudioSectionNav"
export { resolveButtonEl } from "./utils/resolveButtonEl"

export {
  getStudioTableColWidthStyle,
  toStudioTableHeaderTable,
} from "./lib/studioTableHeader"
export { createStudioTableSelectColumn } from "./lib/studioTableSelectColumn"
export {
  STUDIO_TABLE_BODY_CELL_CLASS,
  STUDIO_TABLE_INTERACTIVE_ROW_CLASS,
} from "./lib/studioTableRow"
export {
  formatStudioUpdated,
  humanizeSlug,
} from "./lib/studioDisplay"
export {
  moveToGroupSubmenu,
  revealInFolderMenuItem,
  type StudioMenuGroupOption,
} from "./lib/studioMenuItems"
