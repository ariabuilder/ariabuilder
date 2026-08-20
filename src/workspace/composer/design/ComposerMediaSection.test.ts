// @vitest-environment jsdom
import { createApp, defineComponent, h, nextTick, ref, type ComponentPublicInstance, type Ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AstroDocumentModel, ElementNode } from "../../../../shared/composer/types"
import {
  COMPOSER_IMAGE_PLACEHOLDER_SRC,
  LEGACY_BRANDED_COMPOSER_IMAGE_PLACEHOLDER_SRC,
  LEGACY_COMPOSER_IMAGE_PLACEHOLDER_SRC,
  nodeAtMarkerPath,
} from "../../../../shared/composer"
import type { MediaAsset, MediaTransformVariant } from "@/lib/media"
import { provideComposerBeacon } from "../selection/useComposerBeacon"
import { provideComposerDocument, type ComposerDocumentSession } from "../useComposerDocumentSession"
import { provideInspectorContext } from "../inspector/useInspectorContext"
import ComposerMediaSection from "./ComposerMediaSection.vue"

const mocks = vi.hoisted(() => ({ getMediaTransformState: vi.fn(), getPlayableMediaUrl: vi.fn() }))
vi.mock("@/lib/media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/media")>()),
  getMediaTransformState: mocks.getMediaTransformState,
  getPlayableMediaUrl: mocks.getPlayableMediaUrl,
}))
vi.mock("@/workspace/studio/media/components/MediaPickerDialog.vue", () => ({
  default: defineComponent({
    name: "MediaPickerDialog",
    props: { open: { type: Boolean, default: false } },
    setup(props) {
      return () => h("div", { "data-testid": "media-picker-stub", "data-open": String(props.open) })
    },
  }),
}))

const mounted: Array<() => void> = []

function image(id: string, src = ""): ElementNode {
  return {
    id, kind: "element", name: "img",
    props: src ? { src: { type: "string", value: src } } : {},
    children: null,
  }
}

function documentFor(nodes: ElementNode[]): AstroDocumentModel {
  return { imports: [], extraFrontmatter: "", nodes, propSchema: [], slots: [], extendsTag: null }
}

function mountMedia(
  model: Ref<AstroDocumentModel | null>,
  projectPath = "",
  options: { node?: ElementNode; targetPath?: string; selectedPath?: string } = {},
) {
  const host = document.createElement("div")
  document.body.append(host)
  let component: (ComponentPublicInstance & {
    selectSource: (asset: MediaAsset) => Promise<void>
    selectVariant: (id: unknown) => void
  }) | null = null
  const lastResult: { ok?: boolean; selectPath?: string | null }[] = []
  const commit = vi.fn((_label: string, fn: (model: AstroDocumentModel) => { ok?: boolean; selectPath?: string | null }) => {
    if (!model.value) return false
    const result = fn(model.value)
    lastResult.push(result)
    return result.ok !== false
  })
  const InspectorHost = defineComponent({
    setup() {
      provideInspectorContext()
      return () => h(ComposerMediaSection, {
        node: options.node ?? model.value?.nodes[0] as ElementNode,
        targetPath: options.targetPath,
        openSection: "image",
        ref: (value: unknown) => { component = value as typeof component },
      })
    },
  })
  const app = createApp({
    setup() {
      const beacon = provideComposerBeacon()
      beacon.illuminate(options.selectedPath ?? "0")
      provideComposerDocument({
        model,
        editable: ref(true), designActive: ref(true), projectPath: ref(projectPath), editFile: ref("src/pages/index.astro"),
        availableLayouts: ref([]), pages: ref([]), documentKind: ref("page"),
        commitInspectorMutation: commit,
      } as unknown as ComposerDocumentSession)
      return () => h(InspectorHost)
    },
  })
  app.mount(host)
  mounted.push(() => { app.unmount(); host.remove() })
  return { component: () => component, commit, host, lastResult }
}

afterEach(() => {
  mocks.getMediaTransformState.mockReset()
  mocks.getPlayableMediaUrl.mockReset()
  for (const unmount of mounted.splice(0)) unmount()
})

