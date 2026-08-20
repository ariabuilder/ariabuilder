/**
 * Isomorphic ID generation — uses the Web Crypto API (`crypto.randomUUID`).
 */
export function generateId(): string {
  return crypto.randomUUID();
}
