// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp } from "vue"
import ExternalEntryGridCard from "@/workspace/studio/collections/components/ExternalEntryGridCard.vue"
import ExternalFieldValue from "@/workspace/studio/collections/components/ExternalFieldValue.vue"

const mounted: Array<() => void> = []
afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
})

function mount(component: Parameters<typeof createApp>[0], props: Record<string, unknown>) {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp(component, props)
  app.mount(host)
  mounted.push(() => {
    app.unmount()
    host.remove()
  })
  return host
}

describe("read-only external entry UI", () => {
  it("uses one native record button and exposes no mutation controls", () => {
    const onOpen = vi.fn()
    const host = mount(ExternalEntryGridCard, {
      projectRoot: "/project",
      entry: { id: "one", data: { title: "Project One", status: "Live" } },
      fields: [
        { key: "title", label: "Title", type: "string", source: "schema", sortable: true, complex: false, image: false },
        { key: "status", label: "Status", type: "string", source: "inferred", sortable: true, complex: false, image: false },
      ],
      sourceLabel: "External CMS",
      onOpen,
    })

    const button = host.querySelector("button")
    expect(button?.getAttribute("aria-label")).toBe("Open Project One")
    expect(host.textContent).toContain("External CMS · Read-only")
    expect(host.textContent).not.toMatch(/Edit|Publish|Delete|Duplicate/)
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    expect(onOpen).toHaveBeenCalledWith("one")
  })

  it("renders nested values structurally instead of as a JSON dump", () => {
    const host = mount(ExternalFieldValue, {
      value: { challenge: "Fast", tags: ["Astro", "Aria"] },
    })
    expect(host.querySelector("dl")).not.toBeNull()
    expect(host.querySelector("ul")).not.toBeNull()
    expect(host.textContent).toContain("challenge")
    expect(host.textContent).toContain("Astro")
    expect(host.textContent).not.toContain('{"challenge"')
  })
})
