import type { AriaCollectionDef } from "@/types/aria"

export function collectionSupportsBody(
  collection: AriaCollectionDef | null | undefined,
): boolean {
  return collection?.supports?.includes("body") === true
}

export function collectionSupportsCover(
  collection: AriaCollectionDef | null | undefined,
): boolean {
  return (
    collection?.supports?.includes("cover") === true ||
    collection?.schema?.fields?.some(
      (field) => field.key === "cover" || field.key === "coverImage",
    ) === true
  )
}
