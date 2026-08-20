import { mergeAttributes, Node } from "@tiptap/core"
import {
  STRUCTURED_EMBED_NODE_NAME,
  STRUCTURED_IMAGE_NODE_NAME,
  StructuredEmbedNodeAttrsSchema,
  StructuredImageNodeAttrsSchema,
} from "../../../../../shared/cms"

/** TipTap node for CMS structured-text image blocks (keeps media on round-trip). */
export const AriaStructuredImage = Node.create({
  name: STRUCTURED_IMAGE_NODE_NAME,
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      mediaId: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-media-id") ?? "",
      },
      alt: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-alt") ?? "",
      },
      caption: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-caption") ?? "",
      },
    }
  },

  parseHTML() {
    return [{ tag: "figure[data-aria-structured-image]" }]
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = StructuredImageNodeAttrsSchema.safeParse({
      mediaId: HTMLAttributes.mediaId,
      alt: HTMLAttributes.alt,
      caption: HTMLAttributes.caption,
    })
    const parsed = attrs.success
      ? attrs.data
      : { mediaId: "", alt: "", caption: "" }

    return [
      "figure",
      mergeAttributes(HTMLAttributes, {
        "data-aria-structured-image": "true",
        "data-media-id": parsed.mediaId,
        "data-alt": parsed.alt,
        "data-caption": parsed.caption,
        class: "aria-structured-image rounded-md border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground",
      }),
      [
        "figcaption",
        {},
        parsed.caption || parsed.alt || `Image: ${parsed.mediaId || "untitled"}`,
      ],
    ]
  },
})

/** TipTap node for CMS structured-text embed blocks. */
export const AriaStructuredEmbed = Node.create({
  name: STRUCTURED_EMBED_NODE_NAME,
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      provider: {
        default: "embed",
        parseHTML: (element) =>
          element.getAttribute("data-provider") ?? "embed",
      },
      url: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-url") ?? "",
      },
    }
  },

  parseHTML() {
    return [{ tag: "div[data-aria-structured-embed]" }]
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = StructuredEmbedNodeAttrsSchema.safeParse({
      provider: HTMLAttributes.provider,
      url: HTMLAttributes.url,
    })
    const parsed = attrs.success
      ? attrs.data
      : { provider: "embed", url: "" }

    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-aria-structured-embed": "true",
        "data-provider": parsed.provider,
        "data-url": parsed.url,
        class: "aria-structured-embed rounded-md border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground",
      }),
      `${parsed.provider}: ${parsed.url || "embed"}`,
    ]
  },
})
