import { createColumnHelper, type ColumnDef } from "@tanstack/vue-table"
import { computed, h, type Ref } from "vue"
import { Badge } from "@/components/ui/badge"
import { m } from "@/paraglide/messages.js"
import {
  createStudioTableSelectColumn,
  useStudioInventoryTable,
} from "@/workspace/studio/core"
import type { EntryStatus, FieldSchema } from "../../../../../shared/cms"
import { formatCmsRelativeTime } from "../lib/formatCmsTime"
import type { CmsEntryRow } from "../lib/entryRow"
import CmsEntryCoverThumb from "../components/CmsEntryCoverThumb.vue"

const columnHelper = createColumnHelper<CmsEntryRow>()

function statusLabel(status: EntryStatus): string {
  switch (status) {
    case "draft":
      return m.cms_status_draft()
    case "published":
      return m.cms_status_published()
    case "archived":
      return m.cms_status_archived()
    default:
      return status
  }
}

function statusVariant(
  status: EntryStatus,
): "default" | "secondary" | "outline" {
  switch (status) {
    case "published":
      return "default"
    case "archived":
      return "outline"
    case "draft":
    default:
      return "secondary"
  }
}

function formatFieldValue(value: unknown): string {
  if (value == null) return "—"
  if (typeof value === "string") return value || "—"
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  if (Array.isArray(value)) return value.map(String).join(", ") || "—"
  try {
    return JSON.stringify(value)
  } catch {
    return "—"
  }
}

export function useCmsEntryTable(options: {
  data: Ref<CmsEntryRow[]>
  fields: Ref<readonly FieldSchema[]>
  projectRoot: Ref<string>
  supportsCover?: Ref<boolean>
}) {
  const columns = computed<ColumnDef<CmsEntryRow, unknown>[]>(() => [
    createStudioTableSelectColumn<CmsEntryRow>(),
    ...(options.supportsCover?.value !== false
      ? [
          columnHelper.accessor((row) => row.frontmatter, {
            id: "cover",
            header: m.cms_entries_column_cover(),
            size: 76,
            meta: { studioTableWidthMode: "fixed" },
            enableSorting: false,
            cell: ({ row }) =>
              h(CmsEntryCoverThumb, {
                frontmatter: row.original.frontmatter,
                title: row.original.title,
                projectRoot: options.projectRoot.value,
                variant: "table",
                coverSupported: true,
              }),
          }),
        ]
      : []),
    columnHelper.accessor((row) => row.title, {
      id: "title",
      header: m.cms_entries_column_title(),
      minSize: 280,
      size: 320,
      enableHiding: false,
      meta: { studioTableWidthMode: "min" },
      cell: ({ row }) =>
        h(
          "span",
          { class: "block truncate text-sm font-semibold text-foreground" },
          row.original.title || m.cms_entries_untitled(),
        ),
    }),
    columnHelper.accessor((row) => row.slug, {
      id: "slug",
      header: m.cms_entries_column_slug(),
      minSize: 160,
      size: 176,
      meta: { studioTableWidthMode: "min" },
      cell: ({ row }) =>
        h(
          "span",
          {
            class:
              "block max-w-full truncate font-mono text-xs text-muted-foreground/60 tabular-nums",
          },
          row.original.slug,
        ),
    }),
    columnHelper.accessor((row) => row.status, {
      id: "status",
      header: m.cms_entries_column_status(),
      size: 104,
      meta: { studioTableWidthMode: "fixed" },
      cell: ({ row }) =>
        h(
          Badge,
          {
            variant: statusVariant(row.original.status),
            class: "h-6 px-2 text-[11px] capitalize",
          },
          () => statusLabel(row.original.status),
        ),
    }),
    columnHelper.accessor((row) => row.updatedAt, {
      id: "updatedAt",
      header: m.cms_entries_column_updated(),
      size: 112,
      meta: { studioTableWidthMode: "fixed" },
      cell: ({ row }) =>
        h(
          "span",
          { class: "text-xs text-muted-foreground" },
          formatCmsRelativeTime(row.original.updatedAt),
        ),
    }),
    columnHelper.accessor((row) => row.publishedAt, {
      id: "publishedAt",
      header: m.cms_entries_column_published(),
      size: 112,
      meta: { studioTableWidthMode: "fixed" },
      cell: ({ row }) =>
        h(
          "span",
          { class: "text-xs text-muted-foreground" },
          formatCmsRelativeTime(row.original.publishedAt),
        ),
    }),
    ...options.fields.value
      .filter((field) => field.showInEntryList)
      .map((field) =>
        columnHelper.accessor((row) => row.frontmatter[field.key], {
          id: `field:${field.key}`,
          header: field.label,
          minSize: 132,
          size: 144,
          enableSorting: false,
          meta: { studioTableWidthMode: "min" },
          cell: ({ row }) =>
            h(
              "span",
              {
                class:
                  "block max-w-full truncate text-xs text-muted-foreground/70",
              },
              formatFieldValue(row.original.frontmatter[field.key]),
            ),
        }),
      ),
  ])

  return useStudioInventoryTable({
    rows: options.data,
    columns,
    getRowId: (row) => row.id,
    initialSorting: [{ id: "updatedAt", desc: true }],
  })
}
