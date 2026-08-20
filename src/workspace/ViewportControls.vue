<script setup lang="ts">
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { m } from "@/paraglide/messages.js"
import type { DevicePreview } from "@/workspace/types"

const props = withDefaults(
  defineProps<{
    device: DevicePreview | null
    /** Preview board: click the active device to return to all breakpoints. */
    allowDeselect?: boolean
  }>(),
  { allowDeselect: false },
)

const emit = defineEmits<{
  change: [device: DevicePreview | null]
}>()

const devices: Array<{
  id: DevicePreview
  icon: "deviceDesktop" | "deviceTablet" | "deviceMobile"
  label: () => string
}> = [
  {
    id: "desktop",
    icon: "deviceDesktop",
    label: () => m.workspace_device_desktop(),
  },
  {
    id: "tablet",
    icon: "deviceTablet",
    label: () => m.workspace_device_tablet(),
  },
  {
    id: "mobile",
    icon: "deviceMobile",
    label: () => m.workspace_device_mobile(),
  },
]

function tooltip(entry: (typeof devices)[number]): string {
  if (props.allowDeselect && props.device === entry.id) {
    return m.workspace_viewport_show_all()
  }
  return entry.label()
}

function select(id: DevicePreview) {
  if (props.allowDeselect && props.device === id) {
    emit("change", null)
    return
  }
  emit("change", id)
}
</script>

<template>
  <div
    class="flex items-center gap-0.5"
    role="group"
    :aria-label="m.workspace_viewport()"
  >
    <Tooltip v-for="entry in devices" :key="entry.id">
      <TooltipTrigger as-child>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          :class="[
            'size-7 p-0 text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary',
            device === entry.id
              ? 'bg-transparent text-primary hover:bg-transparent hover:text-primary'
              : 'bg-transparent',
          ]"
          :aria-label="tooltip(entry)"
          :aria-pressed="device === entry.id"
          @click="select(entry.id)"
        >
          <AppIcon :name="entry.icon" :size="15" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{{ tooltip(entry) }}</TooltipContent>
    </Tooltip>
  </div>
</template>
