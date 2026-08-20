export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  aria_list_pages: "List pages",
  aria_list_components: "List components",
  aria_list_media: "List media",
  aria_list_redirects: "List redirects",
  aria_create_redirect: "Create redirect",
  aria_update_redirect: "Update redirect",
  aria_delete_redirect: "Delete redirect",
  aria_get_design_system: "Get design system",
  aria_get_site_context: "Get site context",
  aria_get_site_settings: "Get site settings",
  aria_update_site_settings: "Update site settings",
  aria_search_commands: "Search commands",
  aria_describe_command: "Describe command",
  aria_execute_command: "Run command",
  aria_save_document: "Save document",
  aria_delete_document: "Delete document",
  aria_update_layout_slots: "Update layout slots",
  open_in_composer: "Open in Composer",
  insert_nodes: "Insert content",
  insert_designed_section: "Insert designed section",
  aria_mutate_node: "Edit element",
  aria_update_node_classes: "Update element styles",
}

export function resolvedToolName(toolName: string, args: unknown): string {
  if (toolName !== "aria_execute_command") return toolName
  if (!args || typeof args !== "object" || Array.isArray(args)) return toolName
  const command = (args as Record<string, unknown>).command
  return typeof command === "string" && command.trim()
    ? command.trim()
    : toolName
}

export function toolDisplayName(toolName: string, isReadTool?: boolean): string {
  return (
    TOOL_DISPLAY_NAMES[toolName] ??
    (isReadTool ? "Review site" : "Apply update")
  )
}
