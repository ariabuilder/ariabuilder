// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import {
  getVisibleCommandItems,
  handleCommandInputKeydown,
  navigateVisibleCommandItems,
} from "../components/ui/command/commandInputNavigation"

afterEach(() => {
  document.body.replaceChildren()
})

function createContext() {
  const highlightedElement = { value: null as HTMLElement | null }
  return {
    highlightedElement,
    onKeydownEnter: vi.fn(),
    changeHighlight: vi.fn((element: HTMLElement) => {
      highlightedElement.value = element
    }),
  }
}

function createCommandDom(): HTMLElement {
  const root = document.createElement("div")
  root.dataset.slot = "command"
  root.innerHTML = `
    <input data-slot="command-input" />
    <div data-slot="command-list">
      <div data-slot="command-item">Home</div>
      <div data-slot="command-item">Contact</div>
      <div data-slot="command-item">Services</div>
    </div>`
  document.body.appendChild(root)
  return root
}

function keyboardEvent(root: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true })
  Object.defineProperty(event, "target", {
    value: root.querySelector("input"),
  })
  return event
}

describe("command input navigation", () => {
  it("moves from the focused input through visible rows", () => {
    const root = createCommandDom()
    const context = createContext()

    navigateVisibleCommandItems(keyboardEvent(root, "ArrowDown"), context, root)
    expect(context.highlightedElement.value?.textContent).toBe("Home")

    navigateVisibleCommandItems(keyboardEvent(root, "ArrowDown"), context, root)
    expect(context.highlightedElement.value?.textContent).toBe("Contact")
  })

  it("wraps upward to the last row", () => {
    const root = createCommandDom()
    const context = createContext()
    navigateVisibleCommandItems(keyboardEvent(root, "ArrowUp"), context, root)
    expect(context.highlightedElement.value?.textContent).toBe("Services")
  })

  it("ignores hidden and disabled rows", () => {
    const root = createCommandDom()
    const items = getVisibleCommandItems(root)
    items[0]!.dataset.disabled = ""
    items[1]!.hidden = true
    expect(getVisibleCommandItems(root).map((item) => item.textContent)).toEqual([
      "Services",
    ])
  })

  it("activates the closest row with Enter while input retains focus", async () => {
    const root = createCommandDom()
    const context = createContext()
    const event = keyboardEvent(root, "Enter")
    await handleCommandInputKeydown(event, context, root)
    expect(context.highlightedElement.value?.textContent).toBe("Home")
    expect(context.onKeydownEnter).toHaveBeenCalledWith(event)
  })
})
