export type WarmQueueItem = {
  id: string;
};

function normalizeId(id: string): string {
  return id.trim().replace(/\\/g, "/");
}

/**
 * Move matching pending items to the front, preserving `ids` order.
 * In-flight work is not represented in `pending` and is left alone.
 */
export function prioritizeWarmQueue<T extends WarmQueueItem>(
  pending: readonly T[],
  ids: readonly string[],
): T[] {
  const order = new Map<string, number>();
  for (const raw of ids) {
    const id = normalizeId(raw);
    if (id && !order.has(id)) order.set(id, order.size);
  }
  if (!order.size) return [...pending];

  const head: T[] = [];
  const rest: T[] = [];
  for (const item of pending) {
    if (order.has(normalizeId(item.id))) head.push(item);
    else rest.push(item);
  }
  head.sort(
    (a, b) =>
      (order.get(normalizeId(a.id)) ?? 0) - (order.get(normalizeId(b.id)) ?? 0),
  );
  return [...head, ...rest];
}
