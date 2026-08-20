<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { toast } from "vue-sonner"
import type {
  CollectionKind,
  CollectionScope,
  CollectionSupport,
} from "../../../../../shared/cms"
import {
  COLLECTION_SUPPORTS,
  CollectionRssSettingsSchema,
  CollectionCommentsSettingsSchema,
} from "../../../../../shared/cms"
import type { AriaCollectionDef } from "@/types/aria"
import { AppIcon } from "@/components/ui/app-icon"
import { IconPickerDialog, ProjectIconPreview } from "@/components/ui/icon-picker"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { getCollections, scanWorkspace, updateCollections } from "@/lib/workspace"
import { m } from "@/paraglide/messages.js"
import { useCollectionIcons } from "../composables/useCollectionIcons"
import { COLLECTION_KIND_OPTIONS } from "../lib/collectionKindOptions"
import { COLLECTION_SCOPE_OPTIONS } from "../lib/collectionScopeOptions"
import CollectionPublishingSection from "./CollectionPublishingSection.vue"

type CollectionRssDraft = {
  enabled: boolean
  title: string
  description: string
  itemLimit: number
}

type CollectionCommentsDraft = {
  enabled: boolean
}

const props = defineProps<{
  collection: AriaCollectionDef
  projectRoot: string
  embedded?: boolean
}>()

const emit = defineEmits<{
  updated: [collection: AriaCollectionDef]
  requestDelete: []
}>()

const { getCollectionIcon } = useCollectionIcons()

const label = ref(props.collection.label)
const iconName = ref(props.collection.icon ?? "")
const kind = ref<CollectionKind>(props.collection.kind)
const scope = ref<CollectionScope>(props.collection.scope ?? "global")
const urlPattern = ref(props.collection.urlPattern ?? "")
const listPageFile = ref(props.collection.listPageFile ?? "")
const templatePageFile = ref(props.collection.templatePageFile ?? "")
const supports = ref<CollectionSupport[]>([
  ...((props.collection.supports ?? []) as CollectionSupport[]),
])
const rss = ref<CollectionRssDraft>(createRssDraft(props.collection.rss))
const comments = ref<CollectionCommentsDraft>(
  createCommentsDraft(props.collection.comments),
)
const pageOptions = ref<Array<{ file: string; route: string }>>([])
const isSaving = ref(false)
const isIconPickerOpen = ref(false)
const errors = ref<Record<string, string>>({})

function createRssDraft(
  value: AriaCollectionDef["rss"] | undefined,
): CollectionRssDraft {
  const parsed = CollectionRssSettingsSchema.parse(value ?? {})
  return {
    enabled: parsed.enabled,
    title: parsed.title ?? "",
    description: parsed.description ?? "",
    itemLimit: parsed.itemLimit,
  }
}

function createCommentsDraft(
  value: AriaCollectionDef["comments"] | undefined,
): CollectionCommentsDraft {
  return CollectionCommentsSettingsSchema.parse(value ?? {})
}

function syncFromCollection(next: AriaCollectionDef) {
  label.value = next.label
  iconName.value = next.icon ?? ""
  kind.value = next.kind
  scope.value = next.scope ?? "global"
  urlPattern.value = next.urlPattern ?? ""
  listPageFile.value = next.listPageFile ?? ""
  templatePageFile.value = next.templatePageFile ?? ""
  supports.value = [...((next.supports ?? []) as CollectionSupport[])]
  rss.value = createRssDraft(next.rss)
  comments.value = createCommentsDraft(next.comments)
  errors.value = {}
}

watch(
  () => props.collection,
  (next) => {
    syncFromCollection(next)
  },
)

async function loadPages() {
  try {
    const scan = await scanWorkspace(props.projectRoot)
    pageOptions.value = (scan.pages ?? []).map((page) => ({
      file: page.file,
      route: page.route,
    }))
  } catch {
    pageOptions.value = []
  }
}

void loadPages()

const iconPreviewValue = computed(() =>
  getCollectionIcon(iconName.value || null),
)

const supportedDesktopCapabilities = new Set<CollectionSupport>([
  "body",
  "cover",
  "drafts",
  "revisions",
])

const supportOptions = computed(() =>
  COLLECTION_SUPPORTS.filter((value) =>
    supportedDesktopCapabilities.has(value),
  ).map((value) => ({
    value,
    checked: supports.value.includes(value),
    label: supportLabel(value),
  })),
)

