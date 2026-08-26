<script setup lang="ts">
import { computed, ref, useId, watch } from "vue"
import { toast } from "vue-sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AppIcon } from "@/components/ui/app-icon"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { HeaderActionTooltip } from "@/workspace/studio/core"
import {
  getInferenceBackendDefinition,
  isCredentialBackend,
  type CredentialBackendId,
  type CredentialStorageCapability,
  type CredentialStorageKind,
  type InferenceBackendId,
} from "../../../../shared/agent"
import {
  clearProviderCredentials,
  confirmInsecureProviderCredentials,
  setProviderCredentials,
} from "@/lib/agent"
import { openExternalUrl } from "@/lib/project"

const props = defineProps<{
  instanceId: string
  backendId: InferenceBackendId
  /** true = Saved, false = Not connected, undefined = still checking */
  configured?: boolean
  storage?: CredentialStorageKind
  legacyInsecure?: boolean
  capability?: CredentialStorageCapability | null
  canEdit?: boolean
  disabled?: boolean
  baseUrl?: string
}>()

const emit = defineEmits<{
  saveBaseUrl: [baseUrl: string]
  credentialsChanged: [state: { configured: boolean }]
}>()

const apiKey = ref("")
const isSaving = ref(false)
const isRemoving = ref(false)
const isConfirmingRemoveKey = ref(false)
const isEditingKey = ref(props.configured === false)
const apiKeyError = ref<string | null>(null)
const baseUrlError = ref<string | null>(null)
const saveError = ref<string | null>(null)
const insecureConfirmation = ref<"save" | "legacy" | null>(null)

const credentialBackend = computed(() => isCredentialBackend(props.backendId))
const isCompatible = computed(() => props.backendId === "openai_compatible")
const definition = computed(() =>
  getInferenceBackendDefinition(props.backendId),
)
const credentialStatusLabel = computed(() => {
  if (props.configured === undefined) return "Checking…"
  if (props.legacyInsecure) return "Saved without confirmed OS protection"
  if (!props.configured) return "Not connected"
  if (props.storage === "session") return "Available for this session"
  if (props.storage === "insecure") return "Saved without OS protection"
  return "Saved in the OS keychain"
})
const isKeySaved = computed(() => props.configured === true)

const apiKeyId = useId()
const baseUrlId = useId()
const apiKeyErrorId = useId()
const baseUrlErrorId = useId()
const saveErrorId = useId()

const showGetKeyHint = computed(() => {
  if (isKeySaved.value || apiKey.value.trim()) return false
  return Boolean(definition.value.keyUrl)
})

const getKeyHref = computed(() => definition.value.keyUrl ?? null)

const getKeyLabel = computed(() => {
  if (!definition.value.keyUrl) return null
  try {
    const url = new URL(definition.value.keyUrl)
    return url.hostname + url.pathname.replace(/\/$/, "")
  } catch {
    return definition.value.keyUrl
  }
})

function validateApiKey() {
  const value = apiKey.value
  const trimmed = value.trim()
  if (!trimmed) {
    apiKeyError.value = "API key is required"
    return
  }
  if (trimmed.length < 8) {
    apiKeyError.value = "API key looks too short"
    return
  }
  if (/\s/.test(value)) {
    apiKeyError.value = "Remove spaces from the API key"
    return
  }
  if (props.backendId === "opencode" && !trimmed.startsWith("sk-")) {
    apiKeyError.value = "OpenCode API keys start with sk-"
    return
  }
  apiKeyError.value = null
}

function onApiKeyPaste(event: ClipboardEvent) {
  const pasted = event.clipboardData?.getData("text")
  if (pasted === undefined) return

  const input = event.currentTarget
  if (!(input instanceof HTMLInputElement)) return

  // Provider dashboards sometimes copy a visually wrapped key with spaces,
  // tabs, or line breaks. API keys are compact tokens, so discard that
  // formatting while preserving the current selection and caret position.
  const normalized = pasted.replace(/\s+/g, "")
  const selectionStart = input.selectionStart ?? input.value.length
  const selectionEnd = input.selectionEnd ?? selectionStart

  event.preventDefault()
  input.setRangeText(normalized, selectionStart, selectionEnd, "end")
  apiKey.value = input.value
}

function validateBaseUrl() {
  const url = props.baseUrl?.trim()
  if (!url) {
    baseUrlError.value = "Base URL is required"
    return
  }
  try {
    const parsed = new URL(url)
    if (!parsed.protocol.startsWith("http")) {
      baseUrlError.value = "Base URL must use http or https"
      return
    }
    baseUrlError.value = null
  } catch {
    baseUrlError.value = "Enter a valid URL"
  }
}

