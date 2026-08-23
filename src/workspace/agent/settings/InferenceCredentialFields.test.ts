// @vitest-environment jsdom

import { createApp, nextTick } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import InferenceCredentialFields from "./InferenceCredentialFields.vue"

const mocks = vi.hoisted(() => ({
  setProviderCredentials: vi.fn(),
}))

vi.mock("@/lib/agent", () => ({
  clearProviderCredentials: vi.fn(),
  confirmInsecureProviderCredentials: vi.fn(),
  setProviderCredentials: mocks.setProviderCredentials,
}))

vi.mock("@/lib/project", () => ({
  openExternalUrl: vi.fn(),
}))

vi.mock("vue-sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

const mounted: Array<() => void> = []

afterEach(() => {
  mocks.setProviderCredentials.mockReset()
  for (const unmount of mounted.splice(0)) unmount()
})

function mountCredentialFields() {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp(InferenceCredentialFields, {
    instanceId: "opencode-instance",
    backendId: "opencode",
    configured: false,
    canEdit: true,
    capability: {
      backend: "keychain",
      secure: true,
      persistent: true,
      defaultStorage: "keychain",
    },
  })
  app.mount(host)
  mounted.push(() => {
    app.unmount()
    host.remove()
  })
  return host
}

describe("InferenceCredentialFields", () => {
  it("removes copied whitespace before saving an API key", async () => {
    mocks.setProviderCredentials.mockResolvedValue({ storage: "keychain" })
    const host = mountCredentialFields()
    const input = host.querySelector<HTMLInputElement>("input[type=password]")
    expect(input).not.toBeNull()

    const paste = new Event("paste", { bubbles: true, cancelable: true })
    Object.defineProperty(paste, "clipboardData", {
      value: {
        getData: () => "  sk-open\ncode\tgo\u00a0key  ",
      },
    })
    input?.dispatchEvent(paste)
    await nextTick()

    expect(paste.defaultPrevented).toBe(true)
    expect(input?.value).toBe("sk-opencodegokey")

    const saveButton = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Save key",
    )
    saveButton?.click()

    await vi.waitFor(() => {
      expect(mocks.setProviderCredentials).toHaveBeenCalledWith({
        provider: "opencode",
        instanceId: "opencode-instance",
        apiKey: "sk-opencodegokey",
        baseUrl: undefined,
        persistence: "persistent",
        insecurePersistenceConfirmation: undefined,
      })
    })
  })

  it.each([
    " sk-opencode-key",
    "sk-opencode-key ",
    "sk-open code-key",
  ])("reports whitespace typed into an API key: %j", async (apiKey) => {
    const host = mountCredentialFields()
    const input = host.querySelector<HTMLInputElement>("input[type=password]")
    expect(input).not.toBeNull()

    if (input) {
      input.value = apiKey
      input.dispatchEvent(new Event("input", { bubbles: true }))
      await nextTick()
      input.dispatchEvent(new Event("blur"))
    }
    await nextTick()

    expect(host.textContent).toContain("Remove spaces from the API key")
  })
})
