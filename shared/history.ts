import type { CmsMutationActor } from "./cms";

export type HistoryActor = CmsMutationActor;

export type HistoryOutcome = "committed" | "reverted" | "restored";

export type HistoryFileSnapshot = {
  /** Project-relative POSIX path. */
  path: string;
  beforeHash: string | null;
  afterHash: string | null;
  /** Base64 bytes. Omitted when the file exceeds the restorable size limit. */
  before?: string;
  after?: string;
};

export type HistoryRecord = {
  id: string;
  actor: HistoryActor;
  surface: string;
  operation: string;
  targets: string[];
  timestamp: string;
  beforeHash: string;
  afterHash: string;
  files: HistoryFileSnapshot[];
  outcome: HistoryOutcome;
  restorable: boolean;
  /** Record this operation reverted or restored, when applicable. */
  sourceRecordId?: string;
};

export type HistoryListResult = {
  records: HistoryRecord[];
  canUndo: boolean;
  canRedo: boolean;
};

export type HistoryRestoreDirection = "before" | "after";

export type HistoryMutationResult = {
  ok: true;
  record: HistoryRecord;
};

export type ProjectMutationErrorCode =
  | "HISTORY_CONFLICT"
  | "HISTORY_NOT_RESTORABLE"
  | "HISTORY_RECORD_NOT_FOUND"
  | "MUTATION_ROLLBACK_FAILED"
  | "MUTATION_RECOVERY_FAILED"
  | "MUTATION_SHUTTING_DOWN";

export class ProjectMutationError extends Error {
  readonly code: ProjectMutationErrorCode;
  readonly targets: string[];

  constructor(
    code: ProjectMutationErrorCode,
    message: string,
    targets: string[] = [],
  ) {
    super(message);
    this.name = "ProjectMutationError";
    this.code = code;
    this.targets = targets;
  }
}