const showRssSection = false
const showCommentsSection = false

function supportLabel(value: CollectionSupport): string {
  switch (value) {
    case "body":
      return m.cms_collections_support_body()
    case "cover":
      return m.cms_collections_support_cover()
    case "drafts":
      return m.cms_collections_support_drafts()
    case "revisions":
      return m.cms_collections_support_revisions()
    case "search":
      return m.cms_collections_support_search()
    case "seo":
      return m.cms_collections_support_seo()
    case "rss":
      return m.cms_collections_support_rss()
    case "comments":
      return m.cms_collections_support_comments()
    default:
      return value
  }
}

function kindLabel(value: CollectionKind): string {
  switch (value) {
    case "content":
      return m.cms_collections_kind_content()
    case "data":
      return m.cms_collections_kind_data()
    case "config":
      return m.cms_collections_kind_config()
    case "tags":
      return m.cms_collections_kind_tags()
    default:
      return value
  }
}

function kindDescription(value: CollectionKind): string {
  switch (value) {
    case "content":
      return m.cms_collections_kind_content_description()
    case "data":
      return m.cms_collections_kind_data_description()
    case "config":
      return m.cms_collections_kind_config_description()
    case "tags":
      return m.cms_collections_kind_tags_description()
    default:
      return ""
  }
}

function scopeLabel(value: CollectionScope): string {
  return value === "collection"
    ? m.cms_collections_scope_local()
    : m.cms_collections_scope_global()
}

function scopeDescription(value: CollectionScope): string {
  return value === "collection"
    ? m.cms_collections_scope_local_description()
    : m.cms_collections_scope_global_description()
}

function toggleSupport(value: CollectionSupport, checked: boolean | "indeterminate") {
  if (checked === true) {
    if (!supports.value.includes(value)) {
      supports.value = [...supports.value, value]
    }
    return
  }
  supports.value = supports.value.filter((item) => item !== value)
}

function validate(): boolean {
  errors.value = {}
  if (!label.value.trim()) {
    errors.value.label = m.cms_collections_settings_error_label_required()
  }
  const pattern = urlPattern.value.trim()
  if (pattern) {
    if (!pattern.startsWith("/")) {
      errors.value.urlPattern = m.cms_collections_settings_error_url_start()
    } else if ((pattern.match(/\{slug\}/g) ?? []).length !== 1) {
      errors.value.urlPattern = m.cms_collections_settings_error_url_slug({
        token: "{slug}",
      })
    }
  }
  return Object.keys(errors.value).length === 0
}

function buildRssPayload(): AriaCollectionDef["rss"] {
  const title = rss.value.title.trim()
  const description = rss.value.description.trim()
  const itemLimit = Number(rss.value.itemLimit)
  const payload: NonNullable<AriaCollectionDef["rss"]> = {
    enabled: rss.value.enabled,
  }
  if (title) payload.title = title.slice(0, 180)
  if (description) payload.description = description.slice(0, 1000)
  if (
    Number.isInteger(itemLimit) &&
    itemLimit >= 1 &&
    itemLimit <= 100
  ) {
    payload.itemLimit = itemLimit
  }
  return payload
}

