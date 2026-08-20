<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { Button } from "@/components/ui/button"
import { AppIcon } from "@/components/ui/app-icon"
import { Switch } from "@/components/ui/switch"
import { HeaderActionTooltip } from "@/workspace/studio/core"
import { cn } from "@/lib/utils"
import {
  getInferenceBackendDefinition,
  isCredentialBackend,
  type AgentSettings,
  type CatalogModel,
  type CredentialStorageCapability,
  type CredentialStorageKind,
  type ProviderInstance,
} from "../../../../shared/agent"
import InferenceCredentialFields from "./InferenceCredentialFields.vue"
import InferenceModelCatalog from "./InferenceModelCatalog.vue"

const props = defineProps<{
  instance: ProviderInstance
  form: AgentSettings
  catalogModels: CatalogModel[]
  catalogLoading?: boolean
  catalogError?: string | null
  needsCredentials?: boolean
  /** true = Saved, false = Not connected, undefined = still checking */
  configured?: boolean
  credentialStorage?: CredentialStorageKind
  legacyInsecure?: boolean
  credentialCapability?: CredentialStorageCapability | null
  canEdit?: boolean
  saving?: boolean
  expanded?: boolean
}>()

const emit = defineEmits<{
  activate: []
  deactivate: []
  remove: []
  expand: []
  setSiteDefault: [modelId: string]
  toggleModel: [modelId: string, enabled: boolean]
  credentialsChanged: [state: { configured: boolean }]
  saveBaseUrl: [baseUrl: string]
  setOpencodePlan: [plan: "zen" | "go"]
}>()

const isExpanded = ref(props.expanded ?? false)
const isConfirmingRemove = ref(false)
const opencodePlans = ["go", "zen"] as const

watch(
  () => props.expanded,
  (val) => {
    if (val !== undefined) isExpanded.value = val
  },
)

watch(isExpanded, (expanded) => {
  if (expanded) emit("expand")
})

const definition = computed(() =>
  getInferenceBackendDefinition(props.instance.backend),
)

const isActive = computed(() => props.instance.enabled === true)

const siteDefaultModelId = computed(() =>
  props.form.inference.default?.instanceId === props.instance.id
    ? props.form.inference.default.modelId
    : undefined,
)

const isSiteDefaultProvider = computed(
  () => props.form.inference.default?.instanceId === props.instance.id,
)

const requiresCredentialSetup = computed(() =>
  isCredentialBackend(props.instance.backend),
)

const canBrowseModels = computed(
  () => !requiresCredentialSetup.value || props.configured === true,
)

const activeModelCount = computed(() => props.instance.enabledModelIds.length)

const planLabel = computed(() => {
  if (props.instance.backend !== "opencode") return null
  if (props.instance.opencodePlan === "go") return "OpenCode Go"
  if (props.instance.opencodePlan === "zen") return "OpenCode Zen"
  return "Choose plan"
})

function confirmRemove() {
  isConfirmingRemove.value = false
  emit("remove")
}

function setOpencodePlan(value: unknown) {
  if (value === "zen" || value === "go") {
    emit("setOpencodePlan", value)
  }
}
</script>

