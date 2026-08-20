/** Stable Composer selection identity: source path plus rendered occurrence. */
export type SelectionRef = {
  path: string;
  occurrence: number;
};

export type ComposerSelectionState = {
  primary: SelectionRef | null;
  secondary: SelectionRef[];
  hover: SelectionRef | null;
};

export function selectionKey(selection: SelectionRef): string {
  return `${selection.path}#${selection.occurrence}`;
}

export function sameSelection(
  a: SelectionRef | null | undefined,
  b: SelectionRef | null | undefined,
): boolean {
  return Boolean(
    a && b && a.path === b.path && a.occurrence === b.occurrence,
  );
}

/** Structural commands operate once per source path, regardless of occurrences. */
export function uniqueSelectionPaths(
  selections: readonly SelectionRef[],
): string[] {
  return [...new Set(selections.map((selection) => selection.path))];
}

export function toggleSelection(
  current: readonly SelectionRef[],
  selection: SelectionRef,
): SelectionRef[] {
  const key = selectionKey(selection);
  const exists = current.some((item) => selectionKey(item) === key);
  return exists
    ? current.filter((item) => selectionKey(item) !== key)
    : [...current, selection];
}
