<script setup lang="ts">
import { computed } from "vue"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useSlugChangeRedirect } from "@/workspace/settings/composables/useSlugChangeRedirect"
import { m } from "@/paraglide/messages.js"

const { pending, isCreating, dismiss, createSuggestedRedirect } =
  useSlugChangeRedirect()

const isOpen = computed({
  get: () => pending.value.open,
  set: (open: boolean) => {
    if (!open) dismiss()
  },
})
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>
          {{ m.settings_discovery_redirects_slug_prompt_title() }}
        </DialogTitle>
        <DialogDescription>
          <span>
            {{ m.settings_discovery_redirects_slug_prompt_before_source() }}
            <code class="font-mono text-xs">{{ pending.fromPath }}</code>.
            {{ m.settings_discovery_redirects_slug_prompt_before_destination() }}
            <code class="font-mono text-xs">{{ pending.toPath }}</code>?
          </span>
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" :disabled="isCreating" @click="dismiss">
          {{ m.settings_discovery_redirects_slug_prompt_not_now() }}
        </Button>
        <Button :disabled="isCreating" @click="createSuggestedRedirect">
          {{ m.settings_discovery_redirects_slug_prompt_create() }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
