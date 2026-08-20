import { DESKTOP_TOOL_NAMES } from "./desktopTools";

export const ARIA_DEMO_CANONICAL_TOOL_NAMES = [
  "aria_get_site_context",
  "aria_get_discovery_report",
  "aria_get_discovery_artifacts",
  "aria_get_discovery_baseline",
  "aria_get_analytics_availability",
  "aria_get_traffic_summary",
  "aria_get_site_traffic",
  "aria_get_pages_traffic",
  "aria_get_page_traffic",
  "aria_get_site_settings",
  "aria_get_localization_settings",
  "aria_list_redirects",
  "aria_list_media",
  "aria_get_media_usages",
  "aria_get_media_transform_state",
  "aria_list_media_sync_history",
  "aria_list_pages",
  "aria_read_page",
  "aria_list_page_versions",
  "aria_get_page_version",
  "aria_search_library",
  "aria_list_installed_library_packs",
  "aria_check_library_updates",
  "aria_list_site_exports",
  "aria_get_latest_site_export",
  "aria_get_content_sync_status",
  "aria_list_content_sync_history",
  "aria_list_components",
  "aria_read_component",
  "aria_list_layouts",
  "aria_read_layout",
  "aria_get_design_system",
  "aria_preview_design_system_patch",
  "aria_list_element_types",
  "aria_get_node_capabilities",
  "aria_list_fonts",
  "aria_get_font_config",
  "aria_list_classes",
  "aria_get_cms_inventory",
  "aria_list_collections",
  "aria_get_collection",
  "aria_list_entries",
  "aria_get_entry",
  "aria_get_entry_translation_context",
  "aria_query_entries",
  "aria_list_entry_revisions",
  "aria_get_entry_revision",
  "aria_compare_entry_revisions",
  "aria_get_entry_review",
  "aria_list_review_annotations",
  "aria_apply_design_system_patch",
  "aria_set_design_system_primary_color",
  "aria_save_design_system_colors",
  "aria_save_design_system_typography",
  "aria_save_design_system_global_styles",
  "aria_save_design_system_breakpoints",
  "aria_apply_design_system_template",
  "aria_update_site_settings",
  "aria_update_localization_settings",
  "aria_update_discovery_settings",
  "aria_update_appearance",
  "aria_update_icon_packs",
  "aria_install_library_pack",
  "aria_install_library_component",
  "aria_uninstall_library_pack",
  "aria_create_site_export",
  "aria_delete_site_export",
  "aria_plan_content_sync",
  "aria_apply_content_sync",
  "aria_update_page_meta",
  "aria_update_page_seo",
  "aria_create_page",
  "aria_create_layout",
  "aria_create_component",
  "aria_duplicate_document",
  "aria_save_document",
  "aria_delete_document",
  "aria_insert_nodes",
  "aria_mutate_node",
  "aria_update_node_motion",
  "aria_update_node_classes",
  "aria_replace_node",
  "aria_move_node",
  "aria_delete_node",
  "aria_update_layout_slots",
  "aria_attach_media_to_node",
  "aria_delete_media",
  "aria_rename_media",
  "aria_duplicate_media",
  "aria_import_media_from_url",
  "aria_set_page_cover",
  "aria_save_media_profile",
  "aria_save_media_transform_variant",
  "aria_delete_media_transform_variant",
  "aria_rebuild_media_usage_index",
  "aria_plan_media_sync",
  "aria_apply_media_sync",
  "aria_create_redirect",
  "aria_update_redirect",
  "aria_delete_redirect",
  "aria_update_entry_review",
  "aria_create_review_annotation",
  "aria_resolve_review_annotation",
  "aria_reopen_review_annotation",
  "aria_create_collection",
  "aria_update_collection",
  "aria_set_collection_template",
  "aria_clear_collection_template",
  "aria_delete_collection",
  "aria_create_entry",
  "aria_update_entry",
  "aria_save_entry_translation",
  "aria_duplicate_entry",
  "aria_delete_entry",
  "aria_restore_entry_revision",
  "aria_bind_node_field",
  "aria_set_container_loop",
  "aria_setup_blog",
  "aria_setup_tag_archive",
  "aria_setup_nav_collection",
  "aria_setup_config_collection",
  "aria_create_class",
  "aria_update_class_rule",
  "aria_remove_class_rule",
  "aria_delete_class",
  "aria_rename_class",
  "aria_duplicate_class",
  "aria_apply_class_to_nodes",
  "aria_update_class_pseudo_rule",
  "aria_manage_css_variables",
  "aria_regenerate_global_css",
  "aria_enable_google_font",
  "aria_disable_font",
  "aria_delete_custom_font",
  "aria_rename_custom_font",
  "aria_update_google_font_variants",
  "aria_publish_page",
  "aria_unpublish_page",
  "aria_archive_page",
  "aria_unarchive_page",
  "aria_publish_entry",
  "aria_unpublish_entry",
  "aria_archive_entry",
  "aria_get_system_status",
  "aria_get_cache_stats",
  "aria_get_cache_observability",
  "aria_list_users",
  "aria_list_email_connections",
  "aria_list_email_routes",
  "aria_get_email_outbox_overview",
  "aria_list_email_deliveries",
  "aria_get_auth_methods_config",
  "aria_get_two_factor_policy",
  "aria_get_platform_info",
  "aria_get_platform_metrics",
  // aria-demo client-plane capabilities are canonical even though their
  // historical names did not use the aria_ prefix.
  "open_in_composer",
  "insert_designed_section",
  "insert_nodes",
  "select_block",
  "update_node_motion",
  "upload_custom_font",
] as const;