<template>
  <div
    :class="[
      'overflow-hidden rounded-xl border bg-background shadow-sm transition-colors',
      isSiteDefaultProvider
        ? 'border-primary/30 ring-1 ring-primary/20'
        : 'border-border/60',
    ]"
  >
    <div class="flex min-h-16 items-center gap-2 px-3 py-2 sm:px-4">
      <button
        type="button"
        class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg px-1 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        :aria-expanded="isExpanded"
        @click="isExpanded = !isExpanded"
      >
        <AppIcon
          name="chevronDown"
          :size="15"
          :class="
            cn(
              'shrink-0 text-muted-foreground transition-transform duration-150',
              isExpanded ? 'rotate-0' : '-rotate-90',
            )
          "
        />

        <span class="min-w-0 flex-1 space-y-1">
          <span class="flex flex-wrap items-center gap-1.5">
            <span class="text-sm font-medium">
              {{ definition.label }}
            </span>
            <span
              v-if="planLabel"
              class="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
            >
              {{ planLabel }}
            </span>
            <span
              v-if="isSiteDefaultProvider"
              class="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
            >
              Site default
            </span>
          </span>
          <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              class="size-1.5 shrink-0 rounded-full"
              :class="isActive ? 'bg-primary' : 'bg-muted-foreground/50'"
              aria-hidden="true"
            />
            {{ isActive ? "Active" : "Inactive" }}
            <span aria-hidden="true">·</span>
            {{ activeModelCount }}
            {{ activeModelCount === 1 ? "model" : "models" }}
          </span>
        </span>
      </button>

      <div v-if="canEdit" class="flex shrink-0 items-center gap-2">
        <Switch
          :model-value="isActive"
          :disabled="saving"
          :aria-label="`${isActive ? 'Deactivate' : 'Activate'} ${definition.label}`"
          @update:model-value="$event ? emit('activate') : emit('deactivate')"
        />
        <template v-if="isConfirmingRemove">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            :disabled="saving"
            @click.stop="isConfirmingRemove = false"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            :disabled="saving"
            @click.stop="confirmRemove()"
          >
            Remove
          </Button>
        </template>
        <HeaderActionTooltip v-else label="Remove provider" side="top">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            class="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            :disabled="saving"
            @click.stop="isConfirmingRemove = true"
          >
            <AppIcon name="trash" class="size-3.5" />
          </Button>
        </HeaderActionTooltip>
      </div>
    </div>

    <div
      v-if="isExpanded"
      class="space-y-5 border-t border-border/50 bg-muted/10 px-4 py-4 sm:px-5"
      :class="{ 'opacity-50': !isActive }"
    >
      <div
        v-if="instance.backend === 'opencode'"
        class="flex flex-wrap items-center gap-3"
      >
        <span class="w-16 text-xs font-medium text-muted-foreground">Plan</span>
        <div
          class="inline-flex rounded-lg bg-muted p-1"
          role="group"
          aria-label="OpenCode plan"
        >
          <button
            v-for="plan in opencodePlans"
            :key="plan"
            type="button"
            class="h-8 min-w-24 rounded-md px-3 text-xs font-medium outline-none transition-[background-color,color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring"
            :class="
              instance.opencodePlan === plan
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            "
            :aria-pressed="instance.opencodePlan === plan"
            :disabled="!canEdit || !isActive || saving"
            @click="setOpencodePlan(plan)"
          >
            {{ plan === "go" ? "Go" : "Zen" }}
          </button>
        </div>
      </div>

      <InferenceCredentialFields
        v-if="requiresCredentialSetup"
        :instance-id="instance.id"
        :backend-id="instance.backend"
        :configured="configured"
        :storage="credentialStorage"
        :legacy-insecure="legacyInsecure"
        :capability="credentialCapability"
        :can-edit="canEdit"
        :disabled="!isActive || saving"
        :base-url="instance.baseUrl"
        @save-base-url="emit('saveBaseUrl', $event)"
        @credentials-changed="emit('credentialsChanged', $event)"
      />

      <InferenceModelCatalog
        v-if="canBrowseModels"
        :models="catalogModels"
        :enabled-model-ids="instance.enabledModelIds"
        :default-model-id="instance.defaultModelId"
        :site-default-model-id="siteDefaultModelId"
        :can-edit="canEdit"
        :disabled="!isActive || saving"
        :loading="catalogLoading"
        :error="catalogError"
        :needs-credentials="needsCredentials"
        @toggle-model="
          (modelId, enabled) => emit('toggleModel', modelId, enabled)
        "
        @set-default="emit('setSiteDefault', $event)"
      />
    </div>
  </div>
</template>
