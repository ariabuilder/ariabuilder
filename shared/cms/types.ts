/**
 * Aria CMS domain types — lean collection model.
 */

export * from "./constants";
export type {
  AriaCollection,
  AriaCollectionPolicy,
  AriaEntry,
  AriaEntryLocale,
  AriaEntryRelation,
  AriaEntryRecord,
  AriaEntryRevision,
  AriaEntrySnapshot,
  CollectionSchema,
  CollectionPolicyRule,
  CollectionRssSettings,
  CollectionCommentsSettings,
  CmsAuditEvent,
  CmsSearchDocument,
  CmsSearchResult,
  PublicComment,
  PublicCommentModerationEvent,
  CmsEntryAutosave,
  CmsEntryPresenceLease,
  CmsEntryEditLock,
  CmsEntryDiff,
  CmsEntryWorkflow,
  CmsReviewAnnotation,
  FieldSchema,
  EntryFieldOrderItem,
  SystemEntryFieldKey,
} from "./schemas";

export type CmsMutationActor = "user" | "agent" | "system";

export type CmsMutationContext = {
  actor: CmsMutationActor;
  operation: string;
  projectPath: string;
  conversationId?: string;
  toolCallId?: string;
};

export type CmsCommandErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VERSION_CONFLICT"
  | "CONTENT_IN_USE"
  | "PREVIEW_MISMATCH"
  | "INTERNAL";

export type CmsCommandError = {
  code: CmsCommandErrorCode;
  message: string;
  currentVersion?: string;
  fieldDiagnostics?: Array<{ field: string; message: string }>;
  suggestedFix?: string;
};

export type CmsCommandResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: CmsCommandError };

export type CmsDeletionUsage = {
  kind: "reference" | "relation" | "collection-schema" | "media";
  sourceCollectionId?: string;
  sourceEntryId?: string;
  fieldKey?: string;
  locale?: string;
  file?: string;
  line?: number;
};

export type CmsDeletionUsageResult = {
  blocked: boolean;
  usages: CmsDeletionUsage[];
};

/** Collection schema after managed system fields such as `cover` are resolved. */
export type ResolvedCollectionSchema = import("./schemas").CollectionSchema & {
  fields: import("./schemas").FieldSchema[];
};
