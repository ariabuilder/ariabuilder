export function shouldRejectIpcDuringShutdown(
  isQuitting: boolean,
  channel: string,
  allowedDuringShutdown = false,
): boolean {
  return isQuitting && channel !== "renderer:ready" && !allowedDuringShutdown;
}

