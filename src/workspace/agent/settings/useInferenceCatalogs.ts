import { computed, reactive, type Ref } from "vue"
import {
  getInferenceBackendDefinition,
  type AgentSettings,
  type CatalogModel,
  type InferenceBackendId,
} from "../../../../shared/agent"
import {
  getAgentAvailability,
  listCatalogModels,
} from "@/lib/agent"

function uniqueById(models: CatalogModel[]): CatalogModel[] {
  const seen = new Set<string>()
  const out: CatalogModel[] = []
  for (const model of models) {
    if (seen.has(model.id)) continue
    seen.add(model.id)
    out.push(model)
  }
  return out
}

function fallbackCatalogModels(
  backendId: InferenceBackendId,
  settings: AgentSettings,
): CatalogModel[] {
  const definition = getInferenceBackendDefinition(backendId)
  const ids = new Set<string>([...definition.seedModelIds])
  for (const instance of Object.values(settings.inference.providerInstances)) {
    if (instance.backend !== backendId) continue
    for (const id of instance.enabledModelIds) ids.add(id)
    if (instance.defaultModelId) ids.add(instance.defaultModelId)
  }
  return Array.from(ids)
    .filter(Boolean)
    .map((id) => ({ id, name: id }))
}

export function useInferenceCatalogs(input: {
  projectPath: Ref<string>
  form: Ref<AgentSettings | null>
  configuredBackends: Ref<Partial<Record<InferenceBackendId, boolean>>>
}) {
  const catalogs = reactive<Partial<Record<InferenceBackendId, CatalogModel[]>>>(
    {},
  )
  const loading = reactive<Partial<Record<InferenceBackendId, boolean>>>({})
  const errors = reactive<Partial<Record<InferenceBackendId, string | null>>>({})

  function isConfigured(backendId: InferenceBackendId): boolean {
    return input.configuredBackends.value[backendId] === true
  }

  function needsCredentialsForCatalog(backendId: InferenceBackendId): boolean {
    return !isConfigured(backendId)
  }

  function catalogForBackend(backendId: InferenceBackendId): CatalogModel[] {
    const live = catalogs[backendId]
    if (live && live.length > 0) return live
    if (!input.form.value) return []
    return fallbackCatalogModels(backendId, input.form.value)
  }

  function loadedCatalogForBackend(
    backendId: InferenceBackendId,
  ): CatalogModel[] | null {
    return catalogs[backendId] ?? null
  }

  function catalogLoadingForBackend(backendId: InferenceBackendId): boolean {
    return loading[backendId] === true
  }

  function catalogErrorForBackend(
    backendId: InferenceBackendId,
  ): string | null {
    return errors[backendId] ?? null
  }

  async function refreshCatalogForBackend(
    backendId: InferenceBackendId,
    force = false,
    providerInstanceIds?: readonly string[],
  ): Promise<void> {
    if (!isConfigured(backendId)) {
      catalogs[backendId] = []
      errors[backendId] = null
      return
    }
    if (!force && catalogs[backendId]?.length) return
    if (loading[backendId]) return

    loading[backendId] = true
    errors[backendId] = null
    try {
      const instanceIds =
        providerInstanceIds ??
        Object.values(
          input.form.value?.inference.providerInstances ?? {},
        )
          .filter((item) => item.backend === backendId)
          .map((item) => item.id)
      const responses = await Promise.all(
        instanceIds.map((instanceId) =>
          listCatalogModels(input.projectPath.value, instanceId),
        ),
      )
      catalogs[backendId] = uniqueById(
        responses.flatMap((response) => response.models),
      )
    } catch (error) {
      errors[backendId] =
        error instanceof Error ? error.message : "Failed to load models"
      if (!catalogs[backendId]?.length && input.form.value) {
        catalogs[backendId] = fallbackCatalogModels(
          backendId,
          input.form.value,
        )
      }
    } finally {
      loading[backendId] = false
    }
  }

  async function refreshListedCatalogs(force = false): Promise<void> {
    if (!input.form.value) return
    const backends = new Set(
      Object.values(input.form.value.inference.providerInstances).map(
        (instance) => instance.backend,
      ),
    )
    await Promise.all(
      Array.from(backends).map((backendId) =>
        refreshCatalogForBackend(backendId, force),
      ),
    )
  }

  async function refreshConfiguredFromAvailability(): Promise<void> {
    const availability = await getAgentAvailability(input.projectPath.value)
    const next: Partial<Record<InferenceBackendId, boolean>> = {
      ...input.configuredBackends.value,
    }
    for (const [backend, configured] of Object.entries(
      availability.configuredBackends,
    )) {
      next[backend as InferenceBackendId] = configured
    }
    input.configuredBackends.value = next
  }

  const listedBackendIds = computed(() => {
    if (!input.form.value) return new Set<InferenceBackendId>()
    return new Set(
      Object.values(input.form.value.inference.providerInstances).map(
        (instance) => instance.backend,
      ),
    )
  })

  return {
    catalogForBackend,
    loadedCatalogForBackend,
    catalogLoadingForBackend,
    catalogErrorForBackend,
    needsCredentialsForCatalog,
    refreshCatalogForBackend,
    refreshListedCatalogs,
    refreshConfiguredFromAvailability,
    listedBackendIds,
  }
}
