import { createColumnHelper, type ColumnDef } from "@tanstack/vue-table"
import { computed, h, type Ref } from "vue"
import { Badge } from "@/components/ui/badge"
import { AppIcon } from "@/components/ui/app-icon"
import { m } from "@/paraglide/messages.js"
import {
  createStudioTableSelectColumn,
  useStudioInventoryTable,
} from "@/workspace/studio/core"
import { collectionKindIcon } from "../lib/collectionKindOptions"
import { formatCmsRelativeTime } from "../lib/formatCmsTime"
import type { CollectionSummary } from "./useCollectionsList"

const columnHelper = createColumnHelper<CollectionSummary>()

export function useCmsCollectionsTable(data: Ref<CollectionSummary[]>) {
  const columns = computed<ColumnDef<CollectionSummary, unknown>[]>(() => [
    createStudioTableSelectColumn<CollectionSummary>(),
    columnHelper.accessor((row) => row.label, {
      id: "label",
      header: m.cms_collections_column_name(),
      minSize: 260,
      enableHiding: false,
      meta: { studioTableWidthMode: "flex" },
      cell: ({ row }) =>
        h("div", { class: "flex min-w-0 items-center gap-3" }, [
          h(AppIcon, {
            name: collectionKindIcon(row.original.kind),
            size: 16,
            class: "shrink-0 text-muted-foreground",
          }),
          h(
            "span",
            { class: "block truncate text-sm font-medium text-foreground" },
            row.original.label,
          ),
        ]),
    }),
    columnHelper.accessor((row) => row.name, {
      id: "name",
      header: m.cms_collections_column_slug(),
      minSize: 220,
      size: 220,
      meta: { studioTableWidthMode: "min" },
      cell: ({ row }) =>
        h(
          "span",
          {
            class:
              "block max-w-full truncate font-mono text-xs text-muted-foreground/60 tabular-nums",
          },
          row.original.name,
        ),
    }),
    columnHelper.accessor((row) => row.kind, {
      id: "kind",
      header: m.cms_collections_column_kind(),
      size: 120,
      meta: { studioTableWidthMode: "fixed" },
      cell: ({ row }) =>
        h(Badge, { variant: "secondary", class: "capitalize" }, () =>
          row.original.kind,
        ),
    }),
    columnHelper.accessor((row) => row.itemCount, {
      id: "itemCount",
      header: m.cms_collections_column_entries(),
      size: 104,
      meta: { studioTableWidthMode: "fixed" },
      cell: ({ row }) =>
        h(
          "span",
          { class: "text-xs text-muted-foreground tabular-nums" },
          row.original.countAvailable ? String(row.original.itemCount) : "—",
        ),
    }),
    columnHelper.accessor((row) => row.updatedAt, {
      id: "updatedAt",
      header: m.cms_collections_column_updated(),
      size: 112,
      meta: { studioTableWidthMode: "fixed" },
      cell: ({ row }) =>
        h(
          "span",
          { class: "text-xs text-muted-foreground tabular-nums" },
          formatCmsRelativeTime(row.original.updatedAt),
        ),
    }),
  ])

  return useStudioInventoryTable({
    rows: data,
    columns,
    enableRowSelection: (row) => !row.original.readOnly,
    getRowId: (row) => row.id,
    initialSorting: [{ id: "label", desc: false }],
  })
}
