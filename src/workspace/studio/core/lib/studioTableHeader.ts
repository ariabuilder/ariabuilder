import type { Column, HeaderGroup, Table } from "@tanstack/vue-table"

/** Column ids that never show sort affordances or handle sort clicks. */
export const STUDIO_TABLE_NON_SORTABLE_COLUMN_IDS = [
  "select",
  "cover",
  "actions",
  "searchText",
] as const

export type StudioTableNonSortableColumnId =
  (typeof STUDIO_TABLE_NON_SORTABLE_COLUMN_IDS)[number]

/** How a table column participates in width distribution (table-fixed layouts). */
export type StudioTableWidthMode = "fixed" | "flex" | "min" | "content"

export interface StudioTableColumnMeta {
  studioTableWidthMode?: StudioTableWidthMode
}

export interface StudioTableHeaderTable {
  getHeaderGroups: () => HeaderGroup<unknown>[]
  getVisibleLeafColumns: () => Column<unknown, unknown>[]
}

/** Minimal column surface for width helpers (avoids Column<T> invariance). */
export interface StudioTableColumnLike {
  columnDef: {
    meta?: unknown
    minSize?: number
  }
  getSize: () => number
}

export function isStudioTableSortableColumn(columnId: string): boolean {
  return !STUDIO_TABLE_NON_SORTABLE_COLUMN_IDS.includes(
    columnId as StudioTableNonSortableColumnId,
  )
}

export function getStudioTableWidthMode(
  column: StudioTableColumnLike,
): StudioTableWidthMode {
  const meta = column.columnDef.meta as StudioTableColumnMeta | undefined

  if (meta?.studioTableWidthMode) {
    return meta.studioTableWidthMode
  }

  return "fixed"
}

export function isStudioTableFlexColumn(column: StudioTableColumnLike): boolean {
  return getStudioTableWidthMode(column) === "flex"
}

/**
 * Fixed — exact px width; flex — absorbs remaining space;
 * min/content — shrink-to-content with a min width.
 */
export function getStudioTableColWidthStyle(
  column: StudioTableColumnLike,
): Record<string, string> | undefined {
  const mode = getStudioTableWidthMode(column)

  if (mode === "flex") {
    // `width: 100%` in table-fixed layouts lets this column claim leftover space
    // after sibling columns with explicit pixel widths are accounted for.
    return { width: "100%" }
  }

  if (mode === "min" || mode === "content") {
    const minWidth = column.columnDef.minSize ?? column.getSize()
    return {
      width: `${minWidth}px`,
    }
  }

  return { width: `${column.getSize()}px` }
}

export function getStudioTableColumnWidthStyle(size: number): { width: string } {
  return { width: `${size}px` }
}

export interface StudioTableColumnLabelLike {
  id: string
  columnDef: { header?: unknown }
}

export function getStudioTableColumnLabel(
  column: StudioTableColumnLabelLike,
): string {
  const header = column.columnDef.header
  if (typeof header === "string" && header.length > 0) {
    return header
  }
  return column.id
}

/**
 * Adapts TanStack Table to the header chrome API without erasing row types.
 */
export function toStudioTableHeaderTable<TData>(
  table: Table<TData>,
): StudioTableHeaderTable {
  return {
    getHeaderGroups: () =>
      table.getHeaderGroups() as HeaderGroup<unknown>[],
    getVisibleLeafColumns: () =>
      table.getVisibleLeafColumns() as Column<unknown, unknown>[],
  }
}