export type AriaDemoCanonicalToolName =
  (typeof ARIA_DEMO_CANONICAL_TOOL_NAMES)[number];

export type AgentParityClassification =
  | "ported_main"
  | "ported_renderer"
  | "ported_partial"
  | "not_applicable_cloud"
  | "blocked_by_missing_domain";

export type AgentParityEntry = {
  name: AriaDemoCanonicalToolName;
  classification: AgentParityClassification;
  reason?: string;
  replacement?: string;
};

const rendererTools = new Set<string>([
  "open_in_composer",
  "insert_designed_section",
  "insert_nodes",
  "select_block",
  "aria_insert_nodes",
  "aria_mutate_node",
  "aria_update_node_classes",
  "aria_update_node_motion",
  "update_node_motion",
  "aria_attach_media_to_node",
  "aria_bind_node_field",
  "aria_set_container_loop",
  "aria_replace_node",
  "aria_move_node",
  "aria_delete_node",
]);

/** Registered but thinner than aria-demo; keep the ledger honest. */
const partialPorts = new Map<string, Pick<AgentParityEntry, "reason" | "replacement">>([
  [
    "aria_get_site_context",
    {
      reason: "Desktop site context includes inventory counts and styling flags but not cloud analytics/admin state.",
      replacement: "Use specialized list/read tools for full page, CMS, media, and design detail.",
    },
  ],
  [
    "aria_get_cms_inventory",
    {
      reason: "Includes schemas, counts, locales, and routing hints; not full relation graphs or page-usage indexes.",
      replacement: "Use aria_get_collection / aria_list_entries for deeper CMS detail.",
    },
  ],
  [
    "aria_preview_design_system_patch",
    {
      reason: "Returns revision-fenced summary diffs, not a full proposed snapshot clone.",
      replacement: "Apply with aria_apply_design_system_patch using expectedRevision from preview/get.",
    },
  ],
  [
    "aria_apply_design_system_patch",
    {
      reason: "Applies DesignPatch with revision fencing; specialty template apply and cross-file class rename remain separate.",
      replacement: "Use aria_create_class / aria_manage_css_variables / aria_enable_google_font for focused manager ops.",
    },
  ],
  [
    "aria_set_design_system_primary_color",
    {
      reason: "Updates primary palette DEFAULT/500 shades; does not regenerate a full perceptual shade ramp.",
      replacement: "Use aria_apply_design_system_patch for broader palette edits.",
    },
  ],
  [
    "aria_update_node_classes",
    {
      reason: "Supports replace/add/remove and breakpoint-prefixed utilities in the Astro class string; not managed custom-class records.",
      replacement: "Use aria_create_class / aria_update_class_rule for Design Manager classes.",
    },
  ],
  [
    "aria_mutate_node",
    {
      reason: "Supports set_text, set_tag, set_prop, and remove_prop only.",
      replacement: "Use aria_update_node_classes / aria_update_node_motion / aria_attach_media_to_node for specialized edits.",
    },
  ],
  [
    "aria_attach_media_to_node",
    {
      reason: "Attaches src/href/alt from asset path/id; does not own binary import or cover workflows.",
      replacement: "Use media inventory/profile tools for asset management; page covers remain blocked until a pages-meta cover field exists.",
    },
  ],
  [
    "aria_save_media_transform_variant",
    {
      reason: "Accepts base64 variant bytes plus crop metadata; does not generate pixels server-side.",
      replacement: "Produce variant bytes in the client/tooling pipeline before calling this tool.",
    },
  ],
  [
    "aria_delete_class",
    {
      reason: "Deletes the Design Manager class rule only; does not rewrite Astro class attributes across the project.",
      replacement: "Update node classes with aria_update_node_classes after deleting unused managed classes.",
    },
  ],
  [
    "aria_save_document",
    {
      reason: "Closed-document source save with mtime fencing; not a live Composer history entry and not a page-version store.",
      replacement: "Prefer live Composer mutate/insert tools when canClientInsert; use Project History for undo.",
    },
  ],
  [
    "aria_update_layout_slots",
    {
      reason: "Supports insert/rename/delete layout slots and page assign/rename-assignment ops with mtime fencing.",
      replacement: "Use live Composer layout slot UI when the document is already open.",
    },
  ],
  [
    "aria_regenerate_global_css",
    {
      reason: "Rewrites the managed Aria CSS block from the current snapshot; does not rebuild unrelated site stylesheets.",
      replacement: "Use aria_apply_design_system_patch for content changes that should also regenerate CSS.",
    },
  ],
  [
    "aria_rename_class",
    {
      reason: "Renames Design Manager class + rewrites .astro/.css class tokens; dynamic class:list expressions are best-effort.",
      replacement: "Use dryRun first; review rewrittenFiles before applying.",
    },
  ],
  [
    "upload_custom_font",
    {
      reason: "Imports font bytes into public/fonts and registers meta; does not open the native file dialog.",
      replacement: "Pass fileName + bytesBase64 from the client/tooling pipeline.",
    },
  ],
  [
    "aria_apply_design_system_template",
    {
      reason: "Applies built-in palette templates to theme roles; preserves non-theme palettes.",
      replacement: "Use aria_apply_design_system_patch for arbitrary palette surgery.",
    },
  ],
  [
    "aria_bind_node_field",
    {
      reason: "Live Composer bind/unbind for text nodes and props; requires an open editable document.",
      replacement: "Use Composer CMS inspector when the document is closed.",
    },
  ],
  [
    "aria_set_container_loop",
    {
      reason: "Live Composer wrap/unwrap for managed single-template collection loops.",
      replacement: "Use Composer CMS inspector for advanced loop editing.",
    },
  ],
]);

