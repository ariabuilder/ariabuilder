// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, type Component, type ComponentPublicInstance } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { MediaAsset, MediaTransformVariant } from "@/lib/media"
import ComposerBackgroundControls from "./ComposerBackgroundControls.vue"

const mocks = vi.hoisted(() => ({ getMediaTransformState: vi.fn() }))
vi.mock("@/lib/media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/media")>()),
  getMediaTransformState: mocks.getMediaTransformState,
}))
vi.mock("@/workspace/studio/media/components/MediaPickerDialog.vue", () => ({
  default: defineComponent({
    name: "MediaPickerDialog",
    setup(_, { slots }) {
      return () => h("div", { "data-testid": "media-picker-stub" }, slots.default?.())
    },
  }),
}))
vi.mock("../inspector/useInspectorContext", () => ({
  tryUseInspectorContext: () => ({
    projectPath: { value: "/tmp/project" },
  }),
}))

const mounted: Array<() => void> = []

function mountControls(
  props: Record<string, unknown> = {},
) {
  const host = document.createElement("div")
  document.body.append(host)
  let component: (ComponentPublicInstance & {
    selectSource: (asset: MediaAsset) => Promise<void>
    selectVariant: (id: unknown) => void
    applyImageUrl: (url: string) => void
  }) | null = null
  const app = createApp({
    render: () => h(TooltipProvider, null, {
      default: () => h(ComposerBackgroundControls as Component, {
        ...props,
        ref: (value: unknown) => {
          component = value as typeof component
        },
      }),
    }),
  })
  app.mount(host)
  mounted.push(() => { app.unmount(); host.remove() })
  return { host, component: () => component }
}

afterEach(() => {
  mocks.getMediaTransformState.mockReset()
  for (const unmount of mounted.splice(0)) unmount()
})

