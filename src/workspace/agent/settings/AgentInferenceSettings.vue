<script setup lang="ts">
import { computed, onMounted, ref, toRef } from "vue"
import { toast } from "vue-sonner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  INFERENCE_BACKEND_DEFINITIONS,
  buildInitialProviderInstance,
  reconcileCatalogModelAvailability,
  type AgentSettings,
  type CredentialBackendId,
  type CredentialStorageCapability,
  type CredentialStorageKind,
  type InferenceBackendId,
  type ProviderInstance,
} from "../../../../shared/agent"
import {
  getAgentAvailability,
  getCredentialStatuses,
  patchAgentSettings,
  removeInferenceProvider,
} from "@/lib/agent"
import { useAriaAgent } from "../composables/useAriaAgent"
import InferenceProviderCard from "./InferenceProviderCard.vue"
import { useInferenceCatalogs } from "./useInferenceCatalogs"
import {
  cloneInferenceDefault,
  isLegacyDisabledModelsSchemaError,
  withoutDisabledModelIds,
} from "./modelAvailability"

const props = defineProps<{
  projectPath: string
  form: AgentSettings
  canEdit?: boolean
  saving?: boolean
}>()

const emit = defineEmits<{
  updated: [settings: AgentSettings]
}>()

const selectedBackendId = ref<InferenceBackendId | "">("")
const newInstanceId = ref<string | null>(null)
const configuredBackends = ref<Partial<Record<InferenceBackendId, boolean>>>({})
const configuredInstances = ref<Record<string, boolean>>({})
const configuredStatusReady = ref(false)
const credentialCapability = ref<CredentialStorageCapability | null>(null)
const credentialStatuses = ref<
  Partial<Record<CredentialBackendId, {
    configured: boolean
    storage?: CredentialStorageKind
    legacyInsecure?: boolean
  }>>
>({})
const sessionDisabledModelIds = new Map<string, string[]>()

const catalogs = useInferenceCatalogs({
  projectPath: toRef(props, "projectPath"),
  form: computed(() => props.form),
  configuredBackends,
})

const listedInstances = computed(() =>
  Object.values(props.form.inference.providerInstances),
)

const listedBackendIds = computed(
  () => new Set(listedInstances.value.map((instance) => instance.backend)),
)

const availableBackends = computed(() =>
  INFERENCE_BACKEND_DEFINITIONS.filter(
    (backend) => !listedBackendIds.value.has(backend.id),
  ),
)

const hasAvailableProviders = computed(() => availableBackends.value.length > 0)

function isInstanceConfigured(instanceId: string): boolean | undefined {
  if (!configuredStatusReady.value) return undefined
  // Prefer per-instance status from main. If the map is missing this id
  // (older Electron builds, or availability without configuredInstances),
  // fall back to backend-level configured so Saved keys are not hidden.
  if (
    Object.prototype.hasOwnProperty.call(configuredInstances.value, instanceId)
  ) {
    return configuredInstances.value[instanceId] === true
  }
  const instance = getInstance(instanceId)
  if (!instance) return false
  return configuredBackends.value[instance.backend] === true
}

function getInstance(instanceId: string): ProviderInstance | undefined {
  return props.form.inference.providerInstances[instanceId]
}

function disabledIdsFor(instance: ProviderInstance): string[] {
  const persisted = sanitizeModelIdList(instance.disabledModelIds)
  return persisted.length > 0 || Array.isArray(instance.disabledModelIds)
    ? persisted
    : (sessionDisabledModelIds.get(instance.id) ?? [])
}

function sanitizeModelIdList(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  const out: string[] = []
  for (const id of ids) {
    if (typeof id === "string") {
      const trimmed = id.trim()
      if (trimmed && trimmed.length <= 128) out.push(trimmed)
      continue
    }
    if (id && typeof id === "object" && "id" in id) {
      const nested = (id as { id: unknown }).id
      if (typeof nested === "string") {
        const trimmed = nested.trim()
        if (trimmed && trimmed.length <= 128) out.push(trimmed)
      }
    }
  }
  return Array.from(new Set(out))
}

function sameModelIds(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  )
}

function formatAgentError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === "string" && error.trim()) return error
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string" && message.trim()) return message
  }
  try {
    return JSON.stringify(error)
  } catch {
    return fallback
  }
}

