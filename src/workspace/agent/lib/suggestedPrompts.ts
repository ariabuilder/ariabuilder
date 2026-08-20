import type { AgentComposerMode, AgentShellContext } from "../../../../shared/agent"

const ASK_PROMPTS = [
  "What can Aria Engineer do?",
  "Explain how Aria pages and components work",
  "What should I know about this site?",
] as const

const AGENT_PROMPTS = [
  "Review my site settings and recommend improvements",
  "Audit redirects for this project",
  "Summarize my design system",
  "List pages that might need SEO attention",
] as const

const PAGE_ASK_PROMPTS = [
  "Summarize this page",
  "Explain this page's structure",
  "What could be clearer here?",
] as const

const PAGE_AGENT_PROMPTS = [
  "Suggest improvements for this page",
  "Audit this page's SEO metadata",
  "What should I change next?",
] as const

export function agentSuggestedPrompts(
  context: AgentShellContext | undefined,
  mode: AgentComposerMode,
): string[] {
  if (context?.itemSlug) {
    return mode === "agent" ? [...PAGE_AGENT_PROMPTS] : [...PAGE_ASK_PROMPTS]
  }
  return mode === "agent" ? [...AGENT_PROMPTS] : [...ASK_PROMPTS]
}

export function agentEmptyStateGreeting(
  context: AgentShellContext | undefined,
  mode: AgentComposerMode,
): { title: string; subtitle: string } {
  if (context?.itemSlug) {
    const label = context.itemTitle ?? context.itemSlug
    if (mode === "agent") {
      return {
        title: `Edit, refine, or optimize ${label}`,
        subtitle:
          "Update SEO, page metadata, design, redirects, or site settings.",
      }
    }
    return {
      title: `Questions about ${label}?`,
      subtitle: "Ask about content, structure, or improvements.",
    }
  }

  if (mode === "agent") {
    return {
      title: "What should Aria do?",
      subtitle:
        "Review pages, update SEO, customize design, or manage redirects.",
    }
  }

  return {
    title: "How can I help with your site?",
    subtitle: "Ask about content, structure, or next steps.",
  }
}