watch(apiKey, () => {
  if (apiKeyError.value) apiKeyError.value = null
})
watch(
  () => props.configured,
  (configured) => {
    // Only flip into the editor when we know the key is missing. While status
    // is still loading, keep the compact row so remounts don't flash "Not connected".
    if (configured === undefined) return
    isEditingKey.value = !configured
    isConfirmingRemoveKey.value = false
  },
)
watch(
  () => props.baseUrl,
  () => {
    if (baseUrlError.value) baseUrlError.value = null
  },
)

async function persistKey(
  persistence: "session" | "persistent",
  allowInsecure = false,
) {
  if (!isCredentialBackend(props.backendId)) return
  isSaving.value = true
  try {
    const result = await setProviderCredentials({
      provider: props.backendId as CredentialBackendId,
      instanceId: props.instanceId,
      apiKey: apiKey.value.trim(),
      baseUrl: isCompatible.value ? props.baseUrl?.trim() : undefined,
      persistence,
      insecurePersistenceConfirmation: allowInsecure
        ? "PERSIST_INSECURELY"
        : undefined,
    })
    apiKey.value = ""
    isEditingKey.value = false
    insecureConfirmation.value = null
    toast.success(
      result.storage === "session"
        ? "API key available for this session"
        : result.storage === "insecure"
          ? "API key saved without OS protection"
          : "API key saved in the OS keychain",
    )
    emit("credentialsChanged", { configured: true })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to save API key"
    saveError.value = message
    toast.error(message)
  } finally {
    isSaving.value = false
  }
}

async function saveKey() {
  validateApiKey()
  if (apiKeyError.value) return
  if (!isCredentialBackend(props.backendId)) return
  if (isCompatible.value) {
    validateBaseUrl()
    if (baseUrlError.value) return
  }

  saveError.value = null
  if (props.capability?.persistent && !props.capability.secure) {
    insecureConfirmation.value = "save"
    return
  }
  await persistKey(props.capability?.secure ? "persistent" : "session")
}

async function confirmLegacyKey() {
  if (!isCredentialBackend(props.backendId)) return
  isSaving.value = true
  try {
    await confirmInsecureProviderCredentials(
      props.backendId as CredentialBackendId,
      props.instanceId,
    )
    insecureConfirmation.value = null
    toast.success("Saved API key enabled without OS protection")
    emit("credentialsChanged", { configured: true })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to enable saved API key"
    saveError.value = message
    toast.error(message)
  } finally {
    isSaving.value = false
  }
}

async function removeKey() {
  if (!isCredentialBackend(props.backendId)) return
  isRemoving.value = true
  try {
    await clearProviderCredentials(
      props.backendId as CredentialBackendId,
      props.instanceId,
    )
    apiKey.value = ""
    isEditingKey.value = true
    toast.success("API key removed")
    emit("credentialsChanged", { configured: false })
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Failed to remove API key",
    )
  } finally {
    isRemoving.value = false
  }
}

function confirmRemoveKey() {
  isConfirmingRemoveKey.value = false
  void removeKey()
}

function editKey() {
  isConfirmingRemoveKey.value = false
  isEditingKey.value = true
}

function cancelEditKey() {
  apiKey.value = ""
  apiKeyError.value = null
  saveError.value = null
  isEditingKey.value = false
}
</script>