async function refreshConfigured(): Promise<void> {
  const [availability, credentialStatus] = await Promise.all([
    getAgentAvailability(props.projectPath),
    getCredentialStatuses(),
  ])
  configuredBackends.value = { ...availability.configuredBackends }
  const reportedInstances = availability.configuredInstances
  // Older Electron builds omit configuredInstances. Do not clobber optimistic
  // post-save state with an empty map — isInstanceConfigured falls back to
  // configuredBackends in that case.
  if (
    reportedInstances &&
    Object.keys(reportedInstances).length > 0
  ) {
    configuredInstances.value = { ...reportedInstances }
  }
  credentialCapability.value = credentialStatus.capability
  credentialStatuses.value = { ...credentialStatus.statuses }
  configuredStatusReady.value = true
}

async function persist(
  patch: Parameters<typeof patchAgentSettings>[1],
): Promise<AgentSettings> {
  for (const [instanceId, instancePatch] of Object.entries(
    patch.inference?.providerInstances ?? {},
  )) {
    if (instancePatch && "disabledModelIds" in instancePatch) {
      sessionDisabledModelIds.set(
        instanceId,
        sanitizeModelIdList(instancePatch.disabledModelIds),
      )
    }
  }
  let next: AgentSettings
  try {
    next = await patchAgentSettings(props.projectPath, patch)
  } catch (error) {
    if (!isLegacyDisabledModelsSchemaError(error)) throw error
    next = await patchAgentSettings(
      props.projectPath,
      withoutDisabledModelIds(patch),
    )
  }
  emit("updated", next)
  return next
}

onMounted(async () => {
  try {
    await refreshConfigured()
    await catalogs.refreshListedCatalogs()
    for (const backendId of listedBackendIds.value) {
      await syncCatalogModelsForBackend(backendId)
    }
  } catch (error) {
    toast.error(formatAgentError(error, "Failed to load provider models"))
  }
})

async function onSelectBackend(value: unknown): Promise<void> {
  const backendId = String(value) as InferenceBackendId
  selectedBackendId.value = ""
  const definition = INFERENCE_BACKEND_DEFINITIONS.find(
    (backend) => backend.id === backendId,
  )
  if (!definition) return

  try {
    const instance = buildInitialProviderInstance(backendId, definition.label)
    const currentDefault = props.form.inference.default
    const nextDefault = currentDefault
      ? cloneInferenceDefault(currentDefault)
      : instance.defaultModelId
        ? { instanceId: instance.id, modelId: instance.defaultModelId }
        : undefined
    const next = await persist({
      inference: {
        providerInstances: { [instance.id]: instance },
        default: nextDefault,
      },
    })
    newInstanceId.value = instance.id
    await refreshConfigured()
    await refreshAndSyncBackend(
      instance.backend,
      true,
      next,
    )
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Failed to add provider",
    )
  }
}

async function onActivate(instanceId: string): Promise<void> {
  const instance = getInstance(instanceId)
  if (!instance) return
  try {
    await persist({
      inference: {
        providerInstances: {
          [instanceId]: { enabled: true },
        },
      },
    })
    await refreshConfigured()
    await refreshAndSyncBackend(instance.backend, true)
  } catch (error) {
    toast.error(formatAgentError(error, "Failed to activate provider"))
  }
}

async function onDeactivate(instanceId: string): Promise<void> {
  const instance = getInstance(instanceId)
  if (!instance) return
  try {
    const patch: Parameters<typeof patchAgentSettings>[1] = {
      inference: {
        providerInstances: {
          [instanceId]: { enabled: false },
        },
      },
    }
    if (props.form.inference.default?.instanceId === instanceId) {
      patch.inference!.default = null
    }
    await persist(patch)
  } catch (error) {
    toast.error(formatAgentError(error, "Failed to deactivate provider"))
  }
}

async function onRemove(instanceId: string): Promise<void> {
  try {
    const next = await removeInferenceProvider(props.projectPath, instanceId)
    emit("updated", next)
    toast.success("Provider removed")
    await refreshConfigured()
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Failed to remove provider",
    )
  }
}

async function onSetSiteDefault(
  instanceId: string,
  modelId: string,
): Promise<void> {
  const instance = getInstance(instanceId)
  const safeModelId = sanitizeModelIdList([modelId])[0]
  if (!instance || !safeModelId) return
  if (!sanitizeModelIdList(instance.enabledModelIds).includes(safeModelId)) return

  try {
    await persist({
      inference: {
        default: { instanceId, modelId: safeModelId },
        providerInstances: {
          [instanceId]: { defaultModelId: safeModelId },
        },
      },
    })
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Failed to set site default",
    )
  }
}

