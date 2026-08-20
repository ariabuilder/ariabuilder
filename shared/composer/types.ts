/**
 * Editable Astro document model for Composer.
 *
 * Source of truth is always disk `.astro`. This in-memory tree is a working
 * representation for visual edit / serialize — never a JSON sidecar SoT.
 */

export type PropValue =
  | { type: "string"; value: string }
  | { type: "expr"; value: string }
  | { type: "bare" }
  | { type: "spread"; value: string }
  | { type: "shorthand"; value: string }
  | { type: "template-literal"; value: string };

export type AstroPropMap = Record<string, PropValue>;

export type PropFieldType =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "date"
  | "attrs"
  | "other";

export type PropField = {
  name: string;
  type: PropFieldType;
  optional: boolean;
  options?: string[];
  default?: string | number | boolean;
  /** True when default is an identifier/expression, not a literal. */
  defaultExpr?: boolean;
  /** Optional static authoring rules from @aria-component-controls metadata. */
  visibleWhen?: import("../conditions/types").ConditionSet;
  enabledWhen?: import("../conditions/types").ConditionSet;
};

export type AstroImport = {
  /** Local binding for default imports (`import X from '…'`). */
  name: string;
  path: string;
};

export type AstroCollectionBinding = {
  /** Statically known Astro collection names. Empty when the name is dynamic. */
  collections: string[];
  cardinality: "many" | "one" | "unknown";
  /** True when the collection argument could not be resolved without executing project code. */
  dynamic?: boolean;
};

/**
 * children semantics (aligned with Stacki, adapted for compiler AST):
 * - null  → self-closing (`<Tag />` or void element)
 * - []    → paired empty (`<div></div>`)
 * - [...] → children
 */
export type EditableNode =
  | ElementNode
  | ComponentNode
  | FragmentNode
  | TextNode
  | CommentNode
  | ExprNode
  | MapNode
  | ConditionalNode
  | RawNode
  | DoctypeNode
  | SlotNode;

type NodeBase = {
  id: string;
  /** Exact range in the original `.astro` source, using UTF-16 offsets. */
  sourceRange?: ComposerSourceRange;
};

/** CodeMirror-compatible offsets into the exact source string. */
export type ComposerSourceRange = {
  from: number;
  to: number;
};

export type ElementNode = NodeBase & {
  kind: "element";
  name: string;
  props: AstroPropMap;
  children: EditableNode[] | null;
  /** Capitalized tag that is not an imported component (dynamic tag). */
  dynamicTag?: boolean;
};

export type ComponentNode = NodeBase & {
  kind: "component";
  name: string;
  props: AstroPropMap;
  children: EditableNode[] | null;
  dynamicTag?: boolean;
  /** Absolute path when this node binds an HTML `?raw` chunk (optional Phase 0). */
  chunkFile?: string;
  chunkAggregate?: boolean;
};

export type FragmentNode = NodeBase & {
  kind: "fragment";
  /** Empty string for `<>`, `"Fragment"` for `<Fragment>`. */
  name: string;
  props: AstroPropMap;
  children: EditableNode[];
  chunkFile?: string;
  chunkAggregate?: boolean;
};

export type TextNode = NodeBase & {
  kind: "text";
  value: string;
};

export type CommentNode = NodeBase & {
  kind: "comment";
  value: string;
};

/** Opaque `{…}` region kept verbatim — preferred over whole-file bail. */
export type ExprNode = NodeBase & {
  kind: "expr";
  /** Full expression including outer braces, e.g. `{count}`. */
  value: string;
};

export type MapNode = NodeBase & {
  kind: "map";
  /** e.g. `items.map((item) => (` */
  head: string;
  children: EditableNode[];
  /** Ephemeral project-data analysis. Never serialized into Astro source. */
  dataBinding?: {
    ownership: "project" | "cms" | "computed";
    label: string;
    itemCount?: number;
  };
};

export type ConditionalNode = NodeBase & {
  kind: "conditional";
  mode: "and" | "ternary";
  /** Condition expression without surrounding braces. */
  test: string;
  consequent: EditableNode[];
  /** Present for ternary; omitted/empty for `&&`. */
  alternate?: EditableNode[];
  /** Parsed managed condition metadata. Hand-written expressions omit this. */
  condition?: import("../conditions/types").ConditionSet;
};

export type RawNode = NodeBase & {
  kind: "raw";
  name: string;
  props: AstroPropMap;
  inner: string;
};

export type DoctypeNode = NodeBase & {
  kind: "doctype";
  value: string;
};

export type SlotNode = NodeBase & {
  kind: "slot";
  props: AstroPropMap;
  children: EditableNode[] | null;
};

export type AstroDocumentModel = {
  imports: AstroImport[];
  /** Frontmatter remaining after tracked default imports are lifted. */
  extraFrontmatter: string;
  nodes: EditableNode[];
  /** From `interface Props` / `Astro.props` destructure when present. */
  propSchema: PropField[];
  /** Slot names exposed by this file's template. */
  slots: string[];
  /** HTMLAttributes<"tag"> extends hint, if any. */
  extendsTag: string | null;
  /** Ephemeral provenance from native `astro:content` calls. Never serialized. */
  collectionBindings?: Record<string, AstroCollectionBinding>;
};

export type BailReasonCode =
  | "compiler_error"
  | "markdown_mdx"
  | "unsafe_rewrite"
  | "parse_exception";

export type BailDetail = {
  code: BailReasonCode;
  what: string;
  near?: string;
  line?: number;
};

export type ParseAstroEditable = {
  editable: true;
  compilerValid: true;
  /** Exact input source. The projected model is never the source of truth. */
  source: string;
  model: AstroDocumentModel;
};

export type ParseAstroBail = {
  editable: false;
  /** True when compilation succeeded but visual projection failed. */
  compilerValid: boolean;
  reason: string;
  source: string;
  bail: BailDetail;
};

export type ParseAstroResult = ParseAstroEditable | ParseAstroBail;

export type ParseAstroOptions = {
  /** File path hint for extension policy (`.md` / `.mdx` → bail). */
  filename?: string;
};
