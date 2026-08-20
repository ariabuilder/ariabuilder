import { z } from "zod";
import type { CollectionSchema } from "./schemas";
import type { FieldSchema } from "./fieldSchema";

export type CollectionFieldSource = {
  schema?: { fields: FieldSchema[] };
  supports?: readonly string[];
};

export const SYSTEM_COVER_FIELD_KEY = "cover";

const SystemCoverFieldSchema = z
  .object({
    key: z.literal(SYSTEM_COVER_FIELD_KEY),
    label: z.literal("Cover"),
    type: z.literal("image"),
    required: z.literal(false),
  })
  .strict();

const COVER_IMAGE_KEYS = new Set([
  "cover",
  "cover_image",
  "cover_photo",
  "hero",
  "hero_image",
  "hero_photo",
  "featured_image",
  "featured_photo",
  "featuredimage",
  "media_image",
  "media_photo",
  "thumbnail",
]);

export function normalizeCmsFieldKey(key: string): string {
  return key
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");
}

export function isCoverImageField(field: FieldSchema): boolean {
  return (
    field.type === "image" &&
    COVER_IMAGE_KEYS.has(normalizeCmsFieldKey(field.key))
  );
}

export function systemCoverField(): FieldSchema {
  return SystemCoverFieldSchema.parse({
    key: SYSTEM_COVER_FIELD_KEY,
    label: "Cover",
    type: "image",
    required: false,
  });
}

export function entryFieldsForCollection(
  collection: CollectionFieldSource,
): FieldSchema[] {
  const fields = collection.schema?.fields ?? [];
  if (fields.some(isCoverImageField)) {
    return fields;
  }

  return (collection.supports ?? []).includes("cover")
    ? [systemCoverField(), ...fields]
    : fields;
}

export function collectionSchemaForEntryFrontmatter(
  collection: CollectionFieldSource & { schema: CollectionSchema },
): CollectionSchema {
  return {
    ...collection.schema,
    fields: entryFieldsForCollection(collection),
  };
}
