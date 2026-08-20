<script setup lang="ts">
import DOMPurify from "isomorphic-dompurify"
import { marked } from "marked"
import { computed } from "vue"
import { openExternalUrl } from "@/lib/project"

const props = defineProps<{
  content: string
}>()

marked.setOptions({
  gfm: true,
  breaks: true,
})

const sanitizedHtml = computed(() => {
  if (!props.content.trim()) return ""
  const html = marked.parse(props.content, { async: false }) as string
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
  })
})

function onClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target.closest("a[href]") : null
  if (!(target instanceof HTMLAnchorElement)) return
  let url: URL
  try {
    url = new URL(target.href)
  } catch {
    event.preventDefault()
    return
  }
  if (!(["http:", "https:"] as const).includes(url.protocol as "http:" | "https:")) {
    event.preventDefault()
    return
  }
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return
  }
  event.preventDefault()
  void openExternalUrl(url.toString())
}
</script>

<template>
  <div
    v-if="sanitizedHtml"
    class="agent-markdown prose dark:prose-invert max-w-none text-xs text-balance"
    v-html="sanitizedHtml"
    @click="onClick"
  />
</template>

<style scoped>
.agent-markdown :deep(p) {
  margin: 0.5em 0;
}
.agent-markdown :deep(p:first-child) {
  margin-top: 0;
}
.agent-markdown :deep(p:last-child) {
  margin-bottom: 0;
}
.agent-markdown :deep(ul),
.agent-markdown :deep(ol) {
  margin: 0.5em 0;
  padding-left: 1.25rem;
}
.agent-markdown :deep(code) {
  border-radius: 0.25rem;
  background: color-mix(in oklch, var(--muted) 70%, transparent);
  padding: 0.1em 0.3em;
  font-size: 0.9em;
}
.agent-markdown :deep(pre) {
  overflow-x: auto;
  border-radius: 0.375rem;
  background: color-mix(in oklch, var(--muted) 70%, transparent);
  padding: 0.75rem;
  margin: 0.5em 0;
}
.agent-markdown :deep(pre code) {
  background: transparent;
  padding: 0;
}
.agent-markdown :deep(a) {
  text-decoration: underline;
  text-underline-offset: 0.15em;
}
.agent-markdown :deep(a:focus-visible) {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
</style>