<template>
  <div v-if="credentialBackend" class="space-y-3">
    <div class="flex min-h-11 flex-wrap items-center gap-3">
      <span
        class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <AppIcon name="key" :size="16" />
      </span>
      <div class="min-w-0 flex-1">
        <h4 class="m-0 text-sm font-medium">API key</h4>
        <p class="text-xs text-muted-foreground">
          {{ credentialStatusLabel }}
        </p>
      </div>

      <div v-if="canEdit && isKeySaved && !isEditingKey" class="flex items-center gap-1.5">
        <template v-if="isConfirmingRemoveKey">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            :disabled="disabled || isRemoving"
            @click="isConfirmingRemoveKey = false"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            :disabled="disabled || isRemoving"
            @click="confirmRemoveKey"
          >
            Remove key
          </Button>
        </template>
        <template v-else>
          <Button
            type="button"
            variant="outline"
            size="sm"
            :disabled="disabled"
            @click="editKey"
          >
            Change
          </Button>
          <HeaderActionTooltip label="Remove key" side="top">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              :disabled="disabled || isRemoving"
              @click="isConfirmingRemoveKey = true"
            >
              <AppIcon name="trash" class="size-3.5" />
              <span class="sr-only">Remove key</span>
            </Button>
          </HeaderActionTooltip>
        </template>
      </div>
    </div>

    <div
      v-if="legacyInsecure"
      class="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs"
      role="status"
    >
      <p class="font-medium">This saved key is not protected by an OS keychain.</p>
      <p class="mt-1 text-muted-foreground">
        Aria will not use it until you explicitly accept insecure storage or replace it.
      </p>
      <Button
        v-if="canEdit"
        type="button"
        variant="outline"
        size="sm"
        class="mt-3"
        :disabled="disabled || isSaving"
        @click="insecureConfirmation = 'legacy'"
      >
        Review saved key
      </Button>
    </div>

    <p
      v-else-if="storage === 'insecure'"
      class="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs"
      role="status"
    >
      This key is persisted without OS keychain protection.
    </p>

    <div v-if="isCompatible" class="space-y-1">
      <label :for="baseUrlId" class="text-xs font-medium">Base URL</label>
      <Input
        :id="baseUrlId"
        :model-value="baseUrl ?? ''"
        placeholder="https://api.example.com/v1"
        :class="['h-9 text-xs', baseUrlError ? 'border-destructive' : '']"
        :aria-invalid="baseUrlError ? 'true' : undefined"
        :aria-describedby="baseUrlError ? baseUrlErrorId : undefined"
        :disabled="!canEdit || disabled"
        @blur="validateBaseUrl"
        @update:model-value="emit('saveBaseUrl', String($event))"
      />
      <p v-if="baseUrlError" :id="baseUrlErrorId" class="text-xs text-destructive">
        {{ baseUrlError }}
      </p>
    </div>

    <div v-if="canEdit && (!isKeySaved || isEditingKey) && configured !== undefined" class="space-y-2">
      <label :for="apiKeyId" class="sr-only">API key</label>
      <div class="flex flex-wrap items-start gap-2">
        <div class="min-w-56 flex-1 space-y-1">
          <Input
            :id="apiKeyId"
            v-model="apiKey"
            type="password"
            name="aria-inference-api-key"
            autocomplete="new-password"
            placeholder="Paste API key"
            :class="[
              'h-9 w-full text-xs',
              apiKeyError ? 'border-destructive' : '',
            ]"
            :aria-invalid="apiKeyError ? 'true' : undefined"
            :aria-describedby="
              [apiKeyError ? apiKeyErrorId : null, saveError ? saveErrorId : null]
                .filter(Boolean)
                .join(' ') || undefined
            "
            :disabled="disabled || isSaving || isRemoving"
            @paste="onApiKeyPaste"
            @blur="validateApiKey"
          />
          <p v-if="apiKeyError" :id="apiKeyErrorId" class="text-xs text-destructive">
            {{ apiKeyError }}
          </p>
        </div>
        <Button
          type="button"
          size="md"
          :disabled="disabled || isSaving || isRemoving || !apiKey.trim()"
          @click="saveKey"
        >
          Save key
        </Button>
        <Button
          v-if="isKeySaved"
          type="button"
          variant="ghost"
          size="md"
          :disabled="disabled || isSaving"
          @click="cancelEditKey"
        >
          Cancel
        </Button>
      </div>
      <p v-if="saveError" :id="saveErrorId" class="text-xs text-destructive" role="alert">{{ saveError }}</p>
      <p
        v-if="showGetKeyHint && getKeyHref && getKeyLabel"
        class="text-xs text-muted-foreground"
      >
        <button
          type="button"
          class="rounded-sm underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @click="void openExternalUrl(getKeyHref)"
        >
          Get API key
        </button>
      </p>
    </div>
  </div>

  <AlertDialog
    :open="insecureConfirmation !== null"
    @update:open="(open) => { if (!open) insecureConfirmation = null }"
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>OS keychain protection is unavailable</AlertDialogTitle>
        <AlertDialogDescription>
          Linux is using Electron’s basic text storage. A persisted API key is
          obfuscated, but it is not protected by your operating system. Anyone
          who can read your account files may be able to recover it.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <Button
          type="button"
          variant="outline"
          :disabled="isSaving"
          @click="insecureConfirmation = null"
        >
          Cancel
        </Button>
        <Button
          v-if="insecureConfirmation === 'save'"
          type="button"
          variant="secondary"
          :disabled="isSaving"
          @click="void persistKey('session')"
        >
          Use for this session
        </Button>
        <Button
          type="button"
          variant="destructive"
          :disabled="isSaving"
          @click="
            insecureConfirmation === 'legacy'
              ? void confirmLegacyKey()
              : void persistKey('persistent', true)
          "
        >
          {{ insecureConfirmation === "legacy" ? "Use saved key insecurely" : "Persist insecurely" }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
