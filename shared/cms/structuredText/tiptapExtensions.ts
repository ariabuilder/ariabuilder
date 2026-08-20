import { z } from "zod";

/**
 * TipTap extension attrs + node name constants.
 * Full `@tiptap/core` Node.create definitions are omitted — aria-app does not
 * depend on TipTap yet. Conversion logic in `tiptap.ts` only needs these schemas.
 */

export const STRUCTURED_IMAGE_NODE_NAME = "ariaStructuredImage";
export const STRUCTURED_EMBED_NODE_NAME = "ariaStructuredEmbed";

export const StructuredImageNodeAttrsSchema = z
  .object({
    mediaId: z.string().trim().min(1),
    alt: z.string().optional().default(""),
    caption: z.string().optional().default(""),
  })
  .strict();

export const StructuredEmbedNodeAttrsSchema = z
  .object({
    provider: z.string().trim().min(1),
    url: z.string().trim().min(1),
  })
  .strict();

export type StructuredImageNodeAttrs = z.infer<
  typeof StructuredImageNodeAttrsSchema
>;
export type StructuredEmbedNodeAttrs = z.infer<
  typeof StructuredEmbedNodeAttrsSchema
>;

export function inferEmbedProvider(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) {
      return "youtube";
    }
    if (hostname.includes("vimeo.com")) {
      return "vimeo";
    }
    if (hostname.includes("soundcloud.com")) {
      return "soundcloud";
    }
    if (hostname.includes("spotify.com")) {
      return "spotify";
    }
    if (hostname.includes("codepen.io")) {
      return "codepen";
    }
    return hostname || "embed";
  } catch {
    return "embed";
  }
}
