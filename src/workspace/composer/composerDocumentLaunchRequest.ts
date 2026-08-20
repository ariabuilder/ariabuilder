import { reactive } from "vue"
import type { ComposerDocumentLaunchRequest } from "../../../shared/composer"

const DEFAULT_PROJECT = "__default__"
const pending = reactive(new Map<string, ComposerDocumentLaunchRequest>())
const launchTickets = reactive(new Map<string, number>())

function projectKey(projectPath?: string): string {
  return projectPath?.trim() || DEFAULT_PROJECT
}

export function requestComposerDocumentLaunch(
  request: ComposerDocumentLaunchRequest,
  projectPath?: string,
) {
  const key = projectKey(projectPath)
  pending.set(key, request)
  launchTickets.set(key, (launchTickets.get(key) ?? 0) + 1)
}

export function takeComposerDocumentLaunchRequest(
  projectPath?: string,
): ComposerDocumentLaunchRequest | null {
  const key = projectKey(projectPath)
  const request = pending.get(key) ?? null
  pending.delete(key)
  return request
}

export function peekComposerDocumentLaunchRequest(
  projectPath?: string,
): ComposerDocumentLaunchRequest | null {
  return pending.get(projectKey(projectPath)) ?? null
}

/** Reactive ticket for watchers — clearing pending does not change this. */
export function composerDocumentLaunchTicket(projectPath?: string): number {
  return launchTickets.get(projectKey(projectPath)) ?? 0
}
