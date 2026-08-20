// @vitest-environment jsdom

import { createApp, defineComponent, nextTick, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ComposerLayerRow } from "../../../../shared/composer/layers"
import type { MenuItemDef } from "@/menu/types"
import { TooltipProvider } from "@/components/ui/tooltip"
import { createComposerBeacon, provideComposerBeacon } from "../selection/useComposerBeacon"
import StructureTreeNode from "./StructureTreeNode.vue"

const mounted: Array<() => void> = []

const layer: ComposerLayerRow = {
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
}

function mountNode() {
  const host = document.createElement("div")
  document.body.append(host)
  const renamingPath = ref<string | null>(null)
  const pendingMenuRename = ref(false)
  const renameCommit = vi.fn()
  const renameCancel = vi.fn()
  const menuAction = vi.fn()
  const menuCloseAutoFocus = vi.fn()
  const menuItems: MenuItemDef[] = [{
    type: "item",
    id: "rename",
    label: "Rename",
    icon: "rename",
  }]
  const Harness = defineComponent({
    components: { StructureTreeNode, TooltipProvider },
    setup() {
      const beacon = provideComposerBeacon(createComposerBeacon())
      beacon.illuminate("0")
      return {
        canSort: () => false,
        expanded: new Set<string>(),
        layer,
        menuItemsFor: () => menuItems,
        onMenuAction: (id: string) => {
          menuAction(id)
          pendingMenuRename.value = id === "rename"
        },
        onMenuCloseAutoFocus: (event: Event) => {
          menuCloseAutoFocus(event)
          if (!pendingMenuRename.value) return
          event.preventDefault()
          pendingMenuRename.value = false
          renamingPath.value = "0"
        },
        onRenameCancel: () => {
          renameCancel()
          renamingPath.value = null
        },
        onRenameCommit: (_row: ComposerLayerRow, label: string) => renameCommit(label),
        onRenameStart: () => { renamingPath.value = "0" },
        renamingPath,
      }
    },
    template: `
      <TooltipProvider>
        <StructureTreeNode
          :row="layer"
          :depth="0"
          :expanded="expanded"
          :can-mutate="true"
          focused-path="0"
          :renaming-path="renamingPath"
          :menu-items-for="menuItemsFor"
          :drop-candidate="null"
          :can-sort="canSort"
          @rename-start="onRenameStart"
          @rename-commit="onRenameCommit"
          @rename-cancel="onRenameCancel"
          @menu-action="onMenuAction"
          @menu-close-auto-focus="onMenuCloseAutoFocus"
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
  return { host, renameCommit, renameCancel, menuAction, menuCloseAutoFocus }
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
})

describe("StructureTreeNode layer rename", () => {
  it("starts from a label double-click and commits with Enter", async () => {
    const { host, renameCommit } = mountNode()
    const label = [...host.querySelectorAll("span")].find(
      (element) => element.textContent?.trim() === "Section",
    )
    label?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
    await nextTick()
    await nextTick()

    const input = host.querySelector<HTMLInputElement>('input[aria-label="Rename Section"]')
    expect(input).not.toBeNull()
    expect(document.activeElement).toBe(input)

    input!.value = "Campaign hero"
    input!.dispatchEvent(new Event("input", { bubbles: true }))
    input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    expect(renameCommit).toHaveBeenCalledOnce()
    expect(renameCommit).toHaveBeenCalledWith("Campaign hero")
  })

  it("keeps focus in the rename input after choosing Rename from the context menu", async () => {
    const { host, renameCancel, menuAction, menuCloseAutoFocus } = mountNode()
    host.querySelector<HTMLElement>('[role="treeitem"]')?.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    )
    await nextTick()
    await nextTick()

    const renameItem = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((item) => item.textContent?.includes("Rename"))
    expect(renameItem).not.toBeNull()
    renameItem?.click()
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
    expect(menuAction).toHaveBeenCalledWith("rename")
    expect(menuCloseAutoFocus).toHaveBeenCalledOnce()

    const input = host.querySelector<HTMLInputElement>('input[aria-label="Rename Section"]')
    expect(input).not.toBeNull()
    expect(document.activeElement).toBe(input)
    input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    expect(renameCancel).toHaveBeenCalledOnce()
  })
})
