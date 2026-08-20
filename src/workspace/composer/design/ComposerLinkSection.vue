<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { MediaAsset } from "@/lib/media"
import MediaPickerDialog from "@/workspace/studio/media/components/MediaPickerDialog.vue"
import {
  resolveElementInspectorTarget,
  isBooleanChecked,
  setElementLinkAtPath,
  stringFieldDisplay,
  type ElementLinkValue,
} from "../../../../shared/composer"
import type { ElementNode, PropValue } from "../../../../shared/composer/types"
import { tryUseInspectorContext } from "../inspector/useInspectorContext"
import InspectorPropertySection from "./InspectorPropertySection.vue"

type LinkMode = "none" | "page" | "url" | "media" | "anchor" | "email" | "phone" | "collection"
const props = defineProps<{ openSection?: string | null; disabled?: boolean }>()
const emit = defineEmits<{ "update:openSection": [value: string | null] }>()
const inspector = tryUseInspectorContext()
const pickerOpen = ref(false)
const error = ref("")

const context = computed(() => {
  const model = inspector?.document.model.value
  const path = inspector?.selectedPath.value
  return model && path ? resolveElementInspectorTarget(model, path) : null
})
const linkNode = computed<ElementNode | null>(() => context.value?.linkNode ?? (
  context.value?.primaryNode.kind === "element" && context.value.primaryNode.name.toLowerCase() === "button"
    ? context.value.primaryNode
    : null
))
const hrefProp = computed(() => linkNode.value?.props.href)
const href = computed(() => stringFieldDisplay(hrefProp.value).text)
const linkOwnedProps = ["href", "target", "rel", "title", "download"] as const
const dynamic = computed(() => linkOwnedProps.some((name) => {
  const value = linkNode.value?.props[name]
  return Boolean(value && value.type !== "string" && !(name === "download" && value.type === "bare"))
}))
const hasChanges = computed(() => Boolean(linkNode.value && (
  hrefProp.value
  || linkNode.value.props.target
  || linkNode.value.props.rel
  || linkNode.value.props.title
  || linkNode.value.props.download
)))
const hasEmptyWrapper = computed(() => Boolean(context.value?.emptyLinkWrapperPath))
const pages = computed(() => inspector?.pages.value ?? [])
const anchors = computed(() => {
  const model = inspector?.document.model.value
  if (!model) return []
  const found: Array<{ id: string; label: string }> = []
  const walk = (nodes: typeof model.nodes) => {
    for (const node of nodes) {
      if (node.kind === "element") {
        const id = stringFieldDisplay(node.props.id).text.trim()
        if (id) found.push({ id, label: id })
        if (Array.isArray(node.children)) walk(node.children)
      } else if (node.kind === "conditional") {
        walk(node.consequent); walk(node.alternate ?? [])
      } else if ("children" in node && Array.isArray(node.children)) walk(node.children)
    }
  }
  walk(model.nodes)
  return found
})

