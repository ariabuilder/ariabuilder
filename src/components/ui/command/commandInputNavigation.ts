import { nextTick } from "vue"

export interface CommandListboxNavigationContext {
  highlightedElement: { value: HTMLElement | null }
  onKeydownEnter: (event: KeyboardEvent) => void
  changeHighlight: (
    element: HTMLElement,
    scrollIntoView?: boolean,
    focus?: boolean,
  ) => void
}

const NAVIGATION_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"])
type CommandListRoot = Pick<ParentNode, "querySelector">

const keyboardNavStarted = new WeakMap<CommandListRoot, boolean>()

export function resetCommandKeyboardNavigation(
  listRoot: CommandListRoot = document,
): void {
  keyboardNavStarted.delete(listRoot)
}

export function isCommandFilterKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.dataset.slot === "command-input" ||
    target.closest('[data-slot="command-input"]') !== null
  )
}

function isVisibleCommandItem(element: HTMLElement): boolean {
  if (element.dataset.disabled === "") return false
  const group = element.closest('[data-slot="command-group"]')
  if (group instanceof HTMLElement && group.hidden) return false
  return !element.closest("[hidden]")
}

export function getVisibleCommandItems(
  listRoot: CommandListRoot = document,
): HTMLElement[] {
  const list = listRoot.querySelector('[data-slot="command-list"]')
  if (!list) return []
  return Array.from(
    list.querySelectorAll<HTMLElement>('[data-slot="command-item"]'),
  ).filter(isVisibleCommandItem)
}

function resolveHighlightedIndex(
  items: readonly HTMLElement[],
  highlighted: HTMLElement | null,
): number {
  if (!highlighted || items.length === 0) return -1
  return items.findIndex(
    (item) => item === highlighted || item.contains(highlighted),
  )
}

function resolveNextIndex(
  event: KeyboardEvent,
  items: readonly HTMLElement[],
  currentIndex: number,
): number {
  const lastIndex = items.length - 1
  if (currentIndex < 0) {
    return event.key === "ArrowUp" || event.key === "End" ? lastIndex : 0
  }
  switch (event.key) {
    case "ArrowDown":
      return currentIndex >= lastIndex ? 0 : currentIndex + 1
    case "ArrowUp":
      return currentIndex <= 0 ? lastIndex : currentIndex - 1
    case "Home":
      return 0
    case "End":
      return lastIndex
    default:
      return currentIndex
  }
}

export function navigateVisibleCommandItems(
  event: KeyboardEvent,
  rootContext: CommandListboxNavigationContext,
  listRoot: CommandListRoot = document,
): boolean {
  const items = getVisibleCommandItems(listRoot)
  if (items.length === 0) return false

  if (
    isCommandFilterKeyTarget(event.target) &&
    keyboardNavStarted.get(listRoot) !== true
  ) {
    keyboardNavStarted.set(listRoot, true)
    const firstIndex =
      event.key === "ArrowUp" || event.key === "End" ? items.length - 1 : 0
    rootContext.changeHighlight(items[firstIndex]!, true, false)
    return true
  }

  const currentIndex = resolveHighlightedIndex(
    items,
    rootContext.highlightedElement.value,
  )
  const next = items[resolveNextIndex(event, items, currentIndex)]
  if (!next) return false
  rootContext.changeHighlight(next, true, false)
  return true
}

export async function handleCommandInputKeydown(
  event: KeyboardEvent,
  rootContext: CommandListboxNavigationContext,
  listRoot: CommandListRoot = document,
): Promise<boolean> {
  if (!isCommandFilterKeyTarget(event.target)) return false

  if (NAVIGATION_KEYS.has(event.key)) {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (!navigateVisibleCommandItems(event, rootContext, listRoot)) {
      await nextTick()
      navigateVisibleCommandItems(event, rootContext, listRoot)
    }
    return true
  }

  if (event.key === "Enter") {
    event.preventDefault()
    event.stopImmediatePropagation()
    const visibleItems = getVisibleCommandItems(listRoot)
    const highlighted = rootContext.highlightedElement.value
    if (
      visibleItems.length > 0 &&
      (!highlighted ||
        !visibleItems.some(
          (item) => item === highlighted || item.contains(highlighted),
        ))
    ) {
      rootContext.changeHighlight(visibleItems[0]!, true, false)
      await nextTick()
    }
    rootContext.onKeydownEnter(event)
    return true
  }

  return false
}