async function saveSettings() {
  if (!validate() || isSaving.value) return
  isSaving.value = true
  try {
    const state = await getCollections(props.projectRoot)
    const next: AriaCollectionDef = {
      ...props.collection,
      label: label.value.trim(),
      kind: kind.value,
      scope: scope.value,
      icon: iconName.value.trim() || null,
      urlPattern: urlPattern.value.trim() || null,
      listPageFile: listPageFile.value.trim() || null,
      templatePageFile: templatePageFile.value.trim() || null,
      supports: [...supports.value],
      rss: buildRssPayload(),
      comments: { enabled: comments.value.enabled },
    }
    const collections = state.collections.map((item) =>
      item.id === next.id ? next : item,
    )
    await updateCollections(props.projectRoot, { collections })
    toast.success(m.cms_collections_settings_updated())
    emit("updated", next)
  } catch (err) {
    toast.error(
      err instanceof Error ? err.message : "Failed to save collection settings",
    )
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <section
    class="font-sans space-y-6"
    data-testid="collection-settings-panel"
  >
    <div v-if="!embedded" class="space-y-1">
      <h2 class="m-0 text-lg font-medium">
        {{ m.cms_collections_tab_settings() }}
      </h2>
    </div>

    <div class="grid gap-7">
      <section class="grid gap-8">
        <div class="grid gap-2">
          <Label
            for="collection-settings-label"
            class="text-sm! text-muted-foreground"
          >
            {{ m.cms_collections_settings_collection_name() }}
          </Label>
          <div class="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="icon"
              class="h-9 w-9 shrink-0 bg-card/40 p-2 transition-[background-color,border-color,color,transform] duration-100 active:scale-[0.96] motion-reduce:active:scale-100"
              :disabled="isSaving || !projectRoot"
              :aria-label="m.cms_collections_settings_choose_icon()"
              :title="m.cms_collections_settings_choose_icon()"
              @click="isIconPickerOpen = true"
            >
              <ProjectIconPreview
                :project-root="projectRoot"
                :value="iconPreviewValue"
                class="size-5"
              />
            </Button>
            <Input
              id="collection-settings-label"
              v-model="label"
              :disabled="isSaving"
              :aria-invalid="errors.label ? 'true' : undefined"
            />
          </div>
          <p v-if="errors.label" class="text-2xs text-destructive">
            {{ errors.label }}
          </p>
          <p class="text-2xs text-muted-foreground font-mono">
            {{ collection.name }}
          </p>
        </div>

        <div class="grid gap-2">
          <Label class="text-sm! text-muted-foreground">
            {{ m.cms_collections_settings_kind() }}
          </Label>
          <div class="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <button
              v-for="option in COLLECTION_KIND_OPTIONS"
              :key="option.value"
              type="button"
              :disabled="isSaving"
              :class="[
                'group flex min-h-20 w-full flex-col items-start justify-start rounded-md border border-dashed p-3 text-left transition-all duration-100 disabled:cursor-not-allowed disabled:opacity-60',
                kind === option.value
                  ? 'border-primary bg-input text-foreground shadow-xs dark:shadow-none'
                  : 'border-border border-solid bg-card/40 text-muted-foreground hover:border-primary/60 hover:bg-input/60 hover:text-foreground',
              ]"
              @click="kind = option.value"
            >
              <div class="flex w-full items-start gap-3">
                <AppIcon
                  :name="option.icon"
                  :size="16"
                  class="shrink-0"
                  :class="
                    kind === option.value
                      ? 'text-primary'
                      : 'text-muted-foreground/60 group-hover:text-primary/80'
                  "
                />
                <span class="min-w-0">
                  <span class="block text-sm font-medium">
                    {{ kindLabel(option.value) }}
                  </span>
                  <span
                    class="mt-1 block text-xs text-balance leading-snug text-muted-foreground"
                  >
                    {{ kindDescription(option.value) }}
                  </span>
                </span>
              </div>
            </button>
          </div>
        </div>
      </section>

      <CollectionPublishingSection
        :list-page-file="listPageFile"
        :template-page-file="templatePageFile"
        :url-pattern="urlPattern"
        :page-options="pageOptions"
        :url-pattern-error="errors.urlPattern"
        :collection-kind="kind"
        :disabled="isSaving"
        @update:list-page-file="listPageFile = $event"
        @update:template-page-file="templatePageFile = $event"
        @update:url-pattern="urlPattern = $event"
      />

      <section class="grid gap-7">
        <div class="grid gap-2">
          <Label class="text-sm! text-muted-foreground">
            {{ m.cms_collections_settings_scope() }}
          </Label>
          <div
            class="grid grid-cols-1 items-start gap-3 sm:grid-cols-2"
            role="radiogroup"
            :aria-label="m.cms_collections_settings_scope_aria()"
          >
            <button
              v-for="option in COLLECTION_SCOPE_OPTIONS"
              :key="option.value"
              type="button"
              role="radio"
              :aria-checked="scope === option.value"
              :disabled="isSaving"
              :class="[
                'group flex min-h-14 w-full flex-col items-start justify-start rounded-md border border-dashed p-3 text-left transition-all duration-100 disabled:cursor-not-allowed disabled:opacity-60',
                scope === option.value
                  ? 'border-primary bg-input text-foreground shadow-xs dark:shadow-none'
                  : 'border-border bg-card/40 text-muted-foreground hover:border-primary/60 hover:bg-input/60 hover:text-foreground',
              ]"
              @click="scope = option.value"
            >
              <div class="flex w-full items-start gap-3">
                <AppIcon
                  :name="option.icon"
                  :size="16"
                  class="shrink-0"
                  :class="
                    scope === option.value
                      ? 'text-primary'
                      : 'text-muted-foreground/60 group-hover:text-primary/80'
                  "
                />
                <span class="min-w-0">
                  <span class="block text-sm font-medium">
                    {{ scopeLabel(option.value) }}
                  </span>
                  <span
                    class="mt-1 block text-xs text-balance leading-snug text-muted-foreground"
                  >
                    {{ scopeDescription(option.value) }}
                  </span>
                </span>
              </div>
            </button>
          </div>
        </div>

        <div class="grid gap-3">
          <Label class="text-sm! text-muted-foreground">
            {{ m.cms_collections_settings_supports() }}
          </Label>
          <div class="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <label
              v-for="option in supportOptions"
              :key="option.value"
              class="flex cursor-pointer items-center gap-3 text-sm text-muted-foreground"
            >
              <Checkbox
                :checked="option.checked"
                :disabled="isSaving"
                @update:checked="toggleSupport(option.value, $event)"
              />
              {{ option.label }}
            </label>
          </div>
        </div>

        <div
          v-if="showRssSection"
          class="grid gap-3 rounded-lg border border-border p-4"
        >
          <div class="flex items-center justify-between gap-4">
            <div class="min-w-0">
              <Label>{{ m.cms_collections_settings_rss_enable() }}</Label>
              <p class="m-0 mt-1 text-xs text-muted-foreground">
                {{ m.cms_collections_settings_rss_enable_description() }}
              </p>
            </div>
            <Switch
              :model-value="rss.enabled"
              :disabled="isSaving"
              @update:model-value="rss.enabled = Boolean($event)"
            />
          </div>
          <div v-if="rss.enabled" class="grid gap-3 sm:grid-cols-2">
            <div class="grid gap-1.5">
              <Label for="collection-rss-title">
                {{ m.cms_collections_settings_rss_feed_title() }}
              </Label>
              <Input
                id="collection-rss-title"
                v-model="rss.title"
                :disabled="isSaving"
                maxlength="180"
              />
            </div>
            <div class="grid gap-1.5">
              <Label for="collection-rss-item-limit">
                {{ m.cms_collections_settings_rss_item_limit() }}
              </Label>
              <Input
                id="collection-rss-item-limit"
                v-model.number="rss.itemLimit"
                type="number"
                min="1"
                max="100"
                :disabled="isSaving"
              />
            </div>
            <div class="grid gap-1.5 sm:col-span-2">
              <Label for="collection-rss-description">
                {{ m.cms_collections_settings_rss_feed_description() }}
              </Label>
              <Input
                id="collection-rss-description"
                v-model="rss.description"
                :disabled="isSaving"
                maxlength="1000"
              />
            </div>
          </div>
        </div>

        <div
          v-if="showCommentsSection"
          class="grid gap-3 rounded-lg border border-border p-4"
        >
          <div class="flex items-center justify-between gap-4">
            <div class="min-w-0">
              <Label>{{ m.cms_collections_settings_comments_enable() }}</Label>
              <p class="m-0 mt-1 text-xs text-muted-foreground">
                {{ m.cms_collections_settings_comments_enable_description() }}
              </p>
            </div>
            <Switch
              :model-value="comments.enabled"
              :disabled="isSaving"
              @update:model-value="comments.enabled = Boolean($event)"
            />
          </div>
        </div>
      </section>
    </div>

    <div class="flex items-center gap-2">
      <Button size="md" :disabled="isSaving" @click="saveSettings">
        {{
          isSaving
            ? m.cms_entry_saving()
            : m.cms_collections_settings_save()
        }}
      </Button>
    </div>

    <IconPickerDialog
      v-model:open="isIconPickerOpen"
      :project-root="projectRoot"
      :value="iconName"
      :title="m.cms_collections_settings_choose_icon()"
      @select="iconName = $event"
    />

    <section
      class="grid gap-4 border-t border-border/60 pt-6"
      data-testid="delete-collection-section"
    >
      <div class="grid gap-2">
        <p class="m-0 text-sm font-medium text-foreground">
          {{ m.cms_collections_settings_delete_title() }}
        </p>
        <p class="m-0 text-xs text-muted-foreground">
          {{ m.cms_collections_settings_delete_description() }}
        </p>
      </div>
      <div>
        <Button
          variant="destructive"
          size="sm"
          class="h-9!"
          @click="emit('requestDelete')"
        >
          {{ m.cms_collections_settings_delete_title() }}
        </Button>
      </div>
    </section>
  </section>
</template>
