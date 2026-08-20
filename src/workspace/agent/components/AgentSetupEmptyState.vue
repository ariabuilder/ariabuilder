<script setup lang="ts">
import { Button } from "@/components/ui/button"
import { useAgentPanel } from "../composables/useAgentPanel"

const panel = useAgentPanel()

function openSettings() {
  panel.closePanel()
  panel.openAgentSettings()
}
</script>

<template>
  <div
    class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
  >
    <p class="text-sm text-muted-foreground">
      Add a bring-your-own-key inference provider in Settings → Agent to start
      chatting.
    </p>
    <Button variant="secondary" size="sm" @click="openSettings">
      Open Agent settings
    </Button>
  </div>
</template>
