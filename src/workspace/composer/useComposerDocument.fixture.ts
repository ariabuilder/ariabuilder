import type { AstroDocumentModel } from "../../../shared/composer/types"

export function blankModel(): AstroDocumentModel {
  return {
    imports: [],
    extraFrontmatter: "",
    nodes: [
      {
        id: "body",
        kind: "element",
        name: "body",
        props: {},
        children: [
          {
            id: "slot-default",
            kind: "slot",
            props: {},
            children: null,
          },
        ],
      },
    ],
    propSchema: [],
    slots: [],
    extendsTag: null,
  }
}
