import { describe, expect, it } from "vitest"
import type { MediaAsset } from "@/lib/media"
import {
  findUploadedPickerAsset,
  isSvgMediaAsset,
  mediaAssetMatchesPicker,
} from "./mediaPicker"
import {
  iconPackFromValue,
  resolveIconPickerPack,
  toStoredIconValue,
} from "./iconPicker"

function asset(input: Partial<MediaAsset> & Pick<MediaAsset, "id" | "type">): MediaAsset {
  return {
    id: input.id,
    name: input.name ?? input.id.split("/").at(-1) ?? input.id,
    type: input.type,
    file: input.file ?? input.id,
    url: input.url ?? `/${input.id}`,
    size: input.size ?? 1,
    mimeType: input.mimeType ?? null,
    mtimeMs: input.mtimeMs ?? 1,
    dimensions: input.dimensions ?? null,
    cropCount: input.cropCount ?? 0,
    folder: input.folder,
  }
}

describe("media picker filters", () => {
  it("matches media types and SVG-only selections", () => {
    const svg = asset({ id: "public/icon.svg", type: "image" })
    const png = asset({ id: "public/photo.png", type: "image" })
    expect(isSvgMediaAsset(svg)).toBe(true)
    expect(mediaAssetMatchesPicker(svg, ["image"], true)).toBe(true)
    expect(mediaAssetMatchesPicker(png, ["image"], true)).toBe(false)
    expect(mediaAssetMatchesPicker(png, ["document"], false)).toBe(false)
  })

  it("finds the newly uploaded eligible asset", () => {
    const before = asset({ id: "public/old.png", type: "image" })
    const uploadedSvg = asset({ id: "public/new.svg", type: "image" })
    const uploadedPdf = asset({ id: "public/new.pdf", type: "document" })
    expect(
      findUploadedPickerAsset(
        [uploadedPdf, uploadedSvg, before],
        [uploadedPdf, uploadedSvg],
        ["image"],
        true,
      )?.id,
    ).toBe(uploadedSvg.id)
  })
})

describe("icon picker values", () => {
  it("infers eligible packs and stores Iconify values", () => {
    expect(iconPackFromValue("i-lucide:star")).toBe("lucide")
    expect(resolveIconPickerPack(["mdi", "lucide"], "i-lucide:star")).toBe(
      "lucide",
    )
    expect(resolveIconPickerPack(["mdi"], "i-lucide:star")).toBe("mdi")
    expect(toStoredIconValue("lucide:star")).toBe("i-lucide:star")
  })
})