describe("ComposerMediaSection", () => {
  it("keeps the portable new-image placeholder in Media mode", async () => {
    const model = ref<AstroDocumentModel | null>(documentFor([image("placeholder", COMPOSER_IMAGE_PLACEHOLDER_SRC)]))
    const { host } = mountMedia(model)
    await nextTick()

    expect(host.querySelector('[data-source-mode="media"]')?.getAttribute("aria-checked")).toBe("true")
    expect(host.querySelector('input[type="url"]')).toBeNull()
    expect(host.querySelector<HTMLImageElement>('img')?.src).toContain("data:image/svg+xml")
  })

  it("presents the former hard-coded placeholder as Media instead of a broken URL thumbnail", async () => {
    const model = ref<AstroDocumentModel | null>(documentFor([image("legacy-placeholder", "/placeholder.svg")]))
    const { host } = mountMedia(model)
    await nextTick()

    expect(host.querySelector('[data-source-mode="media"]')?.getAttribute("aria-checked")).toBe("true")
    expect(host.querySelector('input[type="url"]')).toBeNull()
    expect(host.querySelector<HTMLImageElement>('img')?.src).toContain("data:image/svg+xml")
  })

  it("previews the previous portable placeholder with the current Aria artwork", async () => {
    const model = ref<AstroDocumentModel | null>(documentFor([image("old-portable-placeholder", LEGACY_COMPOSER_IMAGE_PLACEHOLDER_SRC)]))
    const { host } = mountMedia(model)
    await nextTick()

    expect(host.querySelector('[data-source-mode="media"]')?.getAttribute("aria-checked")).toBe("true")
    expect(host.querySelector<HTMLImageElement>('img')?.src).toBe(COMPOSER_IMAGE_PLACEHOLDER_SRC)
  })

  it("previews the previous branded placeholder with the current mountain artwork", async () => {
    const model = ref<AstroDocumentModel | null>(documentFor([image("branded-placeholder", LEGACY_BRANDED_COMPOSER_IMAGE_PLACEHOLDER_SRC)]))
    const { host } = mountMedia(model)
    await nextTick()

    expect(host.querySelector('[data-source-mode="media"]')?.getAttribute("aria-checked")).toBe("true")
    expect(host.querySelector<HTMLImageElement>('img')?.src).toBe(COMPOSER_IMAGE_PLACEHOLDER_SRC)
  })

  it("resolves project asset thumbnails through the media protocol", async () => {
    mocks.getPlayableMediaUrl.mockResolvedValue({
      url: "aria-media://asset/project/src-assets-image.jpg",
      mimeType: "image/jpeg",
    })
    const model = ref<AstroDocumentModel | null>(documentFor([image("asset", "/src/assets/image.jpg")]))
    const { host } = mountMedia(model, "/Projects/Site")

    await vi.waitFor(() => {
      expect(mocks.getPlayableMediaUrl).toHaveBeenCalledWith("/Projects/Site", "src/assets/image.jpg")
      expect(host.querySelector<HTMLImageElement>('img')?.src).toBe("aria-media://asset/project/src-assets-image.jpg")
    })
    expect(host.querySelector('[data-source-mode="media"]')?.getAttribute("aria-checked")).toBe("true")
  })

  it("commits source dimensions atomically and ignores stale metadata after selection changes", async () => {
    let resolveState!: (value: { variants: []; profile: { currentSourceVersion: string; altText: string } }) => void
    mocks.getMediaTransformState.mockReturnValue(new Promise((resolve) => { resolveState = resolve }))
    const model = ref<AstroDocumentModel | null>(documentFor([image("first")]))
    const original = model.value!
    const { component, commit } = mountMedia(model)
    await nextTick()

    const asset = { id: "asset-1", url: "/uploads/one.webp", dimensions: { width: 800, height: 600 } } as MediaAsset
    const pending = component()!.selectSource(asset)
    expect(commit).not.toHaveBeenCalled()

    model.value = documentFor([image("second", "/uploads/two.webp")])
    await nextTick()
    resolveState({ variants: [], profile: { currentSourceVersion: "v1", altText: "Must not leak" } })
    await pending
    expect((nodeAtMarkerPath(original.nodes, "0") as ElementNode).props.src).toBeUndefined()
    expect((nodeAtMarkerPath(model.value.nodes, "0") as ElementNode).props.alt).toBeUndefined()
    expect(commit).not.toHaveBeenCalled()
  })

  it("applies the source, dimensions, and profile alt text in one mutation", async () => {
    mocks.getMediaTransformState.mockResolvedValue({ variants: [], profile: { currentSourceVersion: "v1", altText: "Profile alt" } })
    const model = ref<AstroDocumentModel | null>(documentFor([image("first")]))
    const { component, commit } = mountMedia(model)
    await nextTick()

    await component()!.selectSource({
      id: "asset-atomic",
      url: "/uploads/atomic.webp",
      dimensions: { width: 800, height: 600 },
    } as MediaAsset)

    expect(commit).toHaveBeenCalledTimes(1)
    expect(nodeAtMarkerPath(model.value!.nodes, "0")).toMatchObject({
      props: {
        src: { value: "/uploads/atomic.webp" },
        width: { value: "800" },
        height: { value: "600" },
        alt: { value: "Profile alt" },
      },
    })
  })

  it("removes dimensions that belong to a previous source", async () => {
    mocks.getMediaTransformState.mockResolvedValue({ variants: [], profile: null })
    const node = image("first", "/uploads/old.webp")
    node.props.width = { type: "string", value: "1200" }
    node.props.height = { type: "string", value: "800" }
    const model = ref<AstroDocumentModel | null>(documentFor([node]))
    const { component } = mountMedia(model)
    await nextTick()

    await component()!.selectSource({
      id: "asset-2",
      url: "/uploads/unknown.webp",
      dimensions: null,
    } as MediaAsset)

    const selected = nodeAtMarkerPath(model.value!.nodes, "0") as ElementNode
    expect(selected.props.src).toMatchObject({ value: "/uploads/unknown.webp" })
    expect(selected.props.width).toBeUndefined()
    expect(selected.props.height).toBeUndefined()
  })

  it("keeps srcset within one transform family and invalidates it when src changes", async () => {
    const variants = [
      variant("wide-400", "/uploads/variants/wide-400.webp", 400, 200, { x: 0, y: 0, width: 1000, height: 500 }),
      variant("wide-800", "/uploads/variants/wide-800.webp", 800, 400, { x: 0, y: 0, width: 1000, height: 500 }),
      variant("square", "/uploads/variants/square.webp", 600, 600, { x: 250, y: 0, width: 500, height: 500 }),
    ]
    mocks.getMediaTransformState.mockResolvedValue({ variants, profile: { currentSourceVersion: 1, altText: null } })
    const model = ref<AstroDocumentModel | null>(documentFor([image("first")]))
    const { component, commit } = mountMedia(model)
    await nextTick()

    await component()!.selectSource({
      id: "asset-3",
      url: "/uploads/original.webp",
      dimensions: { width: 1000, height: 500 },
    } as MediaAsset)
    component()!.selectVariant("wide-800")

    const selected = nodeAtMarkerPath(model.value!.nodes, "0") as ElementNode
    expect(selected.props.src).toMatchObject({ value: "/uploads/variants/wide-800.webp" })
    expect(selected.props.srcset).toMatchObject({
      value: "/uploads/variants/wide-400.webp 400w, /uploads/variants/wide-800.webp 800w",
    })
    expect(selected.props.srcset?.type === "string" ? selected.props.srcset.value : "").not.toContain("square")
    expect(selected.props.width).toMatchObject({ value: "800" })
    expect(selected.props.height).toMatchObject({ value: "400" })

    selected.props.src = { type: "string", value: "https://example.com/replacement.webp" }
    await nextTick()
    const commitsBeforeStaleSelection = commit.mock.calls.length
    component()!.selectVariant("wide-400")
    expect(commit).toHaveBeenCalledTimes(commitsBeforeStaleSelection)
    expect(selected.props.src).toMatchObject({ value: "https://example.com/replacement.webp" })
  })

  it("writes a nested Avatar image while the wrapper stays selected", async () => {
    mocks.getMediaTransformState.mockResolvedValue({ variants: [], profile: null })
    const photo = image("avatar-image", COMPOSER_IMAGE_PLACEHOLDER_SRC)
    const avatar: ElementNode = {
      id: "avatar",
      kind: "element",
      name: "span",
      props: { "data-aria-type": { type: "string", value: "Avatar" } },
      children: [photo, {
        id: "fallback",
        kind: "element",
        name: "span",
        props: { class: { type: "string", value: "aria-avatar__fallback" } },
        children: [{ id: "initials", kind: "text", value: "AA" }],
      }],
    }
    const model = ref<AstroDocumentModel | null>(documentFor([avatar]))
    const { component, commit, lastResult } = mountMedia(model, "", {
      node: photo,
      targetPath: "0.0",
      selectedPath: "0",
    })
    await nextTick()

    await component()!.selectSource({
      id: "asset-avatar",
      url: "/uploads/face.webp",
      dimensions: { width: 160, height: 160 },
    } as MediaAsset)

    expect(commit).toHaveBeenCalledTimes(1)
    expect(nodeAtMarkerPath(model.value!.nodes, "0.0")).toMatchObject({
      props: { src: { value: "/uploads/face.webp" } },
    })
    expect(lastResult[0]?.selectPath).toBe("0")
  })

  it("shows a compact variant picker on the thumbnail for an existing source", async () => {
    const square = variant(
      "square",
      "/uploads/variants/public__uploads__hero.jpg/square-1.webp",
      600,
      600,
      { x: 0, y: 0, width: 1, height: 1 },
    )
    mocks.getMediaTransformState.mockResolvedValue({
      variants: [square],
      profile: { currentSourceVersion: 1, altText: null },
    })
    const model = ref<AstroDocumentModel | null>(documentFor([image("hero", "/uploads/hero.jpg")]))
    const { host } = mountMedia(model, "/Projects/Site")

    await vi.waitFor(() => {
      expect(mocks.getMediaTransformState).toHaveBeenCalledWith("/Projects/Site", "public/uploads/hero.jpg")
      expect(host.querySelector('[data-testid="media-variant-select"]')).not.toBeNull()
    })
    expect(host.querySelector('[data-testid="media-preview-trigger"]')?.parentElement?.querySelector('[data-testid="media-variant-select"]')).not.toBeNull()
  })

  it("keeps the original thumbnail after choosing a variant", async () => {
    mocks.getPlayableMediaUrl.mockResolvedValue({
      url: "aria-media://asset/project/hero.jpg",
      mimeType: "image/jpeg",
    })
    mocks.getMediaTransformState.mockResolvedValue({
      variants: [variant(
        "Hero",
        "/uploads/variants/public__uploads__hero.jpg/Hero-1.webp",
        1600,
        900,
        { x: 0, y: 0, width: 1, height: 1 },
      )],
      profile: { currentSourceVersion: 1, altText: null },
    })
    const model = ref<AstroDocumentModel | null>(documentFor([image("hero", "/uploads/hero.jpg")]))
    const { host, component } = mountMedia(model, "/Projects/Site")
    await vi.waitFor(() => {
      expect(host.querySelector("img")?.src).toBe("aria-media://asset/project/hero.jpg")
      expect(host.querySelector('[data-testid="media-variant-select"]')).not.toBeNull()
    })

    component()!.selectVariant("Hero")
    await nextTick()

    expect(nodeAtMarkerPath(model.value!.nodes, "0")).toMatchObject({
      props: { src: { value: "/uploads/variants/public__uploads__hero.jpg/Hero-1.webp" } },
    })
    expect(host.querySelector("img")?.src).toBe("aria-media://asset/project/hero.jpg")
    expect(host.querySelector('[data-testid="media-preview-fallback"]')).toBeNull()
    expect(mocks.getPlayableMediaUrl.mock.calls.map((call) => call[1])).toEqual(["public/uploads/hero.jpg"])
  })

  it("restores Original from the compact variant picker", async () => {
    mocks.getMediaTransformState.mockResolvedValue({
      variants: [variant("square", "/uploads/variants/square.webp", 600, 600, { x: 0, y: 0, width: 1, height: 1 })],
      profile: { currentSourceVersion: 1, altText: null },
    })
    const model = ref<AstroDocumentModel | null>(documentFor([image("hero")]))
    const { component } = mountMedia(model)
    await nextTick()

    await component()!.selectSource({
      id: "public/uploads/hero.jpg",
      url: "/uploads/hero.jpg",
      dimensions: { width: 1200, height: 800 },
    } as MediaAsset)
    component()!.selectVariant("square")
    expect(nodeAtMarkerPath(model.value!.nodes, "0")).toMatchObject({
      props: { src: { value: "/uploads/variants/square.webp" } },
    })

    component()!.selectVariant("original")
    expect(nodeAtMarkerPath(model.value!.nodes, "0")).toMatchObject({
      props: {
        src: { value: "/uploads/hero.jpg" },
        width: { value: "1200" },
        height: { value: "800" },
      },
    })
    expect((nodeAtMarkerPath(model.value!.nodes, "0") as ElementNode).props.srcset).toBeUndefined()
  })

  it("opens the media picker from the thumbnail instead of a separate replace button", async () => {
    const model = ref<AstroDocumentModel | null>(documentFor([image("asset", "/images/sponsors/logo.png")]))
    const { host } = mountMedia(model)
    await nextTick()

    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="media-preview-trigger"]')
    expect(trigger?.tagName).toBe("BUTTON")
    expect(trigger?.getAttribute("aria-label")).toBe("Replace media")
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === "Replace media" && button !== trigger)).toBe(false)

    trigger?.click()
    await nextTick()
    expect(host.querySelector('[data-testid="media-picker-stub"]')?.getAttribute("data-open")).toBe("true")
  })

  it("lets an empty media source choose from the thumbnail", async () => {
    const model = ref<AstroDocumentModel | null>(documentFor([image("empty")]))
    const { host } = mountMedia(model)
    await nextTick()

    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="media-preview-trigger"]')
    expect(trigger?.getAttribute("aria-label")).toBe("Choose media")
    expect(trigger?.textContent).toContain("Choose media")
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === "Choose media" && button !== trigger)).toBe(false)
  })

  it("keeps a URL preview from opening the media library", async () => {
    const model = ref<AstroDocumentModel | null>(documentFor([image("remote", "https://cdn.example.com/hero.webp")]))
    const { host } = mountMedia(model)
    await nextTick()

    expect(host.querySelector('[data-source-mode="url"]')?.getAttribute("aria-checked")).toBe("true")
    expect(host.querySelector('[data-testid="media-preview-trigger"]')).toBeNull()
    expect(host.querySelector('input[type="url"]')).not.toBeNull()
  })

  it("commits object-position from the 9-point grid", async () => {
    const model = ref<AstroDocumentModel | null>(documentFor([image("hero", "/uploads/hero.jpg")]))
    const { host } = mountMedia(model)
    await nextTick()

    expect(host.querySelector('[data-testid="object-position-control"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="object-position-center"]')?.getAttribute("aria-checked")).toBe("true")

    host.querySelector<HTMLButtonElement>('[data-testid="object-position-top-left"]')?.click()
    await nextTick()

    expect(nodeAtMarkerPath(model.value!.nodes, "0")).toMatchObject({
      props: { style: { value: "object-position: top left" } },
    })
    expect(host.querySelector('[data-testid="object-position-top-left"]')?.getAttribute("aria-checked")).toBe("true")
  })
})

function variant(
  id: string,
  url: string,
  width: number,
  height: number,
  crop: MediaTransformVariant["crop"],
): MediaTransformVariant {
  return {
    id,
    assetPath: "src/assets/original.webp",
    name: id,
    sourceVersion: 1,
    crop,
    focalPoint: null,
    aspectRatio: { width: 2, height: 1 },
    output: { width, height, format: "webp", quality: 80 },
    url,
    file: url.slice(1),
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
  }
}
