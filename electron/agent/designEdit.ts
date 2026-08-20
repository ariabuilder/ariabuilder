/**
 * Design system write hub for the Design OS agent.
 * One execute body; legacy aria_* design tools map into these actions.
 */

import { z } from "zod";
import { agentToolFail, agentToolOk, type AgentToolResult } from "../../shared/agent";
import { hashRevision } from "../../shared/agent/revision";
import type { DesignPatch } from "../../shared/design";
import {
  expandTemplateToPalettes,
  getTemplate,
  listPaletteTemplates,
  THEME_PALETTE_ROLES,
} from "../../shared/paletteTemplates";
import {
  deleteDesignFont,
  applyDesignTokenMutation,
  getDesignSnapshot,
  importDesignFontBytes,
  patchDesignSystem,
  scanClassUsage,
} from "../design";
import {
  createClassPatch,
  deleteClassPatch,
  deleteCustomFontMetaPatch,
  disableFontPatch,
  duplicateClassPatch,
  enableGoogleFontPatch,
  enableFontsourceFontPatch,
  manageCssVariablesPatch,
  registerCustomFontPatch,
  updateClassRulePatch,
} from "./designManagerOps";
import { renameClassAcrossProject } from "./renameClassAcrossProject";
import type { AgentToolRuntime } from "./toolTypes";

