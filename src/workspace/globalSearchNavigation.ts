import { shallowRef } from "vue"
import type { CmsNav } from "@/workspace/studio/collections"

const pendingCmsNavigation = shallowRef<CmsNav | null>(null)
const pendingPageDetail = shallowRef<string | null>(null)

export function requestCmsNavigation(nav: CmsNav) {
  pendingCmsNavigation.value = nav
}

export function usePendingCmsNavigation() {
  return pendingCmsNavigation
}

export function clearPendingCmsNavigation(nav: CmsNav) {
  if (pendingCmsNavigation.value === nav) pendingCmsNavigation.value = null
}

export function requestPageDetailNavigation(file: string) {
  pendingPageDetail.value = file
}

export function usePendingPageDetailNavigation() {
  return pendingPageDetail
}

export function clearPendingPageDetailNavigation(file: string) {
  if (pendingPageDetail.value === file) pendingPageDetail.value = null
}