describe("ComposerBackgroundControls", () => {
  it("infers color, image, gradient, and empty modes from authored CSS", async () => {
    const empty = mountControls({ values: {} })
    expect(empty.host.querySelector('[data-testid="background-mode-none"]')?.getAttribute("aria-checked")).toBe("true")
    expect(empty.host.querySelector('[data-testid="background-color-input"]')).toBeNull()

    const color = mountControls({ values: { "background-color": "#112233" } })
    expect(color.host.querySelector('[data-testid="background-mode-color"]')?.getAttribute("aria-checked")).toBe("true")
    expect(color.host.querySelector('[data-testid="background-color-input"]')).not.toBeNull()

    const image = mountControls({ values: { "background-image": 'url("/uploads/hero.jpg")' } })
    expect(image.host.querySelector('[data-testid="background-mode-image"]')?.getAttribute("aria-checked")).toBe("true")
    expect(image.host.querySelector('[data-testid="background-preview"]')).not.toBeNull()
    expect(image.host.querySelector('[data-testid="background-url-input"]')).not.toBeNull()

    const gradient = mountControls({
      values: { "background-image": "linear-gradient(90deg, #000000 0%, #ffffff 100%)" },
    })
    expect(gradient.host.querySelector('[data-testid="background-mode-gradient"]')?.getAttribute("aria-checked")).toBe("true")
    expect(gradient.host.querySelector('[data-testid="background-gradient-preview"]')).not.toBeNull()
    expect(gradient.host.querySelector('[data-testid="background-attachment-select"]')).not.toBeNull()
  })

  it("infers color, gradient, and image from background shorthand", async () => {
    const color = mountControls({ values: { background: "red" } })
    expect(color.host.querySelector('[data-testid="background-mode-color"]')?.getAttribute("aria-checked")).toBe("true")
    expect(color.host.querySelector('[data-testid="background-color-input"]')).not.toBeNull()

    const gradient = mountControls({
      values: { background: "linear-gradient(90deg, #000000 0%, #ffffff 100%)" },
    })
    expect(gradient.host.querySelector('[data-testid="background-mode-gradient"]')?.getAttribute("aria-checked")).toBe("true")

    const image = mountControls({
      values: { background: 'url("/uploads/hero.jpg") center / cover no-repeat' },
    })
    expect(image.host.querySelector('[data-testid="background-mode-image"]')?.getAttribute("aria-checked")).toBe("true")
    expect((image.host.querySelector('[data-testid="background-url-input"]') as HTMLInputElement | null)?.value).toBe(
      "/uploads/hero.jpg",
    )
  })

  it("keeps a custom background-size when committing an image", async () => {
    const commit = vi.fn()
    const { component } = mountControls({
      values: {
        "background-image": 'url("/uploads/hero.jpg")',
        "background-size": "100% 100%",
        "background-position": "center",
        "background-repeat": "no-repeat",
      },
      onCommit: commit,
    })
    await nextTick()
    component()?.applyImageUrl("/uploads/hero.jpg")
    await nextTick()
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({
      "background-image": 'url("/uploads/hero.jpg")',
      "background-size": "100% 100%",
    }))
  })

  it("clears all longhands when None is selected", async () => {
    const commit = vi.fn()
    const { host } = mountControls({
      values: { "background-color": "#112233" },
      onCommit: commit,
    })
    ;(host.querySelector('[data-testid="background-mode-none"]') as HTMLButtonElement).click()
    await nextTick()
    expect(commit).toHaveBeenCalledWith({
      background: "",
      "background-color": "",
      "background-image": "",
      "background-size": "",
      "background-position": "",
      "background-repeat": "",
      "background-attachment": "",
      "background-blend-mode": "",
    })
  })

  it("commits a wrapped image URL with size, position, and repeat", async () => {
    const commit = vi.fn()
    const { host, component } = mountControls({
      values: {},
      onCommit: commit,
    })
    ;(host.querySelector('[data-testid="background-mode-image"]') as HTMLButtonElement).click()
    await nextTick()
    component()?.applyImageUrl("/uploads/hero.jpg")
    await nextTick()
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({
      "background-image": 'url("/uploads/hero.jpg")',
      "background-size": "cover",
      "background-position": "center",
      "background-repeat": "no-repeat",
      "background-attachment": "",
      "background-blend-mode": "",
    }))
  })

  it("updates background-image when a media variant is chosen", async () => {
    const commit = vi.fn()
    const variant: MediaTransformVariant = {
      id: "variant-1",
      assetPath: "public/uploads/hero.jpg",
      name: "Square",
      sourceVersion: 1,
      crop: { x: 0, y: 0, width: 100, height: 100 },
      focalPoint: null,
      aspectRatio: { width: 1, height: 1 },
      output: { width: 800, height: 800, format: "webp", quality: 80 },
      url: "/uploads/variants/hero-square.webp",
      file: "public/uploads/variants/hero-square.webp",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }
    mocks.getMediaTransformState.mockResolvedValue({
      variants: [variant],
      profile: { currentSourceVersion: 1, altText: "" },
    })
    const { component } = mountControls({
      values: {},
      onCommit: commit,
    })
    await component()?.selectSource({
      id: "public/uploads/hero.jpg",
      name: "hero.jpg",
      type: "image",
      file: "public/uploads/hero.jpg",
      url: "/uploads/hero.jpg",
      size: 12,
      mimeType: "image/jpeg",
      mtimeMs: 0,
      dimensions: { width: 1200, height: 800 },
      cropCount: 1,
    })
    await nextTick()
    component()?.selectVariant("variant-1")
    await nextTick()
    expect(commit).toHaveBeenLastCalledWith(expect.objectContaining({
      "background-image": 'url("/uploads/variants/hero-square.webp")',
    }))
  })

  it("reloads variants and restores the selected variant on revisit", async () => {
    const variant: MediaTransformVariant = {
      id: "variant-1",
      assetPath: "public/uploads/hero.jpg",
      name: "Square",
      sourceVersion: 1,
      crop: { x: 0, y: 0, width: 100, height: 100 },
      focalPoint: null,
      aspectRatio: { width: 1, height: 1 },
      output: { width: 800, height: 800, format: "webp", quality: 80 },
      url: "/uploads/variants/hero-square.webp",
      file: "public/uploads/variants/hero-square.webp",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }
    mocks.getMediaTransformState.mockResolvedValue({
      variants: [variant],
      profile: { currentSourceVersion: 1, altText: "" },
    })
    const { host } = mountControls({
      values: { "background-image": 'url("/uploads/hero.jpg")' },
    })
    await vi.waitFor(() => {
      expect(mocks.getMediaTransformState).toHaveBeenCalledWith(
        "/tmp/project",
        "public/uploads/hero.jpg",
      )
    })
    await nextTick()
    expect(host.querySelector('[data-testid="background-variant-select"]')).not.toBeNull()
  })
})
