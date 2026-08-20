export type ComposerCodePosition = { line: number; character: number };
export type ComposerCodeRange = {
  start: ComposerCodePosition;
  end: ComposerCodePosition;
};

export type ComposerCodeDiagnostic = {
  range: ComposerCodeRange;
  severity?: number;
  message: string;
  source?: string;
};

export type ComposerCodeCompletion = {
  label: string;
  detail?: string;
  kind?: number;
  insertText?: string;
  textEdit?: { range: ComposerCodeRange; newText: string };
};

export type ComposerCodeLanguageResult = {
  completions: ComposerCodeCompletion[];
  diagnostics: ComposerCodeDiagnostic[];
};
