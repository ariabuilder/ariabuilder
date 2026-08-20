<script setup lang="ts">
import { ref, watch } from "vue"
import { toast } from "vue-sonner"
import type { AriaCollectionDef } from "@/types/aria"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { deleteCmsCollections, listCmsEntries } from "@/lib/cms"
import { getCollections } from "@/lib/workspace"
import { m } from "@/paraglide/messages.js"

const props = defineProps<{
  open: boolean
  collection: AriaCollectionDef
  projectRoot: string
}>()

const emit = defineEmits<{
  "update:open": [value: boolean]
  deleted: []
}>()

const isDeleting = ref(false)
const entryCount = ref<number | null>(null)

watch(
  () => props.open,
  (open) => {
    if (!open) {
      isDeleting.value = false
      entryCount.value = null
      return
    }
    void listCmsEntries(props.projectRoot, {
      collectionId: props.collection.id,
      page: 1,
      limit: 1,
    })
      .then((result) => {
        if (props.open) entryCount.value = result.total
      })
      .catch(() => {
        entryCount.value = null
      })
  },
)

async function confirmDelete() {
  if (isDeleting.value) return
  isDeleting.value = true
  try {
    const [state, entries] = await Promise.all([
      getCollections(props.projectRoot),
      listCmsEntries(props.projectRoot, {
        collectionId: props.collection.id,
        page: 1,
        limit: 1,
      }),
    ])
    if (!state.revision) throw new Error("Collection revision is unavailable")
    await deleteCmsCollections(
      props.projectRoot,
      [props.collection.id],
      state.revision,
      { deleteEntries: entries.total > 0 },
    )
    toast.success(m.cms_collections_deleted_one())
    emit("deleted")
    emit("update:open", false)
  } catch (err) {
    console.error(err)
    toast.error(m.cms_collections_delete_failed())
  } finally {
    isDeleting.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-[440px]">
      <DialogHeader class="gap-0">
        <DialogTitle>{{ m.cms_collections_delete_one() }}</DialogTitle>
        <DialogDescription>
          {{
            entryCount === 0
              ? m.cms_collections_delete_named_empty_description({
                  collection: collection.label,
                })
              : entryCount === 1
                ? m.cms_collections_delete_named_one_entry_description({
                    collection: collection.label,
                  })
                : entryCount !== null
                  ? m.cms_collections_delete_named_entries_description({
                      collection: collection.label,
                      entryCount: String(entryCount),
                    })
                  : m.cms_collections_delete_named_entries_unknown_description({
                      collection: collection.label,
                    })
          }}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          variant="outline"
          size="sm"
          class="h-9!"
          :disabled="isDeleting"
          @click="emit('update:open', false)"
        >
          {{ m.cms_common_cancel() }}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          class="h-9!"
          :disabled="isDeleting"
          @click="confirmDelete"
        >
          {{
            isDeleting
              ? m.cms_common_deleting()
              : entryCount !== 0
                ? m.cms_collections_delete_one_with_entries()
                : m.cms_collections_delete_one()
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
