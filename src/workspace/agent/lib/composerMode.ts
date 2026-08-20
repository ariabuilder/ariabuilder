import type { AgentComposerMode } from "../../../../shared/agent"

export type AgentComposerModeDefinition = {
  id: AgentComposerMode
  label: string
  description: string
  placeholder: string
}

export const AGENT_COMPOSER_MODE_DEFINITIONS: readonly AgentComposerModeDefinition[] =
  [
    {
      id: "agent",
      label: "Agent",
      description: "Plan and take actions with tools",
      placeholder: "Ask Aria to change something…",
    },
    {
      id: "ask",
      label: "Ask",
      description: "Read-only answers about the site",
      placeholder: "Ask a question about your site…",
    },
  ]

export function getComposerModeDefinition(
  mode: AgentComposerMode,
): AgentComposerModeDefinition {
  return (
    AGENT_COMPOSER_MODE_DEFINITIONS.find((item) => item.id === mode) ??
    AGENT_COMPOSER_MODE_DEFINITIONS[0]!
  )
}