const designPatchSchema = z
  .object({
    colors: z.record(z.string(), z.unknown()).optional(),
    variables: z.record(z.string(), z.unknown()).optional(),
    globalStyles: z.record(z.string(), z.unknown()).optional(),
    classes: z.array(z.unknown()).optional(),
    fonts: z.record(z.string(), z.unknown()).optional(),
    icons: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const cssVarDefinitionSchema = z
  .object({
    label: z.string().trim().min(1).max(200).optional(),
    value: z.string().trim().min(1).max(2000).optional(),
    category: z
      .enum([
        "color",
        "spacing",
        "typography",
        "borders",
        "effects",
        "layout",
        "other",
      ])
      .optional(),
    description: z.string().max(2000).optional(),
  })
  .strict();

const cssVarAliasSchema = z
  .object({
    label: z.string().trim().min(1).max(200).optional(),
    sourceType: z.enum(["token", "custom"]).optional(),
    sourceKey: z.string().trim().max(200).optional(),
    fallback: z.string().trim().max(2000).optional(),
  })
  .strict();

export const DESIGN_EDIT_ACTIONS = [
  "token_set",
  "apply_template",
  "set_primary_color",
  "patch",
  "class_create",
  "class_update",
  "class_rename",
  "class_delete",
  "class_duplicate",
  "font_enable",
  "fontsource_enable",
  "font_disable",
  "font_upload",
  "font_delete",
  "variable_set",
  "variable_unset",
  "regenerate_css",
] as const;

/** Object-rooted schema (provider-friendly); required fields enforced in execute. */
export const DesignEditInputSchema = z
  .object({
    action: z.enum(DESIGN_EDIT_ACTIONS),
    expectedRevision: z.string().trim().min(1).optional(),
    templateId: z.string().trim().min(1).max(100).optional(),
    previewOnly: z.boolean().optional(),
    color: z
      .string()
      .trim()
      .regex(/^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)
      .optional(),
    patch: designPatchSchema.optional(),
    name: z.string().trim().min(1).max(128).optional(),
    css: z.string().max(20_000).optional(),
    from: z.string().trim().min(1).max(128).optional(),
    to: z.string().trim().min(1).max(128).optional(),
    dryRun: z.boolean().optional(),
    sourceName: z.string().trim().min(1).max(128).optional(),
    family: z.string().trim().min(1).max(200).optional(),
    id: z.string().trim().min(1).max(200).optional(),
    variable: z.boolean().optional(),
    weights: z.array(z.number().int().min(100).max(900)).max(20).optional(),
    fileName: z.string().trim().min(1).max(255).optional(),
    bytesBase64: z.string().trim().min(1).max(60_000_000).optional(),
    file: z.string().trim().min(1).max(1024).optional(),
    operation: z
      .enum(["set_custom", "unset_custom", "set_alias", "unset_alias"])
      .optional(),
    key: z.string().trim().min(1).max(128).optional(),
    definition: cssVarDefinitionSchema.optional(),
    alias: cssVarAliasSchema.optional(),
    tokenId: z.string().trim().min(1).max(512).optional(),
    sourceId: z.string().trim().min(1).max(2048).optional(),
    sourceHash: z.string().trim().min(1).max(128).optional(),
    value: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

export type DesignEditInput = z.infer<typeof DesignEditInputSchema>;

function designRevision(snapshot: unknown): string {
  if (
    snapshot &&
    typeof snapshot === "object" &&
    typeof (snapshot as { revision?: unknown }).revision === "string"
  ) {
    return (snapshot as { revision: string }).revision;
  }
  return hashRevision(snapshot, "d");
}

function conflict(currentRevision: string): AgentToolResult<never> {
  return agentToolFail("CONFLICT", "The design system changed since it was read.", {
    suggestedFix: "Call aria_get_design_system again, then retry with the new revision.",
    currentVersion: currentRevision,
  });
}

function requireRevision(
  currentRevision: string,
  expectedRevision: string | undefined,
): AgentToolResult<never> | null {
  if (!expectedRevision) {
    return agentToolFail(
      "INVALID_INPUT",
      "expectedRevision is required for this design_edit action.",
    );
  }
  if (currentRevision !== expectedRevision) return conflict(currentRevision);
  return null;
}

function missing(field: string): AgentToolResult<never> {
  return agentToolFail("INVALID_INPUT", `design_edit requires ${field} for this action.`);
}

export async function executeDesignEdit(
  runtime: AgentToolRuntime,
  raw: DesignEditInput,
): Promise<AgentToolResult> {
  const current = getDesignSnapshot(runtime.projectPath);
  const currentRevision = designRevision(current);

  switch (raw.action) {
    case "token_set": {
      if (!raw.tokenId || !raw.sourceId || !raw.sourceHash || !raw.value) {
        return missing("tokenId, sourceId, sourceHash, and value");
      }
      const fence = requireRevision(currentRevision, raw.expectedRevision);
      if (fence) return fence;
      try {
        const result = await applyDesignTokenMutation(runtime.projectPath, {
          tokenId: raw.tokenId,
          sourceId: raw.sourceId,
          value: raw.value,
          expectedRevision: currentRevision,
          expectedSourceHash: raw.sourceHash,
        });
        return agentToolOk({
          changedFiles: result.changedFiles,
          tokenId: raw.tokenId,
          sourceId: raw.sourceId,
          revision: result.snapshot.revision,
          untrustedContent: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = message.startsWith("DESIGN_SOURCE_CONFLICT")
          ? "CONFLICT"
          : "INVALID_INPUT";
        return agentToolFail(code, message, {
          suggestedFix: "Read aria_get_design_system again and use a writable, unambiguous token source.",
          currentVersion: getDesignSnapshot(runtime.projectPath).revision,
        });
      }
    }
    case "apply_template": {
      if (!raw.templateId) return missing("templateId");
      const fence = requireRevision(currentRevision, raw.expectedRevision);
      if (fence) return fence;
      const template = getTemplate(raw.templateId);
      if (!template) {
        return agentToolFail("INVALID_INPUT", `Unknown template: ${raw.templateId}.`, {
          suggestedFix: `Use one of: ${listPaletteTemplates().map((item) => item.id).join(", ")}`,
        });
      }
      const expanded = expandTemplateToPalettes(template);
      const roleSet = new Set<string>(THEME_PALETTE_ROLES);
      const extras = current.colors.palettes.filter((palette) => !roleSet.has(palette.name));
      const palettes = [
        ...THEME_PALETTE_ROLES.map((role) => ({
          id: role,
          name: role,
          shades: { ...expanded[role] },
          source: "aria" as const,
        })),
        ...extras,
      ];
      if (raw.previewOnly) {
        return agentToolOk({
          preview: true,
          templateId: template.id,
          templateName: template.name,
          currentRevision,
          proposedPaletteNames: palettes.map((palette) => palette.name),
          semantic: template.semantic,
        });
      }
      const design = patchDesignSystem(runtime.projectPath, {
        colors: { palettes, semantic: template.semantic },
      });
      return agentToolOk({
        templateId: template.id,
        templateName: template.name,
        revision: designRevision(design),
        untrustedContent: true,
      });
    }
    case "set_primary_color": {
      if (!raw.color) return missing("color");
      const fence = requireRevision(currentRevision, raw.expectedRevision);
      if (fence) return fence;
      const color = raw.color.trim();
      const hex = color.startsWith("#") ? color : `#${color}`;
      const palettes = current.colors.palettes.map((palette) =>
        palette.name === "primary" || palette.id === "primary"
          ? {
              ...palette,
              shades: {
                ...palette.shades,
                "500": hex,
                DEFAULT: hex,
              },
            }
          : palette,
      );
      const hasPrimary = palettes.some(
        (palette) => palette.name === "primary" || palette.id === "primary",
      );
      if (!hasPrimary) {
        palettes.unshift({
          id: "primary",
          name: "primary",
          source: "site",
          shades: {
            "500": hex,
            DEFAULT: hex,
          },
        });
      }
      const design = patchDesignSystem(runtime.projectPath, {
        colors: { palettes, semantic: current.colors.semantic },
      });
      return agentToolOk({
        design,
        primaryColor: hex,
        revision: designRevision(design),
        untrustedContent: true,
      });
    }
    case "patch": {
      if (!raw.patch) return missing("patch");
      const fence = requireRevision(currentRevision, raw.expectedRevision);
      if (fence) return fence;
      const design = patchDesignSystem(runtime.projectPath, raw.patch as DesignPatch);
      return agentToolOk({
        design,
        revision: designRevision(design),
        untrustedContent: true,
      });
    }
    case "class_create": {
      if (!raw.name) return missing("name");
      const fence = requireRevision(currentRevision, raw.expectedRevision);
      if (fence) return fence;
      const built = createClassPatch(current, raw.name, raw.css);
      if (!built.ok) return agentToolFail("INVALID_INPUT", built.message);
      const design = patchDesignSystem(runtime.projectPath, built.patch);
      return agentToolOk({
        name: built.detail?.name,
        revision: designRevision(design),
        untrustedContent: true,
      });
    }
    case "class_update": {
      if (!raw.name || raw.css === undefined) return missing("name and css");
      const fence = requireRevision(currentRevision, raw.expectedRevision);
      if (fence) return fence;
      const built = updateClassRulePatch(current, raw.name, raw.css);
      if (!built.ok) return agentToolFail("INVALID_INPUT", built.message);
      const design = patchDesignSystem(runtime.projectPath, built.patch);
      return agentToolOk({
        name: raw.name,
        revision: designRevision(design),
        untrustedContent: true,
      });
    }
    case "class_rename": {
      if (!raw.from || !raw.to) return missing("from and to");
      if (!raw.expectedRevision) return missing("expectedRevision");
      if (raw.dryRun) {
        const preview = await renameClassAcrossProject({
          projectPath: runtime.projectPath,
          from: raw.from,
          to: raw.to,
          expectedRevision: raw.expectedRevision,
          dryRun: true,
        });
        if (!preview.ok) {
          return agentToolFail(preview.code, preview.message, {
            currentVersion: preview.currentVersion,
          });
        }
        return agentToolOk(preview);
      }
      const result = await renameClassAcrossProject({
        projectPath: runtime.projectPath,
        from: raw.from,
        to: raw.to,
        expectedRevision: raw.expectedRevision,
        dryRun: false,
      });
      if (!result.ok) {
        return agentToolFail(result.code, result.message, {
          currentVersion: result.currentVersion,
          suggestedFix: "Call aria_list_classes again and retry.",
        });
      }
      return agentToolOk(result);
    }
    case "class_delete": {
      if (!raw.name) return missing("name");
      const fence = requireRevision(currentRevision, raw.expectedRevision);
      if (fence) return fence;
      const usage = scanClassUsage(runtime.projectPath, [raw.name]);
      const built = deleteClassPatch(current, raw.name);
      if (!built.ok) return agentToolFail("INVALID_INPUT", built.message);
      const design = patchDesignSystem(runtime.projectPath, built.patch);
      return agentToolOk({
        name: raw.name,
        usageCount: usage[raw.name] ?? 0,
        revision: designRevision(design),
      });
    }
    case "class_duplicate": {
      if (!raw.sourceName) return missing("sourceName");
      const fence = requireRevision(currentRevision, raw.expectedRevision);
      if (fence) return fence;
      const before = new Set(current.classes.map((item) => item.name));
      const built = duplicateClassPatch(current, raw.sourceName, raw.name);
      if (!built.ok) return agentToolFail("INVALID_INPUT", built.message);
      const design = patchDesignSystem(runtime.projectPath, built.patch);
      const created = design.classes.find((item) => !before.has(item.name))?.name;
      return agentToolOk({
        sourceName: raw.sourceName,
        name: created ?? raw.name,
        revision: designRevision(design),
        untrustedContent: true,
      });
    }
    case "font_enable": {
      if (!raw.family) return missing("family");
      const fence = requireRevision(currentRevision, raw.expectedRevision);
      if (fence) return fence;
      const built = enableGoogleFontPatch(current, raw.family, raw.weights);
      if (!built.ok) return agentToolFail("INVALID_INPUT", built.message);
      const design = patchDesignSystem(runtime.projectPath, built.patch);
      return agentToolOk({
        ...built.detail,
        revision: designRevision(design),
      });
    }
    case "fontsource_enable": {
      if (!raw.id && !raw.family) return missing("id");
      const fence = requireRevision(currentRevision, raw.expectedRevision);
      if (fence) return fence;
      const built = enableFontsourceFontPatch(current, {
        id: raw.id,
        family: raw.family,
        variable: raw.variable,
      });
      if (!built.ok) return agentToolFail("INVALID_INPUT", built.message);
      const design = patchDesignSystem(runtime.projectPath, built.patch);
      return agentToolOk({
        ...built.detail,
        revision: designRevision(design),
      });
    }
    case "font_disable": {
      if (!raw.family) return missing("family");
      const fence = requireRevision(currentRevision, raw.expectedRevision);
      if (fence) return fence;
      const built = disableFontPatch(current, raw.family);
      if (!built.ok) return agentToolFail("INVALID_INPUT", built.message);
      const design = patchDesignSystem(runtime.projectPath, built.patch);
      return agentToolOk({
        ...built.detail,
        revision: designRevision(design),
      });
    }
    case "font_upload": {
      if (!raw.fileName || !raw.bytesBase64) return missing("fileName and bytesBase64");
      const fence = requireRevision(currentRevision, raw.expectedRevision);
      if (fence) return fence;
      let imported: { family: string; file: string };
      try {
        imported = importDesignFontBytes(runtime.projectPath, {
          fileName: raw.fileName,
          family: raw.family,
          bytes: Uint8Array.from(Buffer.from(raw.bytesBase64, "base64")),
        });
      } catch (error) {
        return agentToolFail(
          "INVALID_INPUT",
          error instanceof Error ? error.message : String(error),
        );
      }
      const built = registerCustomFontPatch(current, imported);
      if (!built.ok) return agentToolFail("INVALID_INPUT", built.message);
      const design = patchDesignSystem(runtime.projectPath, built.patch);
      return agentToolOk({
        family: imported.family,
        file: imported.file,
        revision: designRevision(design),
      });
    }
    case "font_delete": {
      if (!raw.file) return missing("file");
      const fence = requireRevision(currentRevision, raw.expectedRevision);
      if (fence) return fence;
      const built = deleteCustomFontMetaPatch(current, raw.file);
      if (!built.ok) return agentToolFail("INVALID_INPUT", built.message);
      try {
        deleteDesignFont(runtime.projectPath, raw.file);
      } catch (error) {
        return agentToolFail(
          "INVALID_INPUT",
          error instanceof Error ? error.message : String(error),
        );
      }
      const design = patchDesignSystem(runtime.projectPath, built.patch);
      return agentToolOk({
        file: raw.file,
        revision: designRevision(design),
      });
    }
    case "variable_set": {
      if (!raw.key || (raw.operation !== "set_custom" && raw.operation !== "set_alias")) {
        return missing("key and operation set_custom|set_alias");
      }
      const fence = requireRevision(currentRevision, raw.expectedRevision);
      if (fence) return fence;
      const built = manageCssVariablesPatch(current, {
        operation: raw.operation,
        key: raw.key,
        definition: raw.definition,
        alias: raw.alias,
      });
      if (!built.ok) return agentToolFail("INVALID_INPUT", built.message);
      const design = patchDesignSystem(runtime.projectPath, built.patch);
      return agentToolOk({
        ...built.detail,
        revision: designRevision(design),
        untrustedContent: true,
      });
    }
    case "variable_unset": {
      if (
        !raw.key ||
        (raw.operation !== "unset_custom" && raw.operation !== "unset_alias")
      ) {
        return missing("key and operation unset_custom|unset_alias");
      }
      const fence = requireRevision(currentRevision, raw.expectedRevision);
      if (fence) return fence;
      const built = manageCssVariablesPatch(current, {
        operation: raw.operation,
        key: raw.key,
      });
      if (!built.ok) return agentToolFail("INVALID_INPUT", built.message);
      const design = patchDesignSystem(runtime.projectPath, built.patch);
      return agentToolOk({
        ...built.detail,
        revision: designRevision(design),
        untrustedContent: true,
      });
    }
    case "regenerate_css": {
      const fence = requireRevision(currentRevision, raw.expectedRevision);
      if (fence) return fence;
      const design = patchDesignSystem(runtime.projectPath, {
        classes: current.classes.map((item) => ({ ...item, source: "aria" as const })),
        fonts: current.fonts,
        variables: current.variables,
      });
      return agentToolOk({
        revision: designRevision(design),
        regenerated: true,
      });
    }
    default: {
      const _exhaustive: never = raw.action;
      return agentToolFail(
        "INVALID_INPUT",
        `Unsupported design_edit action: ${String(_exhaustive)}`,
      );
    }
  }
}

export function designEditConfirmationSummary(input: unknown): string | null {
  const parsed = DesignEditInputSchema.safeParse(input);
  if (!parsed.success) return null;
  switch (parsed.data.action) {
    case "token_set":
      return `Update design token ${parsed.data.tokenId ?? ""} in its site source?`;
    case "apply_template":
      return `Apply design palette template ${parsed.data.templateId ?? ""}? Theme role palettes will be replaced.`;
    case "patch":
      return "Apply design system patch? This updates managed design CSS.";
    case "class_delete":
      return `Delete design class ${parsed.data.name ?? ""}? Astro class attributes are not rewritten.`;
    case "class_rename":
      return `Rename class ${parsed.data.from ?? ""} → ${parsed.data.to ?? ""} across the project?`;
    case "font_upload":
      return `Import custom font ${parsed.data.fileName ?? ""} into the project?`;
    case "font_delete":
      return `Delete custom font file ${parsed.data.file ?? ""}?`;
    case "regenerate_css":
      return "Regenerate managed global design CSS from the current snapshot?";
    default:
      return null;
  }
}

export function designEditRisk(
  input: unknown,
): "replace_content" | "delete_content" | undefined {
  const parsed = DesignEditInputSchema.safeParse(input);
  if (!parsed.success) return undefined;
  switch (parsed.data.action) {
    case "token_set":
    case "apply_template":
    case "patch":
    case "class_rename":
    case "font_upload":
    case "regenerate_css":
      return "replace_content";
    case "class_delete":
    case "font_delete":
      return "delete_content";
    default:
      return undefined;
  }
}
