import { computed, ref, watch, type Ref } from "vue"
import {
  DESIGN_SECTION_STORAGE_KEY,
  isDesignSection,
  type DesignSectionId,
} from "../types"

const DEFAULT_SECTION: DesignSectionId = "colors"

function readStoredSection(): DesignSectionId {
  try {
    const stored = localStorage.getItem(DESIGN_SECTION_STORAGE_KEY)
    if (isDesignSection(stored)) return stored
  } catch {
    /* ignore */
  }
  return DEFAULT_SECTION
}

export function useDesignSection(projectRoot: Ref<string>) {
  const currentSection = ref<DesignSectionId>(readStoredSection())

  watch(
    currentSection,
    (section) => {
      try {
        localStorage.setItem(DESIGN_SECTION_STORAGE_KEY, section)
      } catch {
        /* ignore */
      }
    },
    { flush: "post" },
  )

  watch(
    projectRoot,
    () => {
      currentSection.value = readStoredSection()
    },
  )

  function setSection(section: DesignSectionId) {
    currentSection.value = section
  }

  return {
    currentSection: computed(() => currentSection.value),
    setSection,
  }
}
