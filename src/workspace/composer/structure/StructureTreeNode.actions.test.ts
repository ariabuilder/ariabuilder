// @vitest-environment jsdom

import { createApp, defineComponent } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ComposerLayerRow } from "../../../../shared/composer/layers"
import { TooltipProvider } from "@/components/ui/tooltip"
import { createComposerBeacon, provideComposerBeacon } from "../selection/useComposerBeacon"
import StructureTreeNode from "./StructureTreeNode.vue"

const mounted: Array<() => void> = []

function layer(overrides: Partial<ComposerLayerRow> = {}): ComposerLayerRow {
  return {
    path: "0",
    treeKey: "0",
    id: "section",
    kind: "element",
    region: "content",
    semanticType: "section",
    label: "Section",
    sourceLabel: "<section>",
    searchText: "section",
    children: [],
    isDocumentShell: false,
    draggable: true,
    deletable: true,
    canAcceptChildren: true,
    ...overrides,
  }
}

function mountNode(row: ComposerLayerRow) {
  const host = document.createElement("div")
  document.body.append(host)
  const open = vi.fn()
  const select = vi.fn()
  const menuAction = vi.fn()
  const Harness = defineComponent({
    components: { StructureTreeNode, TooltipProvider },
    setup() {
      provideComposerBeacon(createComposerBeacon())
      return {
        canSort: () => false,
        expanded: new Set<string>(),
        menuItemsFor: () => [],
        onMenuAction: (id: string, selectedRow: ComposerLayerRow) => menuAction(id, selectedRow),
        onSelect: (
          selectedRow: ComposerLayerRow,
          event?: MouseEvent | KeyboardEvent,
        ) => select(selectedRow, event),
        open,
        row,
      }
    },
    template: `
      <TooltipProvider>
        <StructureTreeNode
          :row="row"
          :depth="0"
          :expanded="expanded"
          :can-mutate="true"
          focused-path="0"
          :renaming-path="null"
          :menu-items-for="menuItemsFor"
          :drop-candidate="null"
          :can-sort="canSort"
          @select="onSelect"
          @open="open"
          @menu-action="onMenuAction"
        />
      </TooltipProvider>
    `,
  })
  const app = createApp(Harness)
  app.mount(host)
  mounted.push(() => {
    app.unmount()
    host.remove()
  })
  return { host, menuAction, open, select }
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
})

describe("StructureTreeNode action rail", () => {
  it.each([
    ["component", false],
    ["layout", true],
  ])("opens a %s when its label is double-clicked", (_label, pageLayout) => {
    const row = layer({
      kind: "component",
      semanticType: "component",
      label: pageLayout ? "BaseLayout" : "Hero",
      sourceLabel: pageLayout ? "<BaseLayout>" : "<Hero>",
      pageLayout,
    })
    const { host, open } = mountNode(row)
    const label = [...host.querySelectorAll("span")].find(
      (element) => element.textContent?.trim() === row.label,
    )

    label?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))

    expect(open).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledWith(row)
  })

  it("groups Motion, translation, and CMS actions in their existing order", () => {
    const row = layer({
      hasMotion: true,
      translationBinding: { namespace: "blog", keyPath: ["title"] },
      hasCmsBinding: true,
      cmsCollections: ["blog-posts"],
      cmsBindingCount: 2,
      cmsOwnership: "managed",
    })
    const { host, menuAction, select } = mountNode(row)
    const rail = host.querySelector<HTMLElement>("[data-layer-actions]")
    const buttons = [...rail!.querySelectorAll<HTMLButtonElement>("button")]

    expect(rail).not.toBeNull()
    expect(rail?.hasAttribute("data-layer-no-drag")).toBe(true)
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Motion applied to Section",
      "Translation blog.title applied to Section",
      "Blog posts collection · 2 bindings · managed applied to Section",
    ])
    expect(buttons.every((button) => button.classList.contains("size-6"))).toBe(true)

    for (const button of buttons) button.click()
    expect(select).toHaveBeenCalledTimes(3)
    expect(select.mock.calls.map(([selectedRow, event]) => [
      selectedRow === row,
      (event as MouseEvent | undefined)?.type,
    ])).toEqual([
      [true, "click"],
      [true, "click"],
      [true, "click"],
    ])
    expect(menuAction.mock.calls.map(([id]) => id)).toEqual([
      "inspect-motion",
      "inspect-cms",
      "inspect-cms",
    ])
  })

  it("pins project data through the same CMS Inspector action", () => {
    const row = layer({ hasDataBinding: true })
    const { host, menuAction, select } = mountNode(row)
    const rail = host.querySelector<HTMLElement>("[data-layer-actions]")
    const button = rail?.querySelector<HTMLButtonElement>("button")

    expect(button?.getAttribute("aria-label")).toBe("Project data applied to Section")
    button?.click()
    expect(select).toHaveBeenCalledOnce()
    expect(select.mock.calls[0]?.[0]).toBe(row)
    expect((select.mock.calls[0]?.[1] as MouseEvent | undefined)?.type).toBe("click")
    expect(menuAction).toHaveBeenCalledWith("inspect-cms", row)
  })

  it("omits the rail when the row has no actions", () => {
    const { host } = mountNode(layer())
    expect(host.querySelector("[data-layer-actions]")).toBeNull()
  })

  it("keeps context-only actions visible but disabled", () => {
    const { host, menuAction, select } = mountNode(layer({
      contextOnly: true,
      hasMotion: true,
      translationBinding: { namespace: "blog", keyPath: ["title"] },
      hasCmsBinding: true,
    }))
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("[data-layer-actions] button")]

    expect(buttons).toHaveLength(3)
    expect(buttons.every((button) => button.disabled)).toBe(true)
    for (const button of buttons) button.click()
    expect(select).not.toHaveBeenCalled()
    expect(menuAction).not.toHaveBeenCalled()
  })
})
