import { createColumnHelper, type ColumnDef, type VisibilityState } from "@tanstack/vue-table"
import { computed, h, type Ref } from "vue"
import { useStudioInventoryTable } from "@/workspace/studio/core"
import {
  formatExternalFieldValue,
  getExternalEntryImageUrl,
  getExternalEntryTitle,
  getExternalIdentityField,
  getExternalImageField,
  getSmartExternalVisibleFieldKeys,
} from "../../../../../shared/externalCollectionEntries"
import type {
  ExternalCollectionEntry,
  ExternalFieldDescriptor,
} from "../../../../../shared/types"
import ExternalEntryThumb from "../components/ExternalEntryThumb.vue"

const columnHelper = createColumnHelper<ExternalCollectionEntry>()

export function useExternalEntryTable(options: {
  projectRoot: Ref<string>
  data: Ref<ExternalCollectionEntry[]>
  fields: Ref<ExternalFieldDescriptor[]>
}) {
  const identityField = computed(() => getExternalIdentityField(options.fields.value))
  const imageField = computed(() => getExternalImageField(options.fields.value))
  const lockedColumnId = computed(() =>
    identityField.value ? `field:${identityField.value.key}` : "identity",
  )
  const columns = computed<ColumnDef<ExternalCollectionEntry, unknown>[]>(() => {
    const identity = identityField.value
    const image = imageField.value
    const result: ColumnDef<ExternalCollectionEntry, unknown>[] = [
      {
        id: "select",
        header: "",
        size: 40,
        maxSize: 40,
        enableHiding: false,
        enableSorting: false,
        meta: { studioTableWidthMode: "fixed" },
        cell: () => null,
      },
    ]
    if (image) {
      result.push(columnHelper.display({
        id: "cover",
        header: "Cover",
        size: 76,
        enableSorting: false,
        meta: { studioTableWidthMode: "fixed" },
        cell: ({ row }) => h(ExternalEntryThumb, {
          url: getExternalEntryImageUrl(
            row.original,
            options.fields.value,
            options.projectRoot.value,
          ),
          title: getExternalEntryTitle(row.original),
          variant: "table",
        }),
      }))
    }
    if (!identity) {
      result.push(columnHelper.accessor((row) => row.id, {
        id: "identity",
        header: "Entry",
        minSize: 280,
        size: 320,
        enableHiding: false,
        meta: { studioTableWidthMode: "min" },
        cell: ({ row }) => h("button", {
          type: "button",
          class: "block max-w-full truncate text-start text-sm font-semibold text-foreground focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        }, getExternalEntryTitle(row.original)),
      }))
    }

    for (const field of options.fields.value) {
      if (field.key === image?.key) continue
      result.push(columnHelper.accessor((row) => row.data[field.key], {
        id: `field:${field.key}`,
        header: field.label,
        minSize: field.key === identity?.key ? 280 : 144,
        size: field.key === identity?.key ? 320 : 160,
        enableHiding: field.key !== identity?.key,
        enableSorting: field.sortable,
        meta: { studioTableWidthMode: "min" },
        cell: ({ row }) => {
          const text = field.key === identity?.key
            ? getExternalEntryTitle(row.original)
            : formatExternalFieldValue(row.original.data[field.key], field.type)
          if (field.key === identity?.key) {
            return h("button", {
              type: "button",
              class: "block max-w-full truncate text-start text-sm font-semibold text-foreground focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              title: text,
            }, text)
          }
          return h("span", {
            class: "block max-w-full truncate text-xs text-muted-foreground/70",
            title: text,
          }, text)
        },
      }))
    }
    return result
  })

  const tableState = useStudioInventoryTable({
    rows: options.data,
    columns,
    getRowId: (row) => row.id,
    enableRowSelection: false,
  })

  function applySmartVisibility(): void {
    const visible = new Set(getSmartExternalVisibleFieldKeys(options.fields.value))
    const visibility: VisibilityState = {}
    for (const field of options.fields.value) {
      if (field.key === imageField.value?.key) continue
      visibility[`field:${field.key}`] = visible.has(field.key)
    }
    if (imageField.value) {
      visibility.cover = visible.has(imageField.value.key)
    }
    tableState.table.setColumnVisibility(visibility)
  }

  return {
    ...tableState,
    identityField,
    imageField,
    lockedColumnId,
    applySmartVisibility,
  }
}
