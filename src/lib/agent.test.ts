import { describe, expect, it, vi } from "vitest"
import { reactive } from "vue"
import type { AgentChatInput } from "../../shared/agent"
import { startAgentChat } from "./agent"

describe("agent IPC payloads", () => {
  it("serializes reactive chat history and shell context before invoking Electron", async () => {
    const startChat = vi.fn(
      async (_projectPath: string, streamId: string, _body: AgentChatInput) => ({
        streamId,
      }),
    )
    vi.stubGlobal("window", {
      aria: {
        agent: { startChat },
      },
    })

    const body = reactive<AgentChatInput>({
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "",
          createdAt: "2026-08-10T12:00:00.000Z",
          toolCalls: [
            {
              id: "tool-1",
              toolName: "aria_read_page",
              input: { route: "/about" },
            },
          ],
        },
        {
          id: "user-1",
          role: "user",
          content: "Suggest improvements for this page",
          createdAt: "2026-08-10T12:00:01.000Z",
        },
      ],
      composerMode: "agent",
      sessionModel: {
        inferenceProvider: "openai_compatible",
        modelId: "deepseek-v4-flash",
      },
      shellContext: {
        mode: "composer",
        workspace: "composer",
        itemType: "page",
        itemSlug: "/about",
        itemTitle: "About",
        pageId: "/about",
        selectedBlockId: "hero",
        blockCount: 2,
        canClientInsert: true,
        canClientNavigate: true,
        documentContext: {
          type: "page",
          file: "src/pages/about.astro",
          mtimeMs: 1,
          editable: true,
          dirty: false,
          selectedNodePath: "0",
          selectedNodeType: "section",
          outline: [
            { path: "0", type: "section", label: "Hero", depth: 0 },
          ],
        },
      },
    })

    await startAgentChat("/project", "stream-1", body)

    const payload = startChat.mock.calls[0]?.[2]
    expect(payload).toEqual(body)
    expect(() => structuredClone(payload)).not.toThrow()
    expect(payload).not.toBe(body)
    expect(payload?.messages).not.toBe(body.messages)
    expect(payload?.shellContext?.documentContext).not.toBe(
      body.shellContext?.documentContext,
    )
  })
})