function inferMode(value: string, prop: PropValue | undefined): LinkMode {
  if (prop && prop.type !== "string") return "collection"
  // An authored empty href is a URL in progress, not "no link". Selecting URL
  // type wraps immediately; snapping back to None would collapse the fields.
  if (!value) return prop ? "url" : "none"
  if (value.startsWith("#")) return "anchor"
  if (value.startsWith("mailto:")) return "email"
  if (value.startsWith("tel:")) return "phone"
  if (pages.value.some((page) => page.route === value)) return "page"
  if (/\.(pdf|zip|docx?|xlsx?|png|jpe?g|webp|svg|mp4|webm)(?:[?#].*)?$/i.test(value) || value.startsWith("/uploads/")) return "media"
  return "url"
}

const mode = ref<LinkMode>("none")
const destination = ref("")
const emailSubject = ref("")
const targetBlank = ref(false)
const nofollow = ref(false)
const noreferrer = ref(false)
const noopener = ref(false)
const title = ref("")
const download = ref(false)
const scope = ref<"row" | "text">("text")

watch([hrefProp, linkNode], () => {
  const node = linkNode.value
  const value = href.value
  const inferred = inferMode(value, hrefProp.value)
  // Keep the type the user just chose while the destination is still empty.
  // Wrapping writes href="", which would otherwise infer as a generic URL.
  if (value || inferred !== "url" || mode.value === "none") {
    mode.value = inferred
  }
  destination.value = value.replace(/^mailto:|^tel:|^#/, "").split("?subject=")[0] ?? ""
  emailSubject.value = value.includes("?subject=") ? decodeURIComponent(value.split("?subject=")[1] ?? "") : ""
  targetBlank.value = stringFieldDisplay(node?.props.target).text === "_blank"
  const rel = new Set(stringFieldDisplay(node?.props.rel).text.split(/\s+/).filter(Boolean))
  nofollow.value = rel.has("nofollow"); noreferrer.value = rel.has("noreferrer"); noopener.value = rel.has("noopener")
  title.value = stringFieldDisplay(node?.props.title).text
  download.value = isBooleanChecked(node?.props.download, false)
}, { immediate: true })

function str(value: string): PropValue | undefined {
  return value ? { type: "string", value } : undefined
}

function serializedHref(): string {
  if (mode.value === "none" || mode.value === "collection") return ""
  if (mode.value === "anchor") return destination.value ? `#${destination.value.replace(/^#/, "")}` : "#"
  if (mode.value === "email") return `mailto:${destination.value}${emailSubject.value ? `?subject=${encodeURIComponent(emailSubject.value)}` : ""}`
  if (mode.value === "phone") return `tel:${destination.value}`
  return destination.value
}

function commit() {
  const path = inspector?.selectedPath.value
  if (!path || props.disabled || dynamic.value) return
  error.value = ""
  const hrefValue = serializedHref()
  const relTokens = [noopener.value || (targetBlank.value && /^https?:\/\//i.test(hrefValue)) ? "noopener" : "", noreferrer.value ? "noreferrer" : "", nofollow.value ? "nofollow" : ""].filter(Boolean)
  const value: ElementLinkValue | null = mode.value === "none" ? null : {
    href: { type: "string", value: hrefValue },
    target: str(targetBlank.value ? "_blank" : "_self"),
    rel: str(relTokens.join(" ")),
    title: str(title.value),
    download: download.value ? { type: "bare" } : undefined,
  }
  const mutationPath = context.value?.listItemPath && !context.value.linkNode ? context.value.listItemPath : path
  const ok = inspector.document.commitInspectorMutation("Edit link", (model) => {
    const current = resolveElementInspectorTarget(model, path)
    const target = current?.linkNode ?? (current?.primaryNode.kind === "element" && current.primaryNode.name.toLowerCase() === "button" ? current.primaryNode : null)
    if (target && linkOwnedProps.some((name) => {
      const prop = target.props[name]
      return Boolean(prop && prop.type !== "string" && !(name === "download" && prop.type === "bare"))
    })) return { ok: false, selectPath: path, reason: "Link attributes are expression-bound" }
    return setElementLinkAtPath(model, mutationPath, value, { scope: scope.value })
  }, { immediate: true, coalesceKey: null })
  if (!ok) error.value = "This link change is not valid for the selected element."
}

function changeMode(value: unknown) {
  mode.value = String(value) as LinkMode
  if (mode.value === "page") destination.value = pages.value[0]?.route ?? "/"
  else if (mode.value === "anchor") destination.value = anchors.value[0]?.id ?? ""
  else if (mode.value === "collection") return
  else if (mode.value !== "none") destination.value = ""
  commit()
}

function selectMedia(asset: MediaAsset) { destination.value = asset.url; mode.value = "media"; commit() }
function resetLink() {
  const path = inspector?.selectedPath.value
  if (!path || props.disabled || dynamic.value) return
  error.value = ""
  const ok = inspector.document.commitInspectorMutation("Reset link", (model) => setElementLinkAtPath(model, path, null), { immediate: true, coalesceKey: null })
  if (!ok) error.value = "This link could not be reset safely."
}

function removeEmptyWrapper() {
  const path = context.value?.emptyLinkWrapperPath
  if (!path || props.disabled) return
  error.value = ""
  const ok = inspector?.document.commitInspectorMutation(
    "Remove empty link wrapper",
    (model) => setElementLinkAtPath(model, path, null),
    { immediate: true, coalesceKey: null },
  )
  if (!ok) error.value = "This empty link wrapper could not be removed safely."
}
</script>

<template>
  <InspectorPropertySection
    v-if="context?.sections.includes('link')"
    title="Link"
    :open="openSection === 'link'"
    :has-changes="hasChanges"
    :show-reset="openSection === 'link' && hasChanges"
    :reset-disabled="disabled || dynamic"
    reset-label="Reset Link"
    @update:open="emit('update:openSection', $event ? 'link' : openSection === 'link' ? null : openSection ?? null)"
    @reset="resetLink"
  >
    <div class="space-y-3">
      <div v-if="hasEmptyWrapper" class="space-y-2 rounded-md border border-dashed border-border/70 p-2">
        <p class="text-[10px] leading-relaxed text-muted-foreground">This element is inside an empty anchor left by an earlier link removal.</p>
        <Button type="button" size="sm" variant="outline" class="h-8 w-full" :disabled="disabled" @click="removeEmptyWrapper">Remove empty link wrapper</Button>
      </div>
      <label class="grid grid-cols-[68px_1fr] items-center gap-2">
        <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Type</span>
        <Select :model-value="mode" :disabled="disabled || dynamic" @update:model-value="changeMode">
          <SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="item in ['none','page','url','media','anchor','email','phone','collection']" :key="item" :value="item">{{ item[0]?.toUpperCase() + item.slice(1) }}</SelectItem>
          </SelectContent>
        </Select>
      </label>

      <p v-if="dynamic || mode === 'collection'" class="rounded-md border border-dashed border-border/70 px-2 py-2 text-[10px] text-muted-foreground">
        {{ dynamic ? 'One or more link attributes are expression-bound. Use Props → CMS to detach or replace them.' : 'Bind the href field from Props → CMS.' }}
      </p>
      <label v-else-if="mode === 'page'" class="grid grid-cols-[68px_1fr] items-center gap-2">
        <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Page</span>
        <Select v-model="destination" :disabled="disabled || dynamic" @update:model-value="commit">
          <SelectTrigger class="h-8 text-xs"><SelectValue placeholder="Choose page" /></SelectTrigger>
          <SelectContent><SelectItem v-for="page in pages" :key="page.file" :value="page.route">{{ page.title || page.route }}</SelectItem></SelectContent>
        </Select>
      </label>
      <label v-else-if="mode === 'anchor'" class="grid grid-cols-[68px_1fr] items-center gap-2">
        <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Anchor</span>
        <Select v-model="destination" :disabled="disabled || dynamic" @update:model-value="commit">
          <SelectTrigger class="h-8 text-xs"><SelectValue placeholder="Choose anchor" /></SelectTrigger>
          <SelectContent><SelectItem v-for="anchor in anchors" :key="anchor.id" :value="anchor.id">#{{ anchor.label }}</SelectItem></SelectContent>
        </Select>
      </label>
      <div v-else-if="mode === 'media'" class="grid grid-cols-[68px_1fr] items-center gap-2">
        <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Media</span>
        <div class="flex gap-1"><Input v-model="destination" class="h-8 min-w-0 text-xs" :disabled="disabled || dynamic" @change="commit" /><Button type="button" size="sm" variant="outline" class="h-8" :disabled="disabled || dynamic" @click="pickerOpen = true">Choose</Button></div>
      </div>
      <template v-else-if="mode !== 'none'">
        <label class="grid grid-cols-[68px_1fr] items-center gap-2">
          <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{{ mode === 'email' ? 'Email' : mode === 'phone' ? 'Phone' : 'URL' }}</span>
          <Input v-model="destination" class="h-8 text-xs" :type="mode === 'email' ? 'email' : mode === 'phone' ? 'tel' : 'url'" :disabled="disabled || dynamic" @change="commit" />
        </label>
        <label v-if="mode === 'email'" class="grid grid-cols-[68px_1fr] items-center gap-2"><span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Subject</span><Input v-model="emailSubject" class="h-8 text-xs" :disabled="disabled || dynamic" @change="commit" /></label>
      </template>

      <template v-if="mode !== 'none' && mode !== 'collection'">
        <label v-if="context?.listItemPath" class="grid grid-cols-[68px_1fr] items-center gap-2"><span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Scope</span><Select v-model="scope" :disabled="disabled || dynamic || Boolean(context.linkNode)" @update:model-value="commit"><SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="text">Text</SelectItem><SelectItem value="row">Row</SelectItem></SelectContent></Select></label>
        <label class="grid grid-cols-[68px_1fr] items-center gap-2"><span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Title</span><Input v-model="title" class="h-8 text-xs" :disabled="disabled || dynamic" @change="commit" /></label>
        <div class="grid grid-cols-2 gap-x-3 gap-y-2">
          <Label class="flex items-center justify-between gap-2 text-[11px] font-normal">New tab <Switch v-model="targetBlank" :disabled="disabled || dynamic" @update:model-value="commit" /></Label>
          <Label class="flex items-center justify-between gap-2 text-[11px] font-normal">Download <Switch v-model="download" :disabled="disabled || dynamic" @update:model-value="commit" /></Label>
          <Label class="flex items-center justify-between gap-2 text-[11px] font-normal">No opener <Switch v-model="noopener" :disabled="disabled || dynamic" @update:model-value="commit" /></Label>
          <Label class="flex items-center justify-between gap-2 text-[11px] font-normal">No referrer <Switch v-model="noreferrer" :disabled="disabled || dynamic" @update:model-value="commit" /></Label>
          <Label class="flex items-center justify-between gap-2 text-[11px] font-normal">No follow <Switch v-model="nofollow" :disabled="disabled || dynamic" @update:model-value="commit" /></Label>
        </div>
      </template>
      <p v-if="error" role="alert" class="text-[10px] text-destructive">{{ error }}</p>
    </div>
    <MediaPickerDialog v-model:open="pickerOpen" :project-root="inspector?.projectPath.value ?? ''" @select="selectMedia" />
  </InspectorPropertySection>
</template>
