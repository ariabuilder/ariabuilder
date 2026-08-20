import type { ComposerDocumentLaunchRequest } from "../../../shared/composer"
import { requestComposerDocumentLaunch } from "./composerDocumentLaunchRequest"

export type AgentComposerOpenRequest = {
  projectPath?: string
  file?: string
  route?: string
  kind?: "page" | "layout" | "component"
  name?: string
}

type OpenListener = (request: AgentComposerOpenRequest) => void

const listeners = new Set<OpenListener>()

export function onAgentComposerOpenRequest(listener: OpenListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Ask the workspace to switch into Composer and open a document.
 * Listeners handle rail/route selection; this helper queues the launch request.
 */
export function requestAgentComposerOpen(request: AgentComposerOpenRequest): void {
  for (const listener of listeners) listener(request)

  let launch: ComposerDocumentLaunchRequest | null = null
  if (request.route) {
    launch = { mode: "page", route: request.route }
  } else if (request.file) {
    const kind = request.kind === "layout" || request.kind === "component"
      ? request.kind
      : "component"
    const name =
      request.name?.trim() ||
      request.file.split("/").pop()?.replace(/\.astro$/i, "") ||
      "Document"
    launch = {
      mode: "standalone-component",
      kind,
      name,
      file: request.file,
    }
  }
  if (launch) requestComposerDocumentLaunch(launch, request.projectPath)
}

export function waitForComposerFile(
  getFile: () => string | null,
  expectedFile: string,
  timeoutMs = 4_000,
): Promise<boolean> {
  if (getFile() === expectedFile) return Promise.resolve(true)
  return new Promise((resolve) => {
    const started = Date.now()
    const timer = setInterval(() => {
      if (getFile() === expectedFile) {
        clearInterval(timer)
        resolve(true)
        return
      }
      if (Date.now() - started >= timeoutMs) {
        clearInterval(timer)
        resolve(false)
      }
    }, 50)
  })
}
