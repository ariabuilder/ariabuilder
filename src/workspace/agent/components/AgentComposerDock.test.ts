// @vitest-environment jsdom

import { createApp, h } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import AgentComposerDock from "./AgentComposerDock.vue"

vi.mock("./AgentChatView.vue", () => ({
  default: {
    name: "AgentChatView",
    template: `<div data-testid="agent-chat-view">chat</div>`,
  },
}))

vi.mock("../composables/useAriaAgent", async () => {
  const { ref } = await import("vue")
  return {
    useAriaAgent: () => ({
      isStreaming: ref(false),
      messages: ref([]),
      conversations: ref([]),
      activeId: ref("draft"),
      clearChat: vi.fn(),
      createConversation: vi.fn(),
    }),
  }
})

const mounted: Array<() => void> = []

function mountDock(): HTMLElement {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({
    render: () =>
      h(AgentComposerDock, {
        projectPath: "/tmp/aria-test",
      }),
  })
  app.mount(host)
  mounted.push(() => {
    app.unmount()
    host.remove()
  })
  return host
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
})

describe("AgentComposerDock", () => {
  it("renders the compact chat as a full-height panel", () => {
    const host = mountDock()
    const dock = host.querySelector("[data-aria-composer-agent-dock]")
    expect(dock).not.toBeNull()
    expect(dock?.getAttribute("data-state")).toBe("open")
    expect(host.querySelector("[data-testid='agent-chat-view']")).not.toBeNull()
    expect(host.textContent).toContain("Aria Engineer")
    expect(host.querySelector("[data-aria-composer-agent-toggle]")).toBeNull()
    expect(host.querySelector("[data-aria-agent-history-toggle]")).not.toBeNull()
  })
})
