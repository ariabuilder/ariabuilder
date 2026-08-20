import { createColumnHelper, type ColumnDef } from "@tanstack/vue-table"
import { computed, h, type Ref } from "vue"
import { m } from "@/paraglide/messages.js"
import type { MediaAsset } from "@/lib/media"
import {
  createStudioTableSelectColumn,
  formatStudioUpdated,
  useStudioInventoryTable,
} from "@/workspace/studio/core"
import MediaTableThumb from "./components/MediaTableThumb.vue"

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

const columnHelper = createColumnHelper<MediaAsset>()

/** Compact 3:2 thumb (w-12) + horizontal cell gutter. */
export const MEDIA_TABLE_COVER_COLUMN_SIZE = 72

export function useMediaTable(
  rows: Ref<MediaAsset[]>,
  folderById: Ref<Record<string, string>>,
  projectRoot: Ref<string>,
) {
  const columns = computed<ColumnDef<MediaAsset, unknown>[]>(() => [
    createStudioTableSelectColumn<MediaAsset>(),
    columnHelper.display({
      id: "cover",
      header: m.media_col_thumb(),
      cell: ({ row }) =>
        h(MediaTableThumb, {
          asset: row.original,
          projectRoot: projectRoot.value,
        }),
      size: MEDIA_TABLE_COVER_COLUMN_SIZE,
      enableSorting: false,
      meta: {
        studioTableWidthMode: "fixed",
        label: m.media_col_thumb(),
      },
    }),
    columnHelper.accessor("name", {
      id: "name",
      header: m.media_col_name(),
      cell: (info) =>
        h("span", { class: "truncate font-medium" }, info.getValue()),
      size: 240,
      meta: { studioTableWidthMode: "flex", label: m.media_col_name() },
    }),
    columnHelper.accessor("type", {
      id: "type",
      header: m.media_col_type(),
      cell: (info) =>
        h("span", { class: "capitalize text-muted-foreground" }, info.getValue()),
      size: 100,
      meta: { label: m.media_col_type() },
    }),
    columnHelper.accessor("size", {
      id: "size",
      header: m.media_col_size(),
      cell: (info) => formatBytes(info.getValue()),
      size: 90,
      meta: { label: m.media_col_size() },
    }),
    columnHelper.display({
      id: "folder",
      header: m.media_col_folder(),
      cell: ({ row }) => folderById.value[row.original.id] ?? "—",
      size: 120,
      enableSorting: false,
      meta: { label: m.media_col_folder() },
    }),
    columnHelper.accessor("cropCount", {
      id: "variants",
      header: m.media_col_variants(),
      cell: (info) => {
        const count = info.getValue()
        return count > 0 ? String(count) : "—"
      },
      size: 70,
      meta: { label: m.media_col_variants() },
    }),
    columnHelper.accessor("mtimeMs", {
      id: "updated",
      header: m.media_col_updated(),
      cell: (info) => formatStudioUpdated(info.getValue(), ""),
      size: 220,
      meta: { label: m.media_col_updated() },
    }),
  ])

  const inventory = useStudioInventoryTable({
    rows,
    columns,
    getRowId: (row) => row.id,
    initialSorting: [{ id: "updated", desc: true }],
    initialColumnVisibility: {
      cover: true,
      variants: true,
      folder: true,
    },
    enableColumnOrdering: false,
  })

  return { ...inventory, formatBytes }
}