async function onToggleModel(
  instanceId: string,
  modelId: string,
  enabled: boolean,
): Promise<void> {
  const instance = getInstance(instanceId)
  if (!instance) return
  const safeModelId = sanitizeModelIdList([modelId])[0]
  if (!safeModelId) return

  const currentEnabled = sanitizeModelIdList(instance.enabledModelIds)
  const currentDisabled = disabledIdsFor(instance)
  const disabledModelIds = enabled
    ? currentDisabled.filter((id) => id !== safeModelId)
    : sanitizeModelIdList([...currentDisabled, safeModelId])
  const loadedCatalog = catalogs.loadedCatalogForBackend(instance.backend)
  const reconciled = reconcileCatalogModelAvailability({
    backendId: instance.backend,
    catalogModelIds: loadedCatalog?.length
      ? loadedCatalog.map((model) => model.id)
      : sanitizeModelIdList([...currentEnabled, safeModelId]),
    disabledModelIds,
    currentDefaultModelId: instance.defaultModelId,
  })
  const siteDefault = props.form.inference.default
  const nextSiteDefault =
    siteDefault?.instanceId === instanceId &&
    !reconciled.enabledModelIds.includes(siteDefault.modelId)
      ? reconciled.defaultModelId
        ? { instanceId, modelId: reconciled.defaultModelId }
        : null
      : undefined

  try {
    await persist({
      inference: {
        ...(nextSiteDefault !== undefined ? { default: nextSiteDefault } : {}),
        providerInstances: {
          [instanceId]: {
            ...reconciled,
          },
        },
      },
    })
  } catch (error) {
    toast.error(formatAgentError(error, "Failed to update models"))
  }
}

async function syncCatalogModelsForBackend(
  backendId: InferenceBackendId,
  settings: AgentSettings = props.form,
): Promise<void> {
  const catalog = catalogs.loadedCatalogForBackend(backendId)
  if (!catalog?.length) return
  const providerInstances: Record<string, {
    enabledModelIds: string[]
    disabledModelIds: string[]
    defaultModelId?: string
  }> = {}
  let nextSiteDefault: AgentSettings["inference"]["default"] | null | undefined
  for (const instance of Object.values(settings.inference.providerInstances)) {
    if (instance.backend !== backendId) continue
    const reconciled = reconcileCatalogModelAvailability({
      backendId,
      catalogModelIds: catalog.map((model) => model.id),
      disabledModelIds: disabledIdsFor(instance),
      currentDefaultModelId: instance.defaultModelId,
    })
    if (
      sameModelIds(instance.enabledModelIds, reconciled.enabledModelIds) &&
      sameModelIds(
        disabledIdsFor(instance),
        reconciled.disabledModelIds,
      ) &&
      instance.defaultModelId === reconciled.defaultModelId
    ) {
      continue
    }
    providerInstances[instance.id] = reconciled
    if (
      settings.inference.default?.instanceId === instance.id &&
      !reconciled.enabledModelIds.includes(settings.inference.default.modelId)
    ) {
      nextSiteDefault = reconciled.defaultModelId
        ? { instanceId: instance.id, modelId: reconciled.defaultModelId }
        : null
    }
  }
  if (Object.keys(providerInstances).length === 0) return
  await persist({
    inference: {
      providerInstances,
      ...(nextSiteDefault !== undefined ? { default: nextSiteDefault } : {}),
    },
  })
}

async function refreshAndSyncBackend(
  backendId: InferenceBackendId,
  force: boolean,
  settings?: AgentSettings,
): Promise<void> {
  await catalogs.refreshCatalogForBackend(
    backendId,
    force,
    settings
      ? Object.values(settings.inference.providerInstances)
          .filter((instance) => instance.backend === backendId)
          .map((instance) => instance.id)
      : undefined,
  )
  await syncCatalogModelsForBackend(backendId, settings)
}

