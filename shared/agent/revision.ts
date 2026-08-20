/** Stable short revision string for optimistic concurrency fences. */
export function hashRevision(state: unknown, prefix = "r"): string {
  const text = JSON.stringify(state);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