const cloudOnly = new Set<string>([
  "aria_get_entry_review",
  "aria_list_review_annotations",
  "aria_update_entry_review",
  "aria_create_review_annotation",
  "aria_resolve_review_annotation",
  "aria_reopen_review_annotation",
  "aria_get_system_status",
  "aria_get_cache_stats",
  "aria_get_cache_observability",
  "aria_list_users",
  "aria_list_email_connections",
  "aria_list_email_routes",
  "aria_get_email_outbox_overview",
  "aria_list_email_deliveries",
  "aria_get_auth_methods_config",
  "aria_get_two_factor_policy",
  "aria_get_platform_info",
  "aria_get_platform_metrics",
]);

const ported = new Set<string>(DESKTOP_TOOL_NAMES);

function blockedDesktopReason(name: string): Pick<AgentParityEntry, "reason" | "replacement"> {
  if (/traffic|analytics_availability/.test(name)) {
    return {
      reason: "aria-app has analytics configuration but no local traffic-query service for this report.",
      replacement: "Configure analytics in Site Settings and use the provider's reporting surface.",
    };
  }
  if (/content_sync|library|media_sync/.test(name)) {
    return {
      reason: "The desktop product has no equivalent sync or package-library lifecycle service.",
      replacement: "No placeholder is exposed; use the existing Studio workflow where one exists.",
    };
  }
  if (/review|annotation/.test(name)) {
    return {
      reason: "Multi-user review state is outside the local single-user desktop model.",
      replacement: "Use hosted review workflows when available.",
    };
  }
  if (/design|class|css_variable|font|icon_pack|appearance/.test(name)) {
    return {
      reason: "The current desktop design service does not yet provide this exact revision-fenced operation.",
      replacement: "Read the design snapshot and make the change in the Design workspace.",
    };
  }
  if (/page|layout|component|document/.test(name)) {
    return {
      reason: "The workspace service does not yet provide this exact document lifecycle operation with conflict protection.",
      replacement: "Use registered document inventory, read, create, and confirmed-delete tools or Composer for live edits.",
    };
  }
  if (/media/.test(name)) {
    return {
      reason: "The media service does not yet provide this exact safe desktop operation or required binary input path.",
      replacement: "Use registered media inventory, usage, profile, transform, rename, duplicate, and confirmed-delete tools.",
    };
  }
  if (/localization|translation/.test(name)) {
    return {
      reason: "The desktop localization settings service does not implement this configuration operation.",
      replacement: "Entry translation is available; configure site-wide locale behavior in the current UI.",
    };
  }
  return {
    reason: "aria-app does not yet expose this exact capability through a validated desktop domain service.",
    replacement: "No placeholder is exposed; use the corresponding existing desktop surface.",
  };
}

function classify(name: AriaDemoCanonicalToolName): AgentParityEntry {
  if (ported.has(name)) {
    const partial = partialPorts.get(name);
    if (partial) {
      return {
        name,
        classification: "ported_partial",
        ...partial,
      };
    }
    return {
      name,
      classification: rendererTools.has(name) ? "ported_renderer" : "ported_main",
    };
  }
  if (cloudOnly.has(name)) {
    return {
      name,
      classification: "not_applicable_cloud",
      reason: "Depends on cloud administration, multi-user review, auth, or email services that are outside desktop parity.",
      replacement: "No placeholder is exposed. Use the corresponding hosted Aria administration surface when available.",
    };
  }
  return {
    name,
    classification: "blocked_by_missing_domain",
    ...blockedDesktopReason(name),
  };
}

export const AGENT_PARITY_MANIFEST: readonly AgentParityEntry[] =
  ARIA_DEMO_CANONICAL_TOOL_NAMES.map(classify);

export function parityEntry(name: string): AgentParityEntry | undefined {
  return AGENT_PARITY_MANIFEST.find((entry) => entry.name === name);
}
