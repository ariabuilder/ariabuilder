// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import ProjectImagePickerField from "@/workspace/studio/media/components/ProjectImagePickerField.vue"

const mocks = vi.hoisted(() => ({
  faviconPreview: vi.fn(),
}))

vi.mock("@/lib/workspace", () => ({
  faviconPreview: mocks.faviconPreview,
}))

vi.mock("@/workspace/studio/media/components/MediaPickerDialog.vue", () => ({
  default: defineComponent({
    emits: ["select", "update:open"],
    setup(_props, { emit }) {
      return () => h("button", {
        type: "button",
        "data-testid": "pick-asset",
        onClick: () => emit("select", {
          id: "public/apple-touch-icon.png",
          name: "apple-touch-icon.png",
          type: "image",
          file: "public/apple-touch-icon.png",
          url: "/apple-touch-icon.png",
          size: 100,
          mimeType: "image/png",
          mtimeMs: 1,
          dimensions: { width: 180, height: 180 },
          cropCount: 0,
        }),
      }, "Choose fixture")
    },
  }),
}))

const mounted: Array<() => void> = []

afterEach(() => {
  mocks.faviconPreview.mockReset()
  for (const unmount of mounted.splice(0)) unmount()
})

describe("ProjectImagePickerField", () => {
  it("previews the current project path and returns the selected media URL", async () => {
    mocks.faviconPreview.mockResolvedValue({ dataUrl: "data:image/png;base64,fixture" })
    const updates: string[] = []
    const host = document.createElement("div")
    document.body.append(host)
    const app = createApp(ProjectImagePickerField, {
      projectRoot: "/project",
      modelValue: "/favicon-32x32.png",
      previewAlt: "Site icon",
      "onUpdate:modelValue": (value: string) => updates.push(value),
    })
    app.mount(host)
    mounted.push(() => { app.unmount(); host.remove() })

    await vi.waitFor(() => {
      expect(mocks.faviconPreview).toHaveBeenCalledWith(
        "/project",
        "/favicon-32x32.png",
      )
      expect(host.querySelector("img")?.getAttribute("src"))
        .toBe("data:image/png;base64,fixture")
    })

    host.querySelector<HTMLButtonElement>('[data-testid="pick-asset"]')?.click()
    await nextTick()
    expect(updates).toContain("/apple-touch-icon.png")
  })
})