async function onCredentialsChanged(
  instanceId: string,
  state?: { configured: boolean },
): Promise<void> {
  const instance = getInstance(instanceId)
  if (!instance) return
  // Optimistic update so Save key immediately unlocks the model catalog and
  // does not flash "Not connected" while availability refreshes.
  if (state) {
    configuredInstances.value = {
      ...configuredInstances.value,
      [instanceId]: state.configured,
    }
    if (state.configured) {
      configuredBackends.value = {
        ...configuredBackends.value,
        [instance.backend]: true,
      }
    }
    configuredStatusReady.value = true
  }
  try {
    await refreshConfigured()
    await refreshAndSyncBackend(instance.backend, true)
    const { refreshAvailability } = useAriaAgent(() => props.projectPath)
    await refreshAvailability()
  } catch (error) {
    toast.error(formatAgentError(error, "Failed to refresh provider models"))
  }
}

async function onSaveBaseUrl(
  instanceId: string,
  baseUrl: string,
): Promise<void> {
  const instance = getInstance(instanceId)
  if (!instance || instance.backend !== "openai_compatible") return
  const trimmed = baseUrl.trim()
  try {
    await persist({
      inference: {
        providerInstances: {
          [instanceId]: {
            baseUrl: trimmed || undefined,
          },
        },
      },
    })
  } catch (error) {
    toast.error(formatAgentError(error, "Failed to save base URL"))
  }
}

async function onSetOpencodePlan(
  instanceId: string,
  plan: "zen" | "go",
): Promise<void> {
  const instance = getInstance(instanceId)
  if (!instance || instance.backend !== "opencode") return
  if (instance.opencodePlan === plan) return

  try {
    const next = await persist({
      inference: {
        providerInstances: {
          [instanceId]: { opencodePlan: plan },
        },
      },
    })
    await refreshAndSyncBackend("opencode", true, next)
  } catch (error) {
    toast.error(formatAgentError(error, "Failed to change OpenCode plan"))
  }
}

async function onExpandCard(instanceId: string): Promise<void> {
  const instance = getInstance(instanceId)
  if (!instance) return
  try {
    await refreshAndSyncBackend(instance.backend, false)
  } catch (error) {
    toast.error(formatAgentError(error, "Failed to refresh provider models"))
  }
}
</script>

<template>
  <section class="space-y-4 pt-4">
    <Teleport defer to="#settings-tab-actions">
      <Select
        v-if="canEdit"
        :model-value="selectedBackendId"
        :disabled="saving || !hasAvailableProviders"
        @update:model-value="onSelectBackend"
      >
        <SelectTrigger hide-icon>
          <SelectValue
            :placeholder="
              hasAvailableProviders ? '+ Add Provider' : 'All providers added'
            "
          />
        </SelectTrigger>
        <SelectContent side="left">
          <SelectItem
            v-for="backend in availableBackends"
            :key="backend.id"
            :value="backend.id"
          >
            {{ backend.label }}
          </SelectItem>
        </SelectContent>
      </Select>
    </Teleport>

    <div
      v-if="listedInstances.length === 0"
      class="rounded-md border border-dashed border-border/50 px-4 py-6 text-center text-sm text-muted-foreground"
    >
      Add an inference provider to get started.
    </div>

    <div v-else class="space-y-3">
      <InferenceProviderCard
        v-for="instance in listedInstances"
        :key="instance.id"
        :instance="instance"
        :form="form"
        :catalog-models="catalogs.catalogForBackend(instance.backend)"
        :catalog-loading="catalogs.catalogLoadingForBackend(instance.backend)"
        :catalog-error="catalogs.catalogErrorForBackend(instance.backend)"
        :needs-credentials="
          catalogs.needsCredentialsForCatalog(instance.backend)
        "
        :configured="isInstanceConfigured(instance.id)"
        :credential-storage="credentialStatuses[instance.backend]?.storage"
        :legacy-insecure="credentialStatuses[instance.backend]?.legacyInsecure"
        :credential-capability="credentialCapability"
        :can-edit="canEdit"
        :saving="saving"
        :expanded="instance.id === newInstanceId || undefined"
        @activate="onActivate(instance.id)"
        @deactivate="onDeactivate(instance.id)"
        @remove="onRemove(instance.id)"
        @expand="onExpandCard(instance.id)"
        @set-site-default="(modelId) => onSetSiteDefault(instance.id, modelId)"
        @toggle-model="
          (modelId, enabled) => onToggleModel(instance.id, modelId, enabled)
        "
        @credentials-changed="
          (state) => onCredentialsChanged(instance.id, state)
        "
        @save-base-url="(baseUrl) => onSaveBaseUrl(instance.id, baseUrl)"
        @set-opencode-plan="(plan) => onSetOpencodePlan(instance.id, plan)"
      />
    </div>
  </section>
</template>
