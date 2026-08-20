import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import type {
  AgentComposerMode,
  AgentConfirmationCategory,
  AgentToolResult,
} from "../../shared/agent";
import { agentToolFail, agentToolOk } from "../../shared/agent";
import {
  finalizeToolDescriptor,
  type AgentToolDescriptor,
  type AgentToolRuntime,
  type RendererToolExecutor,
} from "./toolTypes";
import {
  CreateEntryRequestSchema,
  CollectionSupportSchema,
  EntryListRequestSchema,
  FieldSchemaInputSchema,
  UpdateEntryRequestSchema,
  generateId,
} from "../../shared/cms";
import { readCollections } from "../collections";
import { assessCollectionMigration, listExternalEntries, readCollectionRegistry, readCollectionRegistryWithCache } from "../collectionRegistry";
import { createHandoffDraft } from "../cms/handoffDrafts";
import {
  archiveEntry,
  createEntry,
  deleteCollections,
  deleteEntry,
  duplicateEntry,
  getEntry,
  listEntries,
  listRevisions,
  publishEntry,
  writeCollectionsWithContentConfig,
  restoreRevision,
  runCmsTransaction,
  seedBlogCms,
  unpublishEntry,
  updateEntry,
} from "../cms";
import {
  importMarkdownToEntry,
  previewImportMarkdown,
} from "../cms/markdownImport";
import { getDesignSnapshot, scanClassUsage } from "../design";
import { hashRevision } from "../../shared/agent/revision";
import {
  summarizeDesignClasses,
  summarizeDesignFonts,
} from "./designManagerOps";
import {
  DesignEditInputSchema,
  designEditConfirmationSummary,
  designEditRisk,
  executeDesignEdit,
} from "./designEdit";
import {
  duplicateDocument,
  saveClosedDocument,
  updateLayoutSlots,
} from "./documentLifecycleOps";
import {
  deleteMedia,
  duplicateMedia,
  listMedia,
  listMediaUsages,
  renameMedia,
} from "../media";
import {
  deleteMediaVariant,
  getMediaTransformState,
  saveMediaProfile,
  saveMediaVariant,
} from "../mediaTransforms";
import { runProjectMutation } from "../mutations";
import { readPagesMeta, writePagesMeta } from "../pagesMeta";
import {
  createRedirect,
  deleteRedirect,
  readRedirects,
  updateRedirect,
} from "../redirects";
import {
  readSiteSettings,
  updateDiscoverySettings,
  writeSiteSettings,
} from "../siteSettings";
import {
  createSiteExport,
  deleteSiteExport,
  getLatestSiteExport,
  listSiteExports,
} from "../export";
import { CreateSiteExportInputSchema } from "../../shared/export";
import {
  createComponent,
  createLayout,
  createPage,
  deleteComponent,
  deletePage,
  scanProject,
} from "../workspace";
import { canonicalDirectory, resolveWithinRoot } from "../pathSafety";
import { loadDiscoveryContext } from "../loadDiscoveryContext";
import {
  buildDiscoveryArtifacts,
  buildDiscoveryReport,
  buildGeneratedDiscoveryBaseline,
  DiscoveryGeneratedBaselineSchema,
} from "../../shared/crawl";
import { AGENT_PARITY_MANIFEST, parityEntry } from "../../shared/agent/parity";
import type { DesignPatch } from "../../shared/design";
import {
  getComposerNodeCapabilities,
  listComposerElementTypes,
} from "../../shared/composer/agentNodeNormalizer";
import {
  describeAvailableCommand,
  searchAvailableCommands,
} from "./runtimeRegistry";
import { adminResourceDescriptors } from "./resources";

export type { AgentToolDescriptor, AgentToolRuntime, RendererToolExecutor };

const MAX_ACTIVITY_BYTES = 2 * 1024 * 1024;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") {
    return typeof value === "string" && value.length > 500
      ? `${value.slice(0, 500)}…`
      : value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      /(?:key|token|secret|password|authorization)/i.test(key)
        ? "[redacted]"
        : redact(item),
    ]),
  );
}

function logActivity(
  runtime: AgentToolRuntime,
  descriptor: AgentToolDescriptor,
  input: unknown,
  result: AgentToolResult,
): void {
  try {
    const directory = path.join(runtime.userData, "agent");
    mkdirSync(directory, { recursive: true });
    const file = path.join(directory, "activity.jsonl");
    if (existsSync(file) && statSync(file).size >= MAX_ACTIVITY_BYTES) {
      const previous = `${file}.1`;
      rmSync(previous, { force: true });
      renameSync(file, previous);
    }
    appendFileSync(
      file,
      `${JSON.stringify({
        at: new Date().toISOString(),
        projectPath: runtime.projectPath,
        webContentsId: runtime.webContentsId,
        tool: descriptor.name,
        mutation: descriptor.mutation,
        input: redact(input),
        outcome: result.ok ? "success" : result.error.code,
      })}\n`,
      { encoding: "utf8", flag: "a" },
    );
  } catch {
    // best effort
  }
}

function mapToolError(error: unknown): AgentToolResult<never> {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("VERSION_CONFLICT:")) {
    return agentToolFail("VERSION_CONFLICT", "The content changed since it was read.", {
      currentVersion: message.slice("VERSION_CONFLICT:".length),
      suggestedFix: "Read the latest version and retry with that version.",
    });
  }
  if (message === "CONFLICT" || message.includes("version")) {
    return agentToolFail("CONFLICT", "The content changed since it was read.", {
      suggestedFix: "Read the latest state and retry with its current revision.",
    });
  }
  if (message.startsWith("CONTENT_IN_USE:")) {
    return agentToolFail("CONTENT_IN_USE", message.slice("CONTENT_IN_USE:".length).trim(), {
      suggestedFix: "Remove the listed inbound references and retry.",
    });
  }
  if (/not found/i.test(message)) return agentToolFail("NOT_FOUND", message);
  if (/validation|slug already|requires at least/i.test(message)) {
    return agentToolFail("INVALID_INPUT", message);
  }
  return agentToolFail("INTERNAL", message);
}

function summarizeEntry(record: ReturnType<typeof getEntry>) {
  if (!record) return null;
  return {
    ...record,
    untrustedContent: true,
  };
}

function collectionRevision(state: ReturnType<typeof readCollections>): string {
  // The persisted format remains unchanged. The canonical JSON snapshot is the
  // optimistic-concurrency fence for whole-file collection mutations.
  const text = JSON.stringify(state);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `c-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function snapshotRevision(state: unknown, prefix = "s"): string {
  if (
    prefix === "d" &&
    state &&
    typeof state === "object" &&
    typeof (state as { revision?: unknown }).revision === "string"
  ) {
    return (state as { revision: string }).revision;
  }
  return hashRevision(state, prefix);
}

function sourceLocaleContentHash(source: {
  locale: string;
  title: string;
  slug: string;
  frontmatter: Record<string, unknown>;
  body?: unknown;
}): string {
  return snapshotRevision(
    {
      locale: source.locale,
      title: source.title,
      slug: source.slug,
      frontmatter: source.frontmatter,
      body: source.body ?? null,
    },
    "content",
  );
}

async function readScannedDocument(
  projectPath: string,
  kind: "page" | "component" | "layout",
  file: string,
): Promise<AgentToolResult> {
  const scan = await scanProject(projectPath);
  const candidates = kind === "page" ? scan.pages : kind === "layout" ? scan.layouts : scan.components;
  const found = candidates.find((candidate) => candidate.file === file);
  if (!found) return agentToolFail("NOT_FOUND", `${kind} not found: ${file}`);
  const root = canonicalDirectory(projectPath);
  const absolute = resolveWithinRoot(root, path.join(root, found.file), {
    rejectFinalSymlink: true,
  });
  const stat = statSync(absolute);
  if (stat.size > 512 * 1024) {
    return agentToolFail("INVALID_INPUT", "The document is too large for agent context.");
  }
  return agentToolOk({
    kind,
    file: found.file,
    mtimeMs: stat.mtimeMs,
    content: readFileSync(absolute, "utf8"),
    untrustedContent: true,
  });
}

function assertCollectionRevision(
  state: ReturnType<typeof readCollections>,
  expected: string,
): void {
  if (collectionRevision(state) !== expected) throw new Error("CONFLICT");
}

function descriptor(
  value: Parameters<typeof finalizeToolDescriptor>[0],
): AgentToolDescriptor {
  return finalizeToolDescriptor(value);
}

const emptyInput = z.object({}).strict();
const entryIdentity = z
  .object({
    collectionId: z.string().trim().min(1),
    entryId: z.string().trim().min(1),
  })
  .strict();
const versionedEntryIdentity = entryIdentity.extend({
  version: z.string().trim().min(1),
});
const agentCreateEntrySchema = CreateEntryRequestSchema.omit({
  commentsClosed: true,
  status: true,
});
const agentUpdateEntrySchema = UpdateEntryRequestSchema.extend({
  patch: UpdateEntryRequestSchema.shape.patch.omit({
    commentsClosed: true,
    status: true,
    translationMeta: true,
  }),
});
const agentSaveTranslationSchema = versionedEntryIdentity.extend({
  locale: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(500),
  slug: z.string().trim().min(1).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  frontmatter: z.record(z.string(), z.unknown()),
  body: z.unknown().nullable(),
  sourceLocale: z.string().trim().min(1).max(40),
  sourceContentHash: z.string().trim().min(1).max(256),
  translatedFieldPaths: z.array(z.string().trim().min(1).max(500)).max(500).default([]),
});

const rendererInsertTarget = z
  .object({
    parentPath: z.string().nullable().optional(),
    index: z.number().int().nonnegative(),
  })
  .strict();

const rendererPropValue = z
  .object({
    type: z.enum([
      "string",
      "expr",
      "bare",
      "spread",
      "shorthand",
      "template-literal",
    ]),
    value: z.string().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.type === "bare" && value.value !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Bare properties cannot include a value",
      });
    }
    if (value.type !== "bare" && value.value === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: `${value.type} properties require a value`,
      });
    }
  });

const rendererConditionSet = z.object({
  version: z.literal(1),
  groups: z.array(z.object({
    id: z.string().min(1).max(200),
    rules: z.array(z.object({
      id: z.string().min(1).max(200),
      source: z.object({
        provider: z.string().min(1).max(100),
        path: z.array(z.string().max(300)).max(20),
      }).strict(),
      operator: z.enum(["equals", "not-equals", "contains", "not-contains", "is-empty", "is-set", "greater-than", "less-than", "before", "after"]),
      value: z.unknown().optional(),
    }).strict()).min(1).max(20),
  }).strict()).min(1).max(10),
}).strict();

const rendererMutateNodeSchema = z
  .object({
    path: z.string().min(1),
    operation: z.enum(["set_text", "set_tag", "set_prop", "remove_prop"]),
    value: z.union([z.string().max(100_000), rendererPropValue]).optional(),
    propName: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.operation === "set_text") {
      if (typeof value.value !== "string") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["value"],
          message: "set_text requires a string value",
        });
      }
      if (value.propName !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["propName"],
          message: "set_text does not accept a property name",
        });
      }
      return;
    }
    if (value.operation === "set_tag") {
      const parsed = z.string().trim().min(1).max(100).safeParse(value.value);
      if (!parsed.success) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["value"],
          message: "set_tag requires a non-empty tag name",
        });
      }
      if (value.propName !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["propName"],
          message: "set_tag does not accept a property name",
        });
      }
      return;
    }
    if (!value.propName) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["propName"],
        message: `${value.operation} requires a property name`,
      });
    }
    if (
      value.operation === "set_prop" &&
      !rendererPropValue.safeParse(value.value).success
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "set_prop requires a valid Composer property value",
      });
    }
    if (value.operation === "remove_prop" && value.value !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "remove_prop does not accept a value",
      });
    }
  })
  .transform((value) =>
    value.operation === "set_tag" && typeof value.value === "string"
      ? { ...value, value: value.value.trim() }
      : value,
  );

function rendererInputSchema(name: string): z.ZodType {
  if (name === "open_in_composer") {
    return z
      .object({
        file: z.string().min(1).optional(),
        route: z.string().min(1).optional(),
        kind: z.enum(["page", "layout", "component"]).optional(),
        name: z.string().min(1).optional(),
      })
      .strict();
  }
  if (name === "select_block") {
    return z
      .object({
        path: z.string().min(1).optional(),
        blockId: z.string().min(1).optional(),
        occurrence: z.number().int().nonnegative().optional(),
      })
      .strict()
      .refine((value) => Boolean(value.path || value.blockId), {
        message: "A Composer marker path or node id is required",
      });
  }
  if (name === "insert_designed_section") {
    // Non-recursive unknown trees — providers reject Zod lazy $ref schemas.
    // Nested validation happens in the Astro agent node normalizer.
    return z
      .object({ node: z.unknown(), target: rendererInsertTarget.optional() })
      .strict();
  }
  if (name === "aria_mutate_node") {
    // Some OpenAI-compatible providers require a top-level `type: "object"`
    // and reject union-rooted function schemas even when every union branch is
    // an object. Keep the operation-specific constraints as runtime refinements.
    return rendererMutateNodeSchema;
  }
  if (name === "aria_update_node_classes") {
    return z
      .object({
        path: z.string().min(1).optional(),
        blockId: z.string().min(1).optional(),
        classes: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
        add: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
        remove: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
        classNames: z
          .record(z.string(), z.array(z.string().trim().min(1).max(200)).max(50))
          .optional(),
      })
      .strict()
      .refine((value) => Boolean(value.path || value.blockId), {
        message: "A Composer marker path or node id is required",
      })
      .refine(
        (value) =>
          Boolean(
            value.classes?.length ||
              value.add?.length ||
              value.remove?.length ||
              (value.classNames && Object.keys(value.classNames).length),
          ),
        { message: "Provide classes, add/remove, or classNames" },
      );
  }
  if (name === "aria_update_node_motion" || name === "update_node_motion") {
    return z
      .object({
        path: z.string().min(1).optional(),
        blockId: z.string().min(1).optional(),
        motion: z.record(z.string(), z.unknown()),
      })
      .strict()
      .refine((value) => Boolean(value.path || value.blockId), {
        message: "A Composer marker path or node id is required",
      });
  }
  if (name === "aria_attach_media_to_node") {
    return z
      .object({
        path: z.string().min(1).optional(),
        blockId: z.string().min(1).optional(),
        src: z.string().min(1).optional(),
        assetPath: z.string().min(1).optional(),
        assetId: z.string().min(1).optional(),
        alt: z.string().max(2000).optional(),
      })
      .strict()
      .refine((value) => Boolean(value.path || value.blockId), {
        message: "A Composer marker path or node id is required",
      })
      .refine((value) => Boolean(value.src || value.assetPath || value.assetId), {
        message: "src, assetPath, or assetId is required",
      });
  }
  if (name === "aria_bind_node_field") {
    return z
      .object({
        path: z.string().min(1).optional(),
        blockId: z.string().min(1).optional(),
        mode: z.enum(["context", "entry"]).optional(),
        target: z.union([
          z.literal("text"),
          z.object({ prop: z.string().trim().min(1).max(200) }).strict(),
        ]),
        field: z.string().trim().min(1).max(200).optional(),
        format: z
          .enum(["plain", "date-short", "date-long", "number", "url"])
          .optional(),
        contextVariable: z.string().trim().min(1).max(200).optional(),
        collection: z.string().trim().min(1).max(200).optional(),
        entrySlug: z.string().trim().min(1).max(500).optional(),
        queryId: z.string().trim().min(1).max(200).optional(),
        unbind: z.boolean().optional(),
      })
      .strict()
      .refine((value) => Boolean(value.path || value.blockId), {
        message: "A Composer marker path or node id is required",
      });
  }
  if (name === "aria_set_container_loop") {
    return z
      .object({
        path: z.string().min(1).optional(),
        blockId: z.string().min(1).optional(),
        operation: z.enum(["wrap", "unwrap"]).default("wrap"),
        collection: z.string().trim().min(1).max(200).optional(),
        entryVariable: z.string().trim().min(1).max(100).optional(),
        queryId: z.string().trim().min(1).max(200).optional(),
        filters: z
          .array(
            z
              .object({
                field: z.string().trim().min(1).max(200),
                operator: z.enum([
                  "equals",
                  "notEquals",
                  "contains",
                  "greaterThan",
                  "lessThan",
                  "exists",
                ]),
                value: z.union([z.string(), z.number(), z.boolean()]).optional(),
              })
              .strict(),
          )
          .max(20)
          .optional(),
        sort: z
          .object({
            field: z.string().trim().min(1).max(200),
            direction: z.enum(["asc", "desc"]).default("asc"),
          })
          .strict()
          .optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .strict()
      .refine((value) => Boolean(value.path || value.blockId), {
        message: "A Composer marker path or node id is required",
      });
  }
  if (name === "aria_get_node_condition") {
    return z.object({
      path: z.string().min(1).optional(),
      blockId: z.string().min(1).optional(),
    }).strict().refine((value) => Boolean(value.path || value.blockId), {
      message: "A Composer marker path or node id is required",
    });
  }
  if (name === "aria_set_node_condition") {
    return z.object({
      path: z.string().min(1).optional(),
      blockId: z.string().min(1).optional(),
      condition: rendererConditionSet,
      otherwise: z.boolean().optional(),
    }).strict().refine((value) => Boolean(value.path || value.blockId), {
      message: "A Composer marker path or node id is required",
    });
  }
  if (name === "aria_remove_node_condition") {
    return z.object({
      path: z.string().min(1).optional(),
      blockId: z.string().min(1).optional(),
      keep: z.enum(["shown", "otherwise", "both"]).default("shown"),
    }).strict().refine((value) => Boolean(value.path || value.blockId), {
      message: "A Composer marker path or node id is required",
    });
  }
  if (name === "aria_replace_node") {
    return z.object({ path: z.string().min(1), node: z.unknown() }).strict();
  }
  if (name === "aria_move_node") {
    return z.object({ path: z.string().min(1), target: rendererInsertTarget }).strict();
  }
  if (name === "aria_delete_node") {
    return z.object({ path: z.string().min(1) }).strict();
  }
  return z
    .object({
      nodes: z.array(z.unknown()).min(1).max(100),
      target: rendererInsertTarget.optional(),
    })
    .strict();
}

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

const registry: AgentToolDescriptor[] = [
  descriptor({
    name: "aria_get_site_context",
    description: "Summarize site identity, pages/CMS/media inventory counts, discovery, and local capability state.",
    inputSchema: emptyInput,
    executionPlane: "main",
    mutation: "read",
    async execute(runtime) {
      const settings = readSiteSettings(runtime.projectPath);
      const scan = await scanProject(runtime.projectPath);
      const collections = readCollections(runtime.projectPath);
      const media = listMedia(runtime.projectPath);
      const redirects = readRedirects(runtime.projectPath);
      const cmsEntryCounts = collections.collections.map((collection) => {
        const listed = listEntries(runtime.projectPath, {
          collectionId: collection.id,
          limit: 1,
        });
        return { collectionId: collection.id, total: listed.total };
      });
      return agentToolOk({
        siteName: settings.siteName,
        siteDescription: settings.siteDescription,
        siteUrl: settings.siteUrl,
        timeZone: settings.timeZone,
        hasDiscovery: Boolean(settings.discovery),
        discovery: settings.discovery
          ? {
              sitemapMode: settings.discovery.sitemapMode,
              robotsMode: settings.discovery.robotsMode,
              llmsMode: settings.discovery.llmsMode,
            }
          : null,
        agentConfigured: Boolean(settings.agent),
        settingsRevision: snapshotRevision(
          {
            siteName: settings.siteName,
            siteDescription: settings.siteDescription,
            siteUrl: settings.siteUrl,
            discovery: settings.discovery,
          },
          "s",
        ),
        styling: {
          utilityClassesAllowed: true,
          breakpoints: ["sm", "md", "lg", "xl", "2xl"],
        },
        pages: {
          count: scan.pages.length,
          routes: scan.pages.slice(0, 40).map((page) => page.route),
        },
        components: { count: scan.components.length },
        layouts: { count: scan.layouts.length },
        cms: {
          collectionCount: collections.collections.length,
          collectionIds: collections.collections.map((collection) => collection.id),
          entryCounts: cmsEntryCounts,
        },
        media: {
          count: media.length,
          recent: media.slice(0, 8).map((asset) => ({
            id: asset.id,
            name: asset.name,
            path: asset.id,
          })),
        },
        redirects: { count: redirects.length },
        capabilities: {
          composer: true,
          design: true,
          cms: true,
          mcpEnabled: false,
        },
      });
    },
  }),
  descriptor({
    name: "aria_get_site_settings",
    description: "Read site settings without agent settings or credentials.",
    inputSchema: emptyInput,
    executionPlane: "main",
    mutation: "read",
    execute(runtime) {
      const { agent: _agent, ...settings } = readSiteSettings(runtime.projectPath);
      return agentToolOk(settings);
    },
  }),
  descriptor({
    name: "aria_update_site_settings",
    description: "Update the site name, description, or canonical URL.",
    inputSchema: z
      .object({
        siteName: z.string().max(200).optional(),
        siteDescription: z.string().max(2_000).optional(),
        siteUrl: z.string().max(2_048).optional(),
      })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    async execute(runtime, input) {
      const current = readSiteSettings(runtime.projectPath);
      const next = writeSiteSettings(runtime.projectPath, { ...current, ...input });
      return agentToolOk({
        siteName: next.siteName,
        siteDescription: next.siteDescription,
        siteUrl: next.siteUrl,
      });
    },
  }),
  descriptor({
    name: "aria_list_redirects",
    description: "List redirect rules.",
    inputSchema: emptyInput,
    executionPlane: "main",
    mutation: "read",
    execute: (runtime) => agentToolOk({ redirects: readRedirects(runtime.projectPath) }),
  }),
  descriptor({
    name: "aria_create_redirect",
    description: "Create a redirect rule.",
    inputSchema: z
      .object({
        fromPath: z.string().trim().min(1).max(512),
        toPath: z.string().trim().min(1).max(2_048),
        statusCode: z.union([z.literal(301), z.literal(302)]).default(301),
      })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    async execute(runtime, input) {
      return agentToolOk({
        redirect: await createRedirect(runtime.projectPath, {
          ...input,
          enabled: true,
        }),
      });
    },
  }),
  descriptor({
    name: "aria_update_redirect",
    description: "Update a redirect rule by id.",
    inputSchema: z
      .object({
        id: z.string().trim().min(1),
        fromPath: z.string().max(512).optional(),
        toPath: z.string().max(2_048).optional(),
        statusCode: z.union([z.literal(301), z.literal(302)]).optional(),
        enabled: z.boolean().optional(),
      })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    async execute(runtime, input) {
      return agentToolOk({
        redirect: await updateRedirect(runtime.projectPath, input),
      });
    },
  }),
  descriptor({
    name: "aria_delete_redirect",
    description: "Delete a redirect rule by id.",
    inputSchema: z.object({ id: z.string().trim().min(1) }).strict(),
    executionPlane: "main",
    mutation: "write",
    risk: "delete_content",
    confirmationSummary: (input) =>
      `Delete redirect ${(input as { id: string }).id}? This removes the redirect rule.`,
    async execute(runtime, input) {
      await deleteRedirect(runtime.projectPath, input.id);
      return agentToolOk({ deleted: true, id: input.id });
    },
  }),
  ...(["pages", "components"] as const).map((kind) =>
    descriptor({
      name: kind === "pages" ? "aria_list_pages" : "aria_list_components",
      description: `List ${kind} discovered in the workspace.`,
      inputSchema: emptyInput,
      executionPlane: "main",
      mutation: "read",
      async execute(runtime) {
        const scan = await scanProject(runtime.projectPath);
        const pageMeta = kind === "pages" ? readPagesMeta(runtime.projectPath) : null;
        return agentToolOk({
          [kind]: kind === "pages"
            ? scan.pages.map(({ route, file, title, mtimeMs }) => ({ route, file, title, mtimeMs }))
            : scan.components.map(({ id, name, file, mtimeMs }) => ({ id, name, file, mtimeMs })),
          ...(pageMeta
            ? {
                meta: pageMeta.pages,
                metaRevision: snapshotRevision(pageMeta, "p"),
              }
            : {}),
        });
      },
    }),
  ),
  descriptor({
    name: "aria_list_layouts",
    description: "List Astro layouts discovered in the workspace.",
    inputSchema: emptyInput,
    executionPlane: "main",
    mutation: "read",
    async execute(runtime) {
      const scan = await scanProject(runtime.projectPath);
      return agentToolOk({ layouts: scan.layouts.map(({ id, name, file, mtimeMs }) => ({ id, name, file, mtimeMs })) });
    },
  }),
  ...(["page", "component", "layout"] as const).map((kind) =>
    descriptor({
      name: kind === "page" ? "aria_read_page" : kind === "component" ? "aria_read_component" : "aria_read_layout",
      description: `Read one bounded ${kind} source file as untrusted project content.`,
      inputSchema: z.object({ file: z.string().trim().min(1).max(1024) }).strict(),
      executionPlane: "main",
      mutation: "read",
      execute: (runtime, input) => readScannedDocument(runtime.projectPath, kind, input.file),
    }),
  ),
  ...(["aria_update_page_meta", "aria_update_page_seo"] as const).map((name) =>
    descriptor({
      name,
      description: name === "aria_update_page_seo" ? "Update fenced per-page SEO metadata." : "Update fenced page title and description metadata.",
      inputSchema: z.object({
        file: z.string().trim().min(1).max(1024),
        expectedRevision: z.string().trim().min(1),
        patch: name === "aria_update_page_seo"
          ? z.object({
              title: z.string().max(300).optional(),
              description: z.string().max(1000).optional(),
              canonical: z.string().max(2000).optional(),
              noindex: z.boolean().optional(),
              nofollow: z.boolean().optional(),
              ogTitle: z.string().max(300).optional(),
              ogDescription: z.string().max(1000).optional(),
              ogImage: z.string().max(2000).optional(),
            }).strict()
          : z.object({ title: z.string().max(300).optional(), description: z.string().max(1000).optional() }).strict(),
      }).strict(),
      executionPlane: "main",
      mutation: "write",
      execute(runtime, input) {
        const current = readPagesMeta(runtime.projectPath);
        if (snapshotRevision(current, "p") !== input.expectedRevision) throw new Error("CONFLICT");
        const record = current.pages[input.file] ?? {};
        const nextRecord = name === "aria_update_page_seo"
          ? { ...record, seo: { ...(record.seo ?? {}), ...input.patch } }
          : { ...record, ...input.patch };
        const next = writePagesMeta(runtime.projectPath, { pages: { ...current.pages, [input.file]: nextRecord } });
        return agentToolOk({ file: input.file, meta: next.pages[input.file], revision: snapshotRevision(next, "p") });
      },
    }),
  ),
  ...(["aria_create_page", "aria_create_component", "aria_create_layout"] as const).map((name) =>
    descriptor({
      name,
      description:
        name === "aria_create_page"
          ? "Create a blank Composer-ready Astro page."
          : name === "aria_create_layout"
            ? "Create a blank Astro layout with a default content slot."
            : "Create a blank Astro component.",
      inputSchema: z.object({ name: z.string().trim().min(1).max(255) }).strict(),
      executionPlane: "main",
      mutation: "write",
      execute: (runtime, input) =>
        agentToolOk({
          document:
            name === "aria_create_page"
              ? createPage(runtime.projectPath, input.name)
              : name === "aria_create_layout"
                ? createLayout(runtime.projectPath, input.name)
                : createComponent(runtime.projectPath, input.name),
        }),
    }),
  ),
  descriptor({
    name: "aria_delete_document",
    description: "Delete an unused page or component through the workspace service.",
    inputSchema: z.object({ kind: z.enum(["page", "component"]), file: z.string().trim().min(1).max(1024) }).strict(),
    executionPlane: "main",
    mutation: "write",
    risk: "delete_content",
    requiresClosedDocument: (input) => input.file,
    confirmationSummary: (input) => `Delete ${(input as { kind: string }).kind} ${(input as { file: string }).file}?`,
    execute(runtime, input) {
      const result = input.kind === "page" ? deletePage(runtime.projectPath, input.file) : deleteComponent(runtime.projectPath, input.file);
      return agentToolOk({ ...result, kind: input.kind, file: input.file });
    },
  }),
  descriptor({
    name: "aria_list_media",
    description: "List local media assets.",
    inputSchema: emptyInput,
    executionPlane: "main",
    mutation: "read",
    execute: (runtime) =>
      agentToolOk({
        media: listMedia(runtime.projectPath).slice(0, 200).map(({ id, name, file, type }) => ({ id, name, file, type })),
      }),
  }),
  descriptor({
    name: "aria_get_media_usages",
    description: "List bounded project references to a media asset.",
    inputSchema: z.object({ assetId: z.string().trim().min(1) }).strict(),
    executionPlane: "main",
    mutation: "read",
    execute: (runtime, input) =>
      agentToolOk({ usages: listMediaUsages(runtime.projectPath, input.assetId).slice(0, 500) }),
  }),
  descriptor({
    name: "aria_get_media_transform_state",
    description: "Read a media asset's profile and generated transform variants.",
    inputSchema: z.object({ assetId: z.string().trim().min(1) }).strict(),
    executionPlane: "main",
    mutation: "read",
    execute: (runtime, input) => agentToolOk(getMediaTransformState(runtime.projectPath, input.assetId)),
  }),
  descriptor({
    name: "aria_save_media_profile",
    description: "Update descriptive and focal-point metadata for a media asset.",
    inputSchema: z.object({
      assetPath: z.string().trim().min(1),
      altText: z.string().max(2000).nullable().optional(),
      title: z.string().max(1000).nullable().optional(),
      caption: z.string().max(5000).nullable().optional(),
      credit: z.string().max(1000).nullable().optional(),
      copyright: z.string().max(1000).nullable().optional(),
      focalPoint: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict().nullable().optional(),
    }).strict(),
    executionPlane: "main",
    mutation: "write",
    execute: (runtime, input) => agentToolOk({ profile: saveMediaProfile(runtime.projectPath, input) }),
  }),
  descriptor({
    name: "aria_delete_media_transform_variant",
    description: "Delete one generated media transform variant.",
    inputSchema: z.object({ assetId: z.string().trim().min(1), variantId: z.string().trim().min(1) }).strict(),
    executionPlane: "main",
    mutation: "write",
    risk: "delete_content",
    confirmationSummary: (input) => `Delete media variant ${(input as { variantId: string }).variantId}?`,
    execute: (runtime, input) => agentToolOk(deleteMediaVariant(runtime.projectPath, input.assetId, input.variantId)),
  }),
  descriptor({
    name: "aria_save_media_transform_variant",
    description: "Save a media transform variant from base64 image bytes and crop metadata.",
    inputSchema: z
      .object({
        id: z.string().trim().min(1).max(128),
        assetPath: z.string().trim().min(1),
        name: z.string().trim().min(1).max(100),
        sourceVersion: z.number().int().positive().optional(),
        crop: z
          .object({
            x: z.number(),
            y: z.number(),
            width: z.number().positive(),
            height: z.number().positive(),
          })
          .strict(),
        focalPoint: z
          .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
          .strict()
          .nullable()
          .optional(),
        aspectRatio: z
          .object({
            width: z.number().positive(),
            height: z.number().positive(),
          })
          .strict()
          .nullable()
          .optional(),
        output: z
          .object({
            format: z.enum(["auto", "jpeg", "png", "webp", "avif"]),
            quality: z.number().min(1).max(100),
            width: z.number().int().positive().nullable(),
            height: z.number().int().positive().nullable(),
          })
          .strict()
          .optional(),
        bytesBase64: z.string().trim().min(1).max(60_000_000),
      })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    execute(runtime, input) {
      const bytes = Uint8Array.from(Buffer.from(input.bytesBase64, "base64"));
      if (!bytes.byteLength) {
        return agentToolFail("INVALID_INPUT", "Variant bytesBase64 decoded to empty content.");
      }
      return agentToolOk(
        saveMediaVariant(runtime.projectPath, {
          id: input.id,
          assetPath: input.assetPath,
          name: input.name,
          sourceVersion: input.sourceVersion,
          crop: input.crop,
          focalPoint: input.focalPoint,
          aspectRatio: input.aspectRatio ?? null,
          output: input.output ?? {
            format: "jpeg",
            quality: 85,
            width: null,
            height: null,
          },
          bytes,
        }),
      );
    },
  }),
  descriptor({
    name: "aria_rename_media",
    description: "Rename a media asset and rewrite its known project references.",
    inputSchema: z
      .object({ assetId: z.string().trim().min(1), name: z.string().trim().min(1).max(255) })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    execute: (runtime, input) =>
      agentToolOk({ asset: renameMedia(runtime.projectPath, input.assetId, input.name) }),
  }),
  descriptor({
    name: "aria_duplicate_media",
    description: "Duplicate a local media asset.",
    inputSchema: z.object({ assetId: z.string().trim().min(1) }).strict(),
    executionPlane: "main",
    mutation: "write",
    execute: (runtime, input) =>
      agentToolOk({ asset: duplicateMedia(runtime.projectPath, input.assetId) }),
  }),
  descriptor({
    name: "aria_delete_media",
    description: "Delete an unused local media asset.",
    inputSchema: z.object({ assetId: z.string().trim().min(1) }).strict(),
    executionPlane: "main",
    mutation: "write",
    risk: "delete_content",
    confirmationSummary: (input) =>
      `Delete media asset ${(input as { assetId: string }).assetId}? This cannot proceed while the asset is referenced.`,
    execute: (runtime, input) =>
      agentToolOk(deleteMedia(runtime.projectPath, input.assetId)),
  }),
  descriptor({
    name: "aria_get_design_system",
    description: "Read the persisted design system snapshot.",
    inputSchema: emptyInput,
    executionPlane: "main",
    mutation: "read",
    execute(runtime) {
      const design = getDesignSnapshot(runtime.projectPath);
      return agentToolOk({
        design,
        revision: snapshotRevision(design, "d"),
        untrustedContent: true,
      });
    },
  }),
  descriptor({
    name: "design_edit",
    description:
      "Design system write hub: apply_template, set_primary_color, patch, class_*, font_*, variable_*, regenerate_css. Prefer this over specialty design write tools. Requires expectedRevision for fenced writes.",
    inputSchema: DesignEditInputSchema,
    executionPlane: "main",
    mutation: "write",
    riskForInput: designEditRisk,
    confirmationSummary: (input) =>
      designEditConfirmationSummary(input) ?? "Apply a design system edit?",
    execute: (runtime, input) => executeDesignEdit(runtime, input),
  }),
  descriptor({
    name: "aria_preview_design_system_patch",
    description: "Preview a design-system patch without writing. Returns current revision, keys, and a proposed summary.",
    inputSchema: z.object({ patch: designPatchSchema }).strict(),
    executionPlane: "main",
    mutation: "read",
    execute(runtime, input) {
      const current = getDesignSnapshot(runtime.projectPath);
      const patch = input.patch as DesignPatch;
      const keys = Object.keys(patch).filter((key) => (patch as Record<string, unknown>)[key] !== undefined);
      const proposedPaletteCount = patch.colors?.palettes?.length ?? current.colors.palettes.length;
      const proposedClassCount = patch.classes?.length ?? current.classes.length;
      return agentToolOk({
        preview: true,
        keys,
        currentRevision: snapshotRevision(current, "d"),
        proposedRevision: hashRevision(
          {
            ...current,
            revision: undefined,
            ...patch,
            colors: patch.colors
              ? {
                  palettes: patch.colors.palettes ?? current.colors.palettes,
                  semantic: patch.colors.semantic ?? current.colors.semantic,
                }
              : current.colors,
          },
          "d",
        ),
        current: {
          paletteCount: current.colors.palettes.length,
          classCount: current.classes.length,
          fontFamilies:
            (current.fonts?.google?.length ?? 0) +
            (current.fonts?.custom?.length ?? 0),
        },
        proposed: {
          paletteCount: proposedPaletteCount,
          classCount: proposedClassCount,
        },
        patch,
      });
    },
  }),
  descriptor({
    name: "aria_apply_design_system_patch",
    description: "Apply a design-system patch after preview. Requires expectedRevision from aria_get_design_system or preview.",
    inputSchema: z
      .object({
        patch: designPatchSchema,
        expectedRevision: z.string().trim().min(1),
      })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    risk: "replace_content",
    confirmationSummary: () => "Apply design system patch? This updates managed design CSS.",
    execute: (runtime, input) =>
      executeDesignEdit(runtime, {
        action: "patch",
        patch: input.patch,
        expectedRevision: input.expectedRevision,
      }),
  }),
  descriptor({
    name: "aria_set_design_system_primary_color",
    description: "Set the primary brand color (hex like #0d9488). Updates the primary palette DEFAULT/500 shades.",
    inputSchema: z
      .object({
        color: z
          .string()
          .trim()
          .regex(/^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/),
        expectedRevision: z.string().trim().min(1),
      })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    execute: (runtime, input) =>
      executeDesignEdit(runtime, {
        action: "set_primary_color",
        color: input.color,
        expectedRevision: input.expectedRevision,
      }),
  }),
  descriptor({
    name: "aria_list_classes",
    description: "List Design Manager classes from the current design snapshot (optional usage counts).",
    inputSchema: z
      .object({
        includeUsage: z.boolean().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .strict(),
    executionPlane: "main",
    mutation: "read",
    execute(runtime, input) {
      const design = getDesignSnapshot(runtime.projectPath);
      const limit = input.limit ?? 200;
      const names = design.classes.slice(0, limit).map((item) => item.name);
      const usage = input.includeUsage
        ? scanClassUsage(runtime.projectPath, names)
        : undefined;
      return agentToolOk({
        classes: summarizeDesignClasses(design, usage).slice(0, limit),
        total: design.classes.length,
        revision: snapshotRevision(design, "d"),
        untrustedContent: true,
      });
    },
  }),
  descriptor({
    name: "aria_list_fonts",
    description: "List enabled Google and custom fonts from the design system.",
    inputSchema: emptyInput,
    executionPlane: "main",
    mutation: "read",
    execute(runtime) {
      const design = getDesignSnapshot(runtime.projectPath);
      return agentToolOk({
        fonts: summarizeDesignFonts(design),
        revision: snapshotRevision(design, "d"),
      });
    },
  }),
  descriptor({
    name: "aria_get_font_config",
    description: "Read font configuration (enabled families plus body/heading defaults).",
    inputSchema: emptyInput,
    executionPlane: "main",
    mutation: "read",
    execute(runtime) {
      const design = getDesignSnapshot(runtime.projectPath);
      return agentToolOk({
        fonts: summarizeDesignFonts(design),
        metaFonts: design.meta.fonts,
        revision: snapshotRevision(design, "d"),
      });
    },
  }),
  descriptor({
    name: "aria_create_class",
    description: "Create a Design Manager class. Requires expectedRevision from aria_list_classes or aria_get_design_system.",
    inputSchema: z
      .object({
        name: z.string().trim().min(1).max(128),
        css: z.string().max(20_000).optional(),
        expectedRevision: z.string().trim().min(1),
      })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    execute: (runtime, input) =>
      executeDesignEdit(runtime, {
        action: "class_create",
        name: input.name,
        css: input.css,
        expectedRevision: input.expectedRevision,
      }),
  }),
  descriptor({
    name: "aria_update_class_rule",
    description: "Replace the CSS body for a Design Manager class. Requires expectedRevision.",
    inputSchema: z
      .object({
        name: z.string().trim().min(1).max(128),
        css: z.string().max(20_000),
        expectedRevision: z.string().trim().min(1),
      })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    execute: (runtime, input) =>
      executeDesignEdit(runtime, {
        action: "class_update",
        name: input.name,
        css: input.css,
        expectedRevision: input.expectedRevision,
      }),
  }),
  descriptor({
    name: "aria_delete_class",
    description: "Delete a Design Manager class. Requires expectedRevision. Does not rewrite Astro class references.",
    inputSchema: z
      .object({
        name: z.string().trim().min(1).max(128),
        expectedRevision: z.string().trim().min(1),
      })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    risk: "delete_content",
    confirmationSummary: (input) =>
      `Delete design class ${(input as { name: string }).name}? Astro class attributes are not rewritten.`,
    execute: (runtime, input) =>
      executeDesignEdit(runtime, {
        action: "class_delete",
        name: input.name,
        expectedRevision: input.expectedRevision,
      }),
  }),
  descriptor({
    name: "aria_duplicate_class",
    description: "Duplicate a Design Manager class under a new name. Requires expectedRevision.",
    inputSchema: z
      .object({
        sourceName: z.string().trim().min(1).max(128),
        name: z.string().trim().min(1).max(128).optional(),
        expectedRevision: z.string().trim().min(1),
      })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    execute: (runtime, input) =>
      executeDesignEdit(runtime, {
        action: "class_duplicate",
        sourceName: input.sourceName,
        name: input.name,
        expectedRevision: input.expectedRevision,
      }),
  }),
  descriptor({
    name: "aria_manage_css_variables",
    description: "Set or unset Design Manager CSS variables/aliases. Requires expectedRevision.",
    inputSchema: z
      .object({
        operation: z.enum(["set_custom", "unset_custom", "set_alias", "unset_alias"]),
        key: z.string().trim().min(1).max(128),
        definition: z
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
          .strict()
          .optional(),
        alias: z
          .object({
            label: z.string().trim().min(1).max(200).optional(),
            sourceType: z.enum(["token", "custom"]).optional(),
            sourceKey: z.string().trim().max(200).optional(),
            fallback: z.string().trim().max(2000).optional(),
          })
          .strict()
          .optional(),
        expectedRevision: z.string().trim().min(1),
      })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    execute(runtime, input) {
      if (input.operation === "unset_custom" || input.operation === "unset_alias") {
        return executeDesignEdit(runtime, {
          action: "variable_unset",
          operation: input.operation,
          key: input.key,
          expectedRevision: input.expectedRevision,
        });
      }
      return executeDesignEdit(runtime, {
        action: "variable_set",
        operation: input.operation,
        key: input.key,
        definition: input.definition,
        alias: input.alias,
        expectedRevision: input.expectedRevision,
      });
    },
  }),
  descriptor({
    name: "aria_regenerate_global_css",
    description: "Rewrite the managed Aria design CSS block from the current snapshot. Requires expectedRevision.",
    inputSchema: z.object({ expectedRevision: z.string().trim().min(1) }).strict(),
    executionPlane: "main",
    mutation: "write",
    risk: "replace_content",
    confirmationSummary: () => "Regenerate managed global design CSS from the current snapshot?",
    execute: (runtime, input) =>
      executeDesignEdit(runtime, {
        action: "regenerate_css",
        expectedRevision: input.expectedRevision,
      }),
  }),
  descriptor({
    name: "aria_enable_google_font",
    description: "Enable a Google font family in the design system. Requires expectedRevision.",
    inputSchema: z
      .object({
        family: z.string().trim().min(1).max(200),
        weights: z.array(z.number().int().min(100).max(900)).max(20).optional(),
        expectedRevision: z.string().trim().min(1),
      })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    execute: (runtime, input) =>
      executeDesignEdit(runtime, {
        action: "font_enable",
        family: input.family,
        weights: input.weights,
        expectedRevision: input.expectedRevision,
      }),
  }),
  descriptor({
    name: "aria_enable_fontsource_font",
    description: "Enable a Fontsource font family (npm package + CSS import). Requires expectedRevision.",
    inputSchema: z
      .object({
        id: z.string().trim().min(1).max(200),
        family: z.string().trim().min(1).max(200).optional(),
        variable: z.boolean().optional(),
        expectedRevision: z.string().trim().min(1),
      })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    execute: (runtime, input) =>
      executeDesignEdit(runtime, {
        action: "fontsource_enable",
        id: input.id,
        family: input.family,
        variable: input.variable,
        expectedRevision: input.expectedRevision,
      }),
  }),
  descriptor({
    name: "aria_disable_font",
    description: "Disable a Google, Fontsource, or registered custom font family. Requires expectedRevision.",
    inputSchema: z
      .object({
        family: z.string().trim().min(1).max(200),
        expectedRevision: z.string().trim().min(1),
      })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    execute: (runtime, input) =>
      executeDesignEdit(runtime, {
        action: "font_disable",
        family: input.family,
        expectedRevision: input.expectedRevision,
      }),
  }),
  descriptor({
    name: "aria_delete_custom_font",
    description: "Delete a custom font file and remove it from design meta. Requires expectedRevision.",
    inputSchema: z
      .object({
        file: z.string().trim().min(1).max(1024),
        expectedRevision: z.string().trim().min(1),
      })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    risk: "delete_content",
    confirmationSummary: (input) =>
      `Delete custom font file ${(input as { file: string }).file}?`,
    execute: (runtime, input) =>
      executeDesignEdit(runtime, {
        action: "font_delete",
        file: input.file,
        expectedRevision: input.expectedRevision,
      }),
  }),
  descriptor({
    name: "upload_custom_font",
    description:
      "Import a custom font from base64 bytes into public/fonts and register it in the design system. Requires expectedRevision.",
    inputSchema: z
      .object({
        fileName: z.string().trim().min(1).max(255),
        bytesBase64: z.string().trim().min(1).max(60_000_000),
        family: z.string().trim().min(1).max(200).optional(),
        expectedRevision: z.string().trim().min(1),
      })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    risk: "replace_content",
    confirmationSummary: (input) =>
      `Import custom font ${(input as { fileName: string }).fileName} into the project?`,
    execute: (runtime, input) =>
      executeDesignEdit(runtime, {
        action: "font_upload",
        fileName: input.fileName,
        bytesBase64: input.bytesBase64,
        family: input.family,
        expectedRevision: input.expectedRevision,
      }),
  }),
  descriptor({
    name: "aria_rename_class",
    description:
      "Rename a Design Manager class and rewrite project class references (.astro/.css). Requires expectedRevision. Prefer dryRun first.",
    inputSchema: z
      .object({
        from: z.string().trim().min(1).max(128),
        to: z.string().trim().min(1).max(128),
        expectedRevision: z.string().trim().min(1),
        dryRun: z.boolean().optional(),
      })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    risk: "replace_content",
    confirmationSummary: (input) =>
      `Rename class ${(input as { from: string }).from} → ${(input as { to: string }).to} across the project?`,
    execute: (runtime, input) =>
      executeDesignEdit(runtime, {
        action: "class_rename",
        from: input.from,
        to: input.to,
        expectedRevision: input.expectedRevision,
        dryRun: input.dryRun,
      }),
  }),
  descriptor({
    name: "aria_apply_design_system_template",
    description:
      "Apply a built-in palette template (primary/secondary/muted/neutral + semantic). Requires expectedRevision.",
    inputSchema: z
      .object({
        templateId: z.string().trim().min(1).max(100),
        expectedRevision: z.string().trim().min(1),
        previewOnly: z.boolean().optional(),
      })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    risk: "replace_content",
    confirmationSummary: (input) =>
      `Apply design palette template ${(input as { templateId: string }).templateId}? Theme role palettes will be replaced.`,
    execute: (runtime, input) =>
      executeDesignEdit(runtime, {
        action: "apply_template",
        templateId: input.templateId,
        expectedRevision: input.expectedRevision,
        previewOnly: input.previewOnly,
      }),
  }),
  descriptor({
    name: "aria_save_document",
    description:
      "Save a closed (disk) Astro document from exact source with mtime fencing. Prefer live Composer tools when canClientInsert.",
    inputSchema: z
      .object({
        file: z.string().trim().min(1).max(1024),
        source: z.string().min(1).max(2_000_000),
        expectedMtimeMs: z.number().finite(),
        expectedSource: z.string().max(2_000_000).optional(),
      })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    risk: "replace_content",
    requiresClosedDocument: (input) => input.file,
    confirmationSummary: (input) =>
      `Save closed document ${(input as { file: string }).file}?`,
    execute(runtime, input) {
      const result = saveClosedDocument({
        projectPath: runtime.projectPath,
        file: input.file,
        source: input.source,
        expectedMtimeMs: input.expectedMtimeMs,
        expectedSource: input.expectedSource,
      });
      if (!result.ok) {
        return agentToolFail(result.code, result.message, {
          currentVersion:
            result.currentMtimeMs != null ? String(result.currentMtimeMs) : undefined,
          suggestedFix: "Reload the document and retry with the latest mtime/source.",
        });
      }
      return agentToolOk(result.data);
    },
  }),
  descriptor({
    name: "aria_duplicate_document",
    description: "Duplicate a page, component, or layout Astro file under a new name.",
    inputSchema: z
      .object({
        kind: z.enum(["page", "component", "layout"]),
        sourceFile: z.string().trim().min(1).max(1024),
        name: z.string().trim().min(1).max(255),
      })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    execute(runtime, input) {
      const result = duplicateDocument({
        projectPath: runtime.projectPath,
        kind: input.kind,
        sourceFile: input.sourceFile,
        name: input.name,
      });
      if (!result.ok) return agentToolFail(result.code, result.message);
      return agentToolOk(result.data);
    },
  }),
  descriptor({
    name: "aria_update_layout_slots",
    description:
      "Mutate layout slots or page slot assignments on disk with mtime fencing. Prefer live Composer when the file is open.",
    inputSchema: z
      .object({
        file: z.string().trim().min(1).max(1024),
        expectedMtimeMs: z.number().finite(),
        plane: z.enum(["layout", "page"]),
        operation: z.enum([
          "insert",
          "rename",
          "delete",
          "assign_nodes",
          "rename_page_assignments",
        ]),
        slotName: z.string().trim().min(1).max(100).nullable().optional(),
        path: z.string().trim().min(1).max(200).optional(),
        nextName: z.string().trim().min(1).max(100).optional(),
        parentPath: z.string().trim().min(1).max(200).nullable().optional(),
        index: z.number().int().min(0).max(10_000).optional(),
        nodePaths: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
        from: z.string().trim().min(1).max(100).optional(),
        to: z.string().trim().min(1).max(100).optional(),
      })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    risk: "replace_content",
    requiresClosedDocument: (input) => input.file,
    confirmationSummary: (input) =>
      `Update layout slots on ${(input as { file: string }).file}?`,
    async execute(runtime, input) {
      let op;
      if (input.operation === "insert") {
        op = {
          operation: "insert" as const,
          slotName: input.slotName ?? null,
          parentPath: input.parentPath,
          index: input.index,
        };
      } else if (input.operation === "rename") {
        if (!input.path || !input.nextName) {
          return agentToolFail("INVALID_INPUT", "rename requires path and nextName.");
        }
        op = { operation: "rename" as const, path: input.path, nextName: input.nextName };
      } else if (input.operation === "delete") {
        if (!input.path) return agentToolFail("INVALID_INPUT", "delete requires path.");
        op = { operation: "delete" as const, path: input.path };
      } else if (input.operation === "assign_nodes") {
        if (!input.nodePaths?.length) {
          return agentToolFail("INVALID_INPUT", "assign_nodes requires nodePaths.");
        }
        op = {
          operation: "assign_nodes" as const,
          slotName: input.slotName ?? null,
          nodePaths: input.nodePaths,
        };
      } else {
        if (!input.from || !input.to) {
          return agentToolFail(
            "INVALID_INPUT",
            "rename_page_assignments requires from and to.",
          );
        }
        op = {
          operation: "rename_page_assignments" as const,
          from: input.from,
          to: input.to,
        };
      }
      const result = await updateLayoutSlots({
        projectPath: runtime.projectPath,
        file: input.file,
        expectedMtimeMs: input.expectedMtimeMs,
        plane: input.plane,
        op,
      });
      if (!result.ok) {
        return agentToolFail(result.code, result.message, {
          currentVersion:
            result.currentMtimeMs != null ? String(result.currentMtimeMs) : undefined,
        });
      }
      return agentToolOk(result.data);
    },
  }),
  descriptor({
    name: "aria_get_discovery_report",
    description: "Build the current local SEO and discovery health report.",
    inputSchema: emptyInput,
    executionPlane: "main",
    mutation: "read",
    async execute(runtime) {
      const settings = readSiteSettings(runtime.projectPath);
      const { pages } = await loadDiscoveryContext(runtime.projectPath, settings);
      return agentToolOk({ report: buildDiscoveryReport({ siteSettings: settings, pages, redirects: readRedirects(runtime.projectPath) }) });
    },
  }),
  descriptor({
    name: "aria_get_discovery_artifacts",
    description: "Build the current robots/sitemap/llms discovery artifact payloads.",
    inputSchema: emptyInput,
    executionPlane: "main",
    mutation: "read",
    async execute(runtime) {
      const settings = readSiteSettings(runtime.projectPath);
      const { pages, cmsEntries } = await loadDiscoveryContext(runtime.projectPath, settings);
      return agentToolOk({
        artifacts: buildDiscoveryArtifacts({ siteSettings: settings, pages, cmsEntries }),
        untrustedContent: true,
      });
    },
  }),
  descriptor({
    name: "aria_get_discovery_baseline",
    description: "Read a generated discovery baseline (robots, sitemap, or llms) for editor seeding.",
    inputSchema: z.object({ artifact: z.enum(["robots", "sitemap", "llms"]) }).strict(),
    executionPlane: "main",
    mutation: "read",
    async execute(runtime, input) {
      const settings = readSiteSettings(runtime.projectPath);
      const { pages } = await loadDiscoveryContext(runtime.projectPath, settings);
      const content = buildGeneratedDiscoveryBaseline({
        artifact: input.artifact,
        siteSettings: settings,
        pages,
        forEditorSeed: true,
      });
      return agentToolOk({
        baseline: DiscoveryGeneratedBaselineSchema.parse({
          artifact: input.artifact,
          content,
          generatedAt: new Date().toISOString(),
        }),
        untrustedContent: true,
      });
    },
  }),
  descriptor({
    name: "aria_update_discovery_settings",
    description: "Patch local discovery generation settings. Pass expectedRevision from aria_get_site_context.settingsRevision.",
    inputSchema: z.object({
      expectedRevision: z.string().trim().min(1),
      sitemapMode: z.enum(["auto", "custom", "off"]).optional(),
      robotsMode: z.enum(["auto", "custom"]).optional(),
      includeSitemapInRobots: z.boolean().optional(),
      llmsMode: z.enum(["auto", "custom", "off"]).optional(),
      discourageSearchEngines: z.boolean().optional(),
      trailingSlashPolicy: z.enum(["strip", "add", "none"]).optional(),
      sitemapPingOnPublish: z.boolean().optional(),
      aiBotPolicy: z.enum(["allow-all", "block-training", "custom"]).optional(),
    }).strict(),
    executionPlane: "main",
    mutation: "write",
    execute(runtime, input) {
      const current = readSiteSettings(runtime.projectPath);
      const currentRevision = snapshotRevision(
        {
          siteName: current.siteName,
          siteDescription: current.siteDescription,
          siteUrl: current.siteUrl,
          discovery: current.discovery,
        },
        "s",
      );
      if (currentRevision !== input.expectedRevision) {
        return agentToolFail("CONFLICT", "Site/discovery settings changed since they were read.", {
          suggestedFix: "Call aria_get_site_context again and retry with settingsRevision.",
          currentVersion: currentRevision,
        });
      }
      const { expectedRevision: _expected, ...patch } = input;
      const settings = updateDiscoverySettings(runtime.projectPath, patch);
      return agentToolOk({
        settings,
        revision: snapshotRevision(
          {
            siteName: settings.siteName,
            siteDescription: settings.siteDescription,
            siteUrl: settings.siteUrl,
            discovery: settings.discovery,
          },
          "s",
        ),
      });
    },
  }),
  descriptor({
    name: "aria_list_site_exports",
    description: "List portable site export archives generated for this project.",
    inputSchema: emptyInput,
    executionPlane: "main",
    mutation: "read",
    execute(runtime) {
      return agentToolOk(listSiteExports(runtime.projectPath));
    },
  }),
  descriptor({
    name: "aria_get_latest_site_export",
    description: "Return the newest non-expired site export archive metadata, if any.",
    inputSchema: emptyInput,
    executionPlane: "main",
    mutation: "read",
    execute(runtime) {
      const latest = getLatestSiteExport(runtime.projectPath);
      return agentToolOk({ export: latest });
    },
  }),
  descriptor({
    name: "aria_create_site_export",
    description:
      "Generate a portable site export zip under .aria/exports. Optional ttlMinutes and section selection.",
    inputSchema: CreateSiteExportInputSchema,
    executionPlane: "main",
    mutation: "write",
    async execute(runtime, input) {
      const result = await createSiteExport(runtime.projectPath, input);
      return agentToolOk(result);
    },
  }),
  descriptor({
    name: "aria_delete_site_export",
    description: "Delete a generated site export archive by id.",
    inputSchema: z.object({ id: z.string().trim().min(1) }).strict(),
    executionPlane: "main",
    mutation: "write",
    execute(runtime, input) {
      return agentToolOk(deleteSiteExport(runtime.projectPath, input));
    },
  }),
  descriptor({
    name: "aria_list_element_types",
    description: "List Aria Composer primitives and HTML tags the agent may insert. Call before inventing node structure.",
    inputSchema: emptyInput,
    executionPlane: "main",
    mutation: "read",
    execute: () => agentToolOk(listComposerElementTypes()),
  }),
  descriptor({
    name: "aria_get_node_capabilities",
    description: "Describe Composer node affordances (classes, motion, media attach, containment) available on desktop.",
    inputSchema: emptyInput,
    executionPlane: "main",
    mutation: "read",
    execute: () => agentToolOk(getComposerNodeCapabilities()),
  }),
  descriptor({
    name: "aria_get_cms_inventory",
    description: "Summarize CMS collections with schemas, entry counts, statuses, locales, and routing hints.",
    inputSchema: emptyInput,
    executionPlane: "main",
    mutation: "read",
    execute(runtime) {
      const state = readCollections(runtime.projectPath);
      const collections = state.collections.map((collection) => {
        const result = listEntries(runtime.projectPath, { collectionId: collection.id, limit: 200 });
        const statuses: Record<string, number> = {};
        const locales = new Set<string>();
        for (const record of result.items) {
          statuses[record.entry.status] = (statuses[record.entry.status] ?? 0) + 1;
          record.locales.forEach((locale) => locales.add(locale.locale));
        }
        return {
          id: collection.id,
          name: collection.name,
          label: collection.label,
          kind: collection.kind,
          total: result.total,
          statuses,
          locales: [...locales].sort(),
          fields: (collection.schema?.fields ?? []).map((field) => ({
            key: field.key,
            label: field.label,
            type: field.type,
            required: field.required ?? false,
          })),
          routing: {
            urlPattern: collection.urlPattern ?? null,
            templatePageFile: collection.templatePageFile ?? null,
            listPageFile: collection.listPageFile ?? null,
          },
        };
      });
      return agentToolOk({
        revision: collectionRevision(state),
        collections,
        untrustedContent: true,
      });
    },
  }),
  descriptor({
    name: "aria_list_collections",
    description: "List Aria, local Astro, and external CMS collection definitions with source capabilities.",
    inputSchema: emptyInput,
    executionPlane: "main",
    mutation: "read",
    async execute(runtime) {
      const state = await readCollectionRegistryWithCache(runtime.projectPath);
      const collections = state.collections.map((collection) => ({
        ...collection,
        ...(collection.source
          ? { source: { ...collection.source, inspectionEntries: undefined } }
          : {}),
      }));
      return agentToolOk({ collections, revision: state.revision, untrustedContent: true });
    },
  }),
  descriptor({
    name: "aria_get_collection",
    description: "Read one CMS collection definition and current state revision.",
    inputSchema: z.object({ collectionId: z.string().trim().min(1) }).strict(),
    executionPlane: "main",
    mutation: "read",
    async execute(runtime, input) {
      const state = await readCollectionRegistryWithCache(runtime.projectPath);
      const collection = state.collections.find((item) => item.id === input.collectionId);
      return collection
        ? agentToolOk({
            collection: collection.source
              ? { ...collection, source: { ...collection.source, inspectionEntries: undefined } }
              : collection,
            revision: state.revision,
            untrustedContent: true,
          })
        : agentToolFail("NOT_FOUND", `Collection not found: ${input.collectionId}`);
    },
  }),
  descriptor({
    name: "aria_list_external_entries",
    description: "Search and inspect bounded entries from a read-only external or local Astro collection.",
    inputSchema: z.object({
      collection: z.string().trim().min(1).max(200),
      query: z.string().trim().max(500).optional(),
      limit: z.number().int().min(1).max(100).default(25),
    }).strict(),
    executionPlane: "main",
    mutation: "read",
    async execute(runtime, input) {
      const state = await readCollectionRegistryWithCache(runtime.projectPath);
      const collection = state.collections.find(
        (item) => item.id === input.collection || item.name === input.collection,
      );
      if (!collection?.source?.readOnly) {
        return agentToolFail("INVALID_INPUT", "Choose a read-only external or local Astro collection.");
      }
      const result = await listExternalEntries(runtime.projectPath, {
        collectionId: collection.id,
        query: input.query,
        page: 1,
        limit: input.limit,
      });
      const { inspectionEntries: _inspectionEntries, ...source } = collection.source;
      return agentToolOk({
        collection: { id: collection.id, name: collection.name, label: collection.label },
        source,
        entries: result.items,
        fields: result.fields,
        total: result.total,
        filteredTotal: result.filteredTotal,
        cached: collection.source.adapter === "astro-store",
        truncated: result.truncated || result.filteredTotal > result.items.length,
        untrustedContent: true,
      });
    },
  }),
  descriptor({
    name: "aria_list_entries",
    description: "List and search CMS entries with bounded pagination.",
    inputSchema: EntryListRequestSchema,
    executionPlane: "main",
    mutation: "read",
    execute(runtime, input) {
      const result = listEntries(runtime.projectPath, input);
      return agentToolOk({ ...result, items: result.items.map((item) => summarizeEntry(item)), untrustedContent: true });
    },
  }),
  descriptor({
    name: "aria_query_entries",
    description: "Query CMS entries. Supports status, locale, sorting, and a bounded limit.",
    inputSchema: EntryListRequestSchema,
    executionPlane: "main",
    mutation: "read",
    execute(runtime, input) {
      const result = listEntries(runtime.projectPath, input);
      return agentToolOk({ ...result, items: result.items.map((item) => summarizeEntry(item)), untrustedContent: true });
    },
  }),
  descriptor({
    name: "aria_get_entry",
    description: "Read a CMS entry by id or slug.",
    inputSchema: z
      .object({
        collectionId: z.string().trim().min(1),
        entryIdOrSlug: z.string().trim().min(1),
      })
      .strict(),
    executionPlane: "main",
    mutation: "read",
    execute(runtime, input) {
      const record = getEntry(runtime.projectPath, input.collectionId, input.entryIdOrSlug);
      return record
        ? agentToolOk({ entry: summarizeEntry(record), untrustedContent: true })
        : agentToolFail("NOT_FOUND", `Entry not found: ${input.entryIdOrSlug}`);
    },
  }),
  descriptor({
    name: "aria_get_entry_translation_context",
    description: "Read bounded source and target locale content for translating one CMS entry.",
    inputSchema: z
      .object({
        collectionId: z.string().trim().min(1),
        entryId: z.string().trim().min(1),
        targetLocale: z.string().trim().min(1).max(40),
      })
      .strict(),
    executionPlane: "main",
    mutation: "read",
    execute(runtime, input) {
      const record = getEntry(runtime.projectPath, input.collectionId, input.entryId);
      if (!record) return agentToolFail("NOT_FOUND", `Entry not found: ${input.entryId}`);
      const source = record.locales.find((locale) => locale.isSource) ?? record.locales[0];
      if (!source) return agentToolFail("NOT_FOUND", "The entry has no source locale.");
      const target = record.locales.find((locale) => locale.locale === input.targetLocale) ?? null;
      const sourceContentHash = sourceLocaleContentHash(source);
      return agentToolOk({
        entryId: record.entry.id,
        version: record.entry.version,
        source,
        target,
        targetLocale: input.targetLocale,
        sourceContentHash,
        targetState: target
          ? target.translationMeta?.sourceContentHash === sourceContentHash
            ? "current"
            : "stale"
          : "missing",
        untrustedContent: true,
      });
    },
  }),
  descriptor({
    name: "aria_prepare_external_cms_handoff",
    description: "Save a local, explicitly unapplied translation patch for a read-only external CMS record. This never updates the provider.",
    inputSchema: z.object({
      provider: z.enum(["payload", "sanity", "external"]),
      collection: z.string().trim().min(1).max(200),
      recordId: z.string().trim().min(1).max(500),
      sourceVersion: z.string().trim().min(1).max(500).optional(),
      sourceContentHash: z.string().trim().min(1).max(500),
      targetLocale: z.string().trim().min(1).max(40),
      proposedFieldPatch: z.record(z.string().trim().min(1).max(500), z.unknown()),
    }).strict(),
    executionPlane: "main",
    mutation: "write",
    execute(runtime, input) {
      const collection = readCollectionRegistry(runtime.projectPath).collections.find((item) => item.name === input.collection || item.id === input.collection);
      if (!collection?.source?.readOnly) {
        return agentToolFail("INVALID_INPUT", "Handoff drafts are only for read-only external collections.");
      }
      if (collection.source.provider !== input.provider && !(collection.source.provider === "external" && input.provider === "external")) {
        return agentToolFail("CONFLICT", `The detected provider is ${collection.source.provider}, not ${input.provider}.`);
      }
      const draft = createHandoffDraft(runtime.projectPath, input);
      return agentToolOk({
        draft,
        applied: false,
        notice: "Saved locally. The external CMS was not updated.",
        export: { format: "aria-cms-handoff-patch+json", data: draft },
      });
    },
  }),
  descriptor({
    name: "aria_assess_collection_migration",
    description: "Build a read-only migration assessment for moving an external Astro collection into Aria CMS.",
    inputSchema: z.object({ collection: z.string().trim().min(1).max(200) }).strict(),
    executionPlane: "main",
    mutation: "read",
    async execute(runtime, input) {
      try {
        const assessment = await assessCollectionMigration(runtime.projectPath, input.collection);
        return agentToolOk({ assessment, untrustedContent: true });
      } catch (cause) {
        return agentToolFail("INVALID_INPUT", cause instanceof Error ? cause.message : "Migration assessment failed");
      }
    },
  }),
  descriptor({
    name: "aria_list_translation_work",
    description: "Report missing, stale, and current locale work across Aria and read-only external collections, including mutation capabilities.",
    inputSchema: z.object({ collectionId: z.string().trim().min(1).max(200).optional(), limit: z.number().int().min(1).max(2_000).default(500) }).strict(),
    executionPlane: "main",
    mutation: "read",
    async execute(runtime, input) {
      const configured = (readSiteSettings(runtime.projectPath).localization?.content.locales ?? [])
        .filter((locale) => locale.enabled)
        .map((locale) => locale.code);
      const registry = (await readCollectionRegistryWithCache(runtime.projectPath)).collections
        .filter((collection) => !input.collectionId || collection.id === input.collectionId || collection.name === input.collectionId);
      const work: Array<Record<string, unknown>> = [];
      for (const collection of registry) {
        if (work.length >= input.limit) break;
        if (collection.source?.kind === "aria-managed") {
          const records = listEntries(runtime.projectPath, {
            collectionId: collection.id,
            limit: input.limit,
          }).items;
          for (const record of records) {
            const source = record.locales.find((locale) => locale.isSource) ?? record.locales[0];
            if (!source) continue;
            const hash = sourceLocaleContentHash(source);
            for (const locale of configured) {
              if (work.length >= input.limit || locale === source.locale) continue;
              const target = record.locales.find((item) => item.locale === locale);
              work.push({
                collectionId: collection.id,
                collection: collection.name,
                entryId: record.entry.id,
                sourceLocale: source.locale,
                targetLocale: locale,
                state: !target ? "missing" : target.translationMeta?.sourceContentHash === hash ? "current" : "stale",
                localeStatus: target?.status ?? "draft",
                writable: Boolean(collection.capabilities?.translate),
                source: collection.source,
              });
            }
          }
        } else {
          const discovered = new Set(collection.source?.discoveredLocales ?? []);
          for (const locale of configured) {
            if (work.length >= input.limit) break;
            work.push({
              collectionId: collection.id,
              collection: collection.name,
              targetLocale: locale,
              state: discovered.has(locale) ? "provider-reported" : "provider-missing-or-unknown",
              writable: false,
              handoffAvailable: true,
              source: collection.source,
            });
          }
        }
      }
      return agentToolOk({ work, configuredLocales: configured, truncated: work.length >= input.limit, untrustedContent: true });
    },
  }),
  descriptor({
    name: "aria_list_entry_revisions",
    description: "List stored revisions for a CMS entry.",
    inputSchema: z.object({ entryId: z.string().trim().min(1) }).strict(),
    executionPlane: "main",
    mutation: "read",
    execute: (runtime, input) =>
      agentToolOk({ revisions: listRevisions(runtime.projectPath, input.entryId), untrustedContent: true }),
  }),
  descriptor({
    name: "aria_get_entry_revision",
    description: "Read one stored revision for a CMS entry.",
    inputSchema: z
      .object({ entryId: z.string().trim().min(1), revisionId: z.string().trim().min(1) })
      .strict(),
    executionPlane: "main",
    mutation: "read",
    execute(runtime, input) {
      const revision = listRevisions(runtime.projectPath, input.entryId).find((item) => item.id === input.revisionId);
      return revision
        ? agentToolOk({ revision, untrustedContent: true })
        : agentToolFail("NOT_FOUND", `Revision not found: ${input.revisionId}`);
    },
  }),
  descriptor({
    name: "aria_compare_entry_revisions",
    description: "Compare the canonical snapshots of two entry revisions.",
    inputSchema: z
      .object({
        entryId: z.string().trim().min(1),
        leftRevisionId: z.string().trim().min(1),
        rightRevisionId: z.string().trim().min(1),
      })
      .strict(),
    executionPlane: "main",
    mutation: "read",
    execute(runtime, input) {
      const revisions = listRevisions(runtime.projectPath, input.entryId);
      const left = revisions.find((item) => item.id === input.leftRevisionId);
      const right = revisions.find((item) => item.id === input.rightRevisionId);
      if (!left || !right) return agentToolFail("NOT_FOUND", "One or both revisions were not found.");
      return agentToolOk({
        left: left.snapshot,
        right: right.snapshot,
        changed: JSON.stringify(left.snapshot) !== JSON.stringify(right.snapshot),
        untrustedContent: true,
      });
    },
  }),
  descriptor({
    name: "aria_create_collection",
    description: "Create a CMS collection using the current state revision.",
    inputSchema: z
      .object({
        expectedRevision: z.string().min(1),
        name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        label: z.string().trim().min(1).max(200),
        kind: z.enum(["content", "data", "config", "tags"]),
        fields: z.array(FieldSchemaInputSchema).default([]),
        supports: z.array(CollectionSupportSchema).default([]),
        scope: z.enum(["global", "collection"]).default("global"),
        urlPattern: z.string().nullable().optional(),
      })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    execute(runtime, input) {
      const state = readCollections(runtime.projectPath);
      assertCollectionRevision(state, input.expectedRevision);
      if (state.collections.some((item) => item.name === input.name)) {
        return agentToolFail("CONFLICT", `Collection name already exists: ${input.name}`);
      }
      const collection = {
        id: generateId(),
        name: input.name,
        label: input.label,
        kind: input.kind,
        urlPattern: input.urlPattern ?? (input.kind === "content" ? `/${input.name}/{slug}` : null),
        listPageFile: null,
        templatePageFile: null,
        schema: { fields: input.fields, version: 1 },
        supports: input.supports,
        scope: input.scope,
      };
      const next = writeCollectionsWithContentConfig(runtime.projectPath, { collections: [...state.collections, collection] });
      return agentToolOk({ collection: next.collections.at(-1), revision: collectionRevision(next) });
    },
  }),
  descriptor({
    name: "aria_update_collection",
    description: "Patch a CMS collection with collection-state conflict protection.",
    inputSchema: z
      .object({
        collectionId: z.string().trim().min(1),
        expectedRevision: z.string().min(1),
        patch: z
          .object({
            label: z.string().trim().min(1).max(200).optional(),
            kind: z.enum(["content", "data", "config", "tags"]).optional(),
            icon: z.string().trim().max(200).nullable().optional(),
            urlPattern: z.string().trim().max(512).nullable().optional(),
            listPageFile: z.string().trim().max(1024).nullable().optional(),
            templatePageFile: z.string().trim().max(1024).nullable().optional(),
            supports: z.array(CollectionSupportSchema).optional(),
            scope: z.enum(["global", "collection"]).optional(),
            schema: z
              .object({
                fields: z.array(FieldSchemaInputSchema),
                version: z.number().int().positive(),
                icon: z.string().trim().max(200).optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    execute(runtime, input) {
      const state = readCollections(runtime.projectPath);
      assertCollectionRevision(state, input.expectedRevision);
      const current = state.collections.find((item) => item.id === input.collectionId);
      if (!current) return agentToolFail("NOT_FOUND", `Collection not found: ${input.collectionId}`);
      const next = writeCollectionsWithContentConfig(runtime.projectPath, {
        collections: state.collections.map((item) =>
          item.id === input.collectionId
            ? {
                ...item,
                ...input.patch,
                ...(input.patch.schema
                  ? { schema: { ...item.schema, ...input.patch.schema } }
                  : {}),
                id: item.id,
                name: item.name,
              }
            : item,
        ),
      });
      return agentToolOk({
        collection: next.collections.find((item) => item.id === input.collectionId),
        revision: collectionRevision(next),
      });
    },
  }),
  descriptor({
    name: "aria_delete_collection",
    description: "Delete an empty CMS collection with state conflict protection.",
    inputSchema: z
      .object({ collectionId: z.string().trim().min(1), expectedRevision: z.string().min(1) })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    risk: "delete_content",
    confirmationSummary: (input) =>
      `Delete collection ${(input as { collectionId: string }).collectionId}? The collection must be empty.`,
    execute(runtime, input) {
      const state = readCollections(runtime.projectPath);
      assertCollectionRevision(state, input.expectedRevision);
      const deleted = deleteCollections(
        runtime.projectPath,
        [input.collectionId],
        state.revision!,
      );
      const next = readCollections(runtime.projectPath);
      return agentToolOk({ ...deleted, revision: collectionRevision(next) });
    },
  }),
  descriptor({
    name: "aria_setup_blog",
    description: "Create the standard blog, authors, and tags CMS structure and starter content.",
    inputSchema: emptyInput,
    executionPlane: "main",
    mutation: "write",
    risk: "publish_lifecycle",
    confirmationSummary: () =>
      "Set up the blog and publish its starter content? This creates public CMS routes.",
    async execute(runtime) {
      return agentToolOk(await seedBlogCms(runtime.projectPath));
    },
  }),
  descriptor({
    name: "aria_preview_markdown_import",
    description: "Parse Markdown safely and return its immutable import plan and preview hash.",
    inputSchema: z
      .object({
        collectionId: z.string().trim().min(1),
        markdown: z.string().min(1).max(1024 * 1024),
      })
      .strict(),
    executionPlane: "main",
    mutation: "read",
    execute(runtime, input) {
      return agentToolOk({
        preview: previewImportMarkdown(
          runtime.projectPath,
          input.collectionId,
          input.markdown,
        ),
      });
    },
  }),
  descriptor({
    name: "aria_import_markdown",
    description: "Apply an exact previously previewed Markdown import plan.",
    inputSchema: z
      .object({
        collectionId: z.string().trim().min(1),
        markdown: z.string().min(1).max(1024 * 1024),
        previewHash: z.string().length(64),
        addMissingFields: z.boolean().default(false),
        selectedFieldKeys: z.array(z.string().trim().min(1)).default([]),
      })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    execute(runtime, input) {
      return agentToolOk({
        entry: importMarkdownToEntry(
          runtime.projectPath,
          input.collectionId,
          input.markdown,
          input,
        ),
      });
    },
  }),
  descriptor({
    name: "aria_create_entry",
    description: "Create a draft CMS entry.",
    inputSchema: agentCreateEntrySchema,
    executionPlane: "main",
    mutation: "write",
    execute: (runtime, input) => agentToolOk({ entry: createEntry(runtime.projectPath, input) }),
  }),
  descriptor({
    name: "aria_update_entry",
    description: "Update the source locale of a CMS entry using its exact current version.",
    inputSchema: agentUpdateEntrySchema,
    executionPlane: "main",
    mutation: "write",
    execute(runtime, input) {
      const current = getEntry(runtime.projectPath, input.collectionId, input.id);
      if (!current) return agentToolFail("NOT_FOUND", `Entry not found: ${input.id}`);
      const sourceLocale = current.locales.find((locale) => locale.isSource)?.locale;
      if (input.patch.locale && input.patch.locale !== sourceLocale) {
        return agentToolFail(
          "INVALID_INPUT",
          "Localized authoring is unavailable in this phase. Update the source locale instead.",
        );
      }
      return agentToolOk({ entry: updateEntry(runtime.projectPath, input) });
    },
  }),
  descriptor({
    name: "aria_save_entry_translation",
    description: "Create or replace one non-source locale using the entry's exact current version.",
    inputSchema: agentSaveTranslationSchema,
    executionPlane: "main",
    mutation: "write",
    execute(runtime, input) {
      const current = getEntry(runtime.projectPath, input.collectionId, input.entryId);
      if (!current) return agentToolFail("NOT_FOUND", `Entry not found: ${input.entryId}`);
      const source = current.locales.find((locale) => locale.isSource) ?? current.locales[0];
      if (!source) return agentToolFail("NOT_FOUND", "The entry has no source locale.");
      if (source.locale !== input.sourceLocale) {
        return agentToolFail("CONFLICT", "The source locale changed since the translation was prepared.", {
          currentVersion: current.entry.version,
          suggestedFix: "Read fresh translation context and translate from the current source locale.",
        });
      }
      if (input.locale === source.locale) {
        return agentToolFail("INVALID_INPUT", "Use aria_update_entry to edit the source locale.");
      }
      const currentSourceContentHash = sourceLocaleContentHash(source);
      if (input.sourceContentHash !== currentSourceContentHash) {
        return agentToolFail(
          "CONFLICT",
          "The source content changed since this translation was prepared.",
          {
            currentVersion: current.entry.version,
            suggestedFix: "Read fresh translation context and translate the current source content.",
          },
        );
      }
      const entry = updateEntry(runtime.projectPath, {
        collectionId: input.collectionId,
        id: input.entryId,
        version: input.version,
        patch: {
          upsertLocale: {
            locale: input.locale,
            title: input.title,
            slug: input.slug,
            frontmatter: input.frontmatter,
            body: input.body,
            isSource: false,
            translationMeta: {
              method: "ai",
              sourceLocale: input.sourceLocale,
              sourceContentHash: currentSourceContentHash,
              generatedAt: new Date().toISOString(),
              translatedFieldPaths: input.translatedFieldPaths,
            },
          },
        },
      });
      return agentToolOk({
        entryId: entry.entry.id,
        version: entry.entry.version,
        locale: input.locale,
        saved: true,
      });
    },
  }),
  descriptor({
    name: "aria_duplicate_entry",
    description: "Duplicate an entry after verifying its current version.",
    inputSchema: versionedEntryIdentity,
    executionPlane: "main",
    mutation: "write",
    execute(runtime, input) {
      return agentToolOk({ entry: duplicateEntry(runtime.projectPath, input.collectionId, input.entryId, input.version) });
    },
  }),
  descriptor({
    name: "aria_delete_entry",
    description: "Delete one CMS entry using its exact current version.",
    inputSchema: versionedEntryIdentity,
    executionPlane: "main",
    mutation: "write",
    risk: "delete_content",
    confirmationSummary: (input) =>
      `Delete entry ${(input as { entryId: string }).entryId}? Its canonical record, revisions, and projection will be removed.`,
    execute(runtime, input) {
      deleteEntry(runtime.projectPath, input.collectionId, input.entryId, input.version);
      return agentToolOk({ deleted: true, entryId: input.entryId });
    },
  }),
  ...(["aria_publish_entry", "aria_unpublish_entry", "aria_archive_entry"] as const).map((name) =>
    descriptor({
      name,
      description: `${name === "aria_publish_entry" ? "Publish" : name === "aria_unpublish_entry" ? "Unpublish" : "Archive"} a CMS entry using its current version.`,
      inputSchema: versionedEntryIdentity,
      executionPlane: "main",
      mutation: "write",
      risk: "publish_lifecycle",
      confirmationSummary: (input) =>
        `${name === "aria_publish_entry" ? "Publish" : name === "aria_unpublish_entry" ? "Unpublish" : "Archive"} entry ${(input as { entryId: string }).entryId}? This changes its public lifecycle state.`,
      execute(runtime, input) {
        const entry = name === "aria_publish_entry"
          ? publishEntry(runtime.projectPath, input.collectionId, input.entryId, {
              version: input.version,
            })
          : name === "aria_unpublish_entry"
            ? unpublishEntry(runtime.projectPath, input.collectionId, input.entryId, { version: input.version })
            : archiveEntry(runtime.projectPath, input.collectionId, input.entryId, { version: input.version });
        return agentToolOk({ entry });
      },
    }),
  ),
  descriptor({
    name: "aria_restore_entry_revision",
    description: "Restore a prior CMS entry revision after verifying the current entry version.",
    inputSchema: z
      .object({
        entryId: z.string().trim().min(1),
        revisionId: z.string().trim().min(1),
        version: z.string().trim().min(1),
      })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    risk: "replace_content",
    confirmationSummary: (input) =>
      `Restore revision ${(input as { revisionId: string }).revisionId}? This replaces the current entry content.`,
    execute(runtime, input) {
      return agentToolOk({ entry: restoreRevision(runtime.projectPath, input.entryId, input.revisionId, input.version) });
    },
  }),
  ...([
    "open_in_composer",
    "select_block",
    "insert_nodes",
    "insert_designed_section",
    "aria_insert_nodes",
    "aria_mutate_node",
    "aria_update_node_classes",
    "aria_update_node_motion",
    "update_node_motion",
    "aria_attach_media_to_node",
    "aria_bind_node_field",
    "aria_set_container_loop",
    "aria_get_node_condition",
    "aria_set_node_condition",
    "aria_remove_node_condition",
    "aria_replace_node",
    "aria_move_node",
    "aria_delete_node",
  ] as const).map((name) =>
    descriptor({
      name,
      description:
        name === "insert_nodes"
          ? "Insert Astro Composer nodes into the live document. Use exact paths from the current Layers outline; omit target when uncertain so Composer chooses safe page content. Utility classes require document.utilityStyles.enabled; otherwise apply custom Design Manager classes. Prefer { primitive }, { kind, name }, or { tag } trees without inventing ids."
          : name === "insert_designed_section"
            ? "Insert one designed section root into the live Composer document. Use an exact Layers outline path or omit target for safe primary-content placement. Utility classes require document.utilityStyles.enabled; otherwise apply custom Design Manager classes."
            : name === "aria_insert_nodes"
              ? "Insert nodes through the live Composer host. Use an exact Layers outline path or omit target; do not invent document-root paths. Utility classes require document.utilityStyles.enabled; otherwise apply custom Design Manager classes."
            : name === "open_in_composer"
              ? "Open or navigate to a page/component/layout in Composer."
              : name === "select_block"
                ? "Select a Composer node by marker path or node id."
                : name === "aria_bind_node_field"
                  ? "Bind or unbind a CMS field onto a live Composer text node or prop."
                : name === "aria_set_container_loop"
                    ? "Wrap or unwrap a live Composer node in a managed CMS collection loop."
                  : name === "aria_get_node_condition"
                    ? "Read and explain the managed condition that contains a live Composer node."
                  : name === "aria_set_node_condition"
                    ? "Add or update an app-wide managed condition on a live Composer node. Rules inside a group use AND; groups use OR."
                  : name === "aria_remove_node_condition"
                    ? "Remove a managed condition while explicitly choosing which branch content to keep."
                  : name === "aria_update_node_classes"
                    ? "Update classes on a live Composer node. Utility tokens require document.utilityStyles.enabled; otherwise use classes backed by project CSS or Design Manager."
                : `Run ${name} against the owning renderer's active Composer document.`,
      inputSchema: rendererInputSchema(name),
      executionPlane: "renderer",
      availability: (runtime) => runtime.rendererCapabilities
        ? runtime.rendererCapabilities.navigation
        : Boolean(runtime.executeRendererTool),
      mutation: name === "open_in_composer" || name === "select_block" || name === "aria_get_node_condition" ? "read" : "write",
      risk:
        name === "aria_delete_node"
          ? "delete_content"
          : name === "aria_replace_node"
            ? "replace_content"
            : undefined,
      confirmationSummary:
        name === "aria_delete_node"
          ? (value) => `Delete Composer node ${(value as { path: string }).path}?`
          : name === "aria_replace_node"
            ? (value) => `Replace Composer node ${(value as { path: string }).path}?`
            : undefined,
      async execute(runtime, input) {
        if (!runtime.executeRendererTool) {
          return agentToolFail("NO_OPEN_DOCUMENT", "No Composer document host is registered for this project.");
        }
        // open_in_composer must not fence on the previous document file.
        if (name === "open_in_composer") {
          return runtime.executeRendererTool(name, input, runtime.abortSignal);
        }
        const expectedDocument = runtime.shellContext?.documentContext;
        return runtime.executeRendererTool(
          name,
          expectedDocument
            ? {
                ...input,
                __expectedFile: expectedDocument.file,
                __expectedMtimeMs: expectedDocument.mtimeMs,
              }
            : input,
          runtime.abortSignal,
        );
      },
    }),
  ),
  descriptor({
    name: "aria_search_commands",
    description: "Search session-available Aria commands by name or description. Returns only tools the desktop agent can run now.",
    inputSchema: z.object({ query: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(25).default(10) }).strict(),
    executionPlane: "main",
    mutation: "read",
    execute(runtime, input) {
      return agentToolOk({
        commands: searchAvailableCommands({
          descriptors: listAgentToolDescriptors(),
          runtime,
          composerMode: runtime.composerMode ?? "agent",
          query: input.query,
          limit: input.limit,
        }),
      });
    },
  }),
  descriptor({
    name: "aria_describe_command",
    description: "Describe one available Aria command, including its exact JSON input schema. Use before aria_execute_command.",
    inputSchema: z.object({ name: z.string().trim().min(1).max(200) }).strict(),
    executionPlane: "main",
    mutation: "read",
    async execute(runtime, input) {
      const described = await describeAvailableCommand({
        descriptors: listAgentToolDescriptors(),
        runtime,
        composerMode: runtime.composerMode ?? "agent",
        name: input.name,
      });
      if (!described) {
        return agentToolFail("NOT_FOUND", `Command not available in this session: ${input.name}`);
      }
      return agentToolOk(described);
    },
  }),
  descriptor({
    name: "aria_execute_command",
    description: "Execute one available typed Aria command. Input is validated by the command schema and runs through the same approval policy as direct tools.",
    inputSchema: z
      .object({
        command: z.string().trim().min(1).max(200),
        input: z.unknown().optional(),
      })
      .strict(),
    executionPlane: "main",
    mutation: "write",
    delegate: (input) => ({
      toolName: input.command,
      args: input.input ?? {},
    }),
    execute: () =>
      agentToolFail("INTERNAL", "Delegated command was not resolved."),
  }),
  descriptor({
    name: "aria_search_capabilities",
    description: "Search the engineering parity ledger (available and unavailable). Prefer aria_search_commands for executable tools.",
    inputSchema: z.object({ query: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(25).default(10) }).strict(),
    executionPlane: "main",
    mutation: "read",
    execute(_runtime, input) {
      const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);
      const matches = AGENT_PARITY_MANIFEST
        .map((entry) => {
          const text = `${entry.name} ${entry.reason ?? ""} ${entry.replacement ?? ""}`.toLowerCase();
          return {
            entry,
            score: terms.reduce(
              (score: number, term: string) =>
                score + (text.includes(term) ? 1 : 0),
              0,
            ),
          };
        })
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name))
        .slice(0, input.limit)
        .map(({ entry }) => entry);
      return agentToolOk({ capabilities: matches });
    },
  }),
  descriptor({
    name: "aria_describe_capability",
    description: "Describe one canonical capability and whether aria-app currently implements it (parity ledger).",
    inputSchema: z.object({ name: z.string().trim().min(1).max(200) }).strict(),
    executionPlane: "main",
    mutation: "read",
    execute(_runtime, input) {
      const entry = parityEntry(input.name);
      if (!entry) return agentToolFail("NOT_FOUND", `Unknown canonical capability: ${input.name}`);
      const runtime = AGENT_TOOL_REGISTRY.get(entry.name);
      return agentToolOk({
        ...entry,
        registered: Boolean(runtime),
        description: runtime?.description,
        mutation: runtime?.mutation,
        executionPlane: runtime?.executionPlane,
      });
    },
  }),
  ...adminResourceDescriptors,
];

export const AGENT_TOOL_REGISTRY = new Map(
  registry.map((item) => [item.name, item] as const),
);

const CMS_TRANSACTION_TOOLS = new Set([
  "aria_create_collection",
  "aria_update_collection",
  "aria_delete_collection",
  "aria_setup_blog",
  "aria_import_markdown",
  "aria_create_entry",
  "aria_update_entry",
  "aria_save_entry_translation",
  "aria_duplicate_entry",
  "aria_delete_entry",
  "aria_publish_entry",
  "aria_unpublish_entry",
  "aria_archive_entry",
  "aria_restore_entry_revision",
]);

const DIRTY_CMS_BLOCKED_TOOLS = new Set([
  "aria_setup_blog",
  "aria_import_markdown",
  "aria_create_entry",
  "aria_update_entry",
  "aria_save_entry_translation",
  "aria_duplicate_entry",
  "aria_delete_entry",
  "aria_publish_entry",
  "aria_unpublish_entry",
  "aria_archive_entry",
  "aria_restore_entry_revision",
]);

for (const [name, registered] of AGENT_TOOL_REGISTRY) {
  if (CMS_TRANSACTION_TOOLS.has(name)) registered.mutationBoundary = "cms";
  if (DIRTY_CMS_BLOCKED_TOOLS.has(name)) registered.blocksOnDirtyCms = true;
}

export function listAgentToolDescriptors(): AgentToolDescriptor[] {
  return [...AGENT_TOOL_REGISTRY.values()];
}

export type ResolvedAgentInvocation = {
  outerDescriptor: AgentToolDescriptor;
  outerArgs: unknown;
  descriptor: AgentToolDescriptor;
  args: unknown;
  chain: string[];
  risk?: AgentConfirmationCategory;
  confirmationSummary?: string;
};

type AgentInvocationResolution =
  | { ok: true; value: ResolvedAgentInvocation }
  | { ok: false; result: AgentToolResult };

const FORBIDDEN_DELEGATED_COMMANDS = new Set([
  "aria_execute_command",
  "aria_search_commands",
  "aria_describe_command",
]);

export function resolveAgentInvocation(
  toolName: string,
  input: unknown,
): AgentInvocationResolution {
  const outerDescriptor = AGENT_TOOL_REGISTRY.get(toolName);
  if (!outerDescriptor) {
    return { ok: false, result: agentToolFail("NOT_FOUND", `Unknown tool: ${toolName}`) };
  }
  const outerParsed = outerDescriptor.inputSchema.safeParse(input);
  if (!outerParsed.success) {
    return {
      ok: false,
      result: agentToolFail("INVALID_INPUT", `Invalid input for ${outerDescriptor.name}.`, {
        suggestedFix: outerParsed.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
          .join("; "),
      }),
    };
  }

  let descriptor = outerDescriptor;
  let args = outerParsed.data;
  const chain = [outerDescriptor.name];
  for (let depth = 0; descriptor.delegate; depth += 1) {
    if (depth >= 6) {
      return {
        ok: false,
        result: agentToolFail("INVALID_INPUT", "Tool delegation exceeded the safe depth."),
      };
    }
    const delegated = descriptor.delegate(args);
    if (
      descriptor.name === "aria_execute_command" &&
      FORBIDDEN_DELEGATED_COMMANDS.has(delegated.toolName)
    ) {
      return {
        ok: false,
        result: agentToolFail("INVALID_INPUT", "Cannot nest discovery/execute commands."),
      };
    }
    if (chain.includes(delegated.toolName)) {
      return {
        ok: false,
        result: agentToolFail("INVALID_INPUT", "Tool delegation contains a cycle."),
      };
    }
    const next = AGENT_TOOL_REGISTRY.get(delegated.toolName);
    if (!next) {
      return {
        ok: false,
        result: agentToolFail("NOT_FOUND", `Unknown command: ${delegated.toolName}`),
      };
    }
    const parsed = next.inputSchema.safeParse(delegated.args);
    if (!parsed.success) {
      return {
        ok: false,
        result: agentToolFail("INVALID_INPUT", `Invalid input for ${next.name}.`, {
          suggestedFix: parsed.error.issues
            .slice(0, 3)
            .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
            .join("; "),
        }),
      };
    }
    descriptor = next;
    args = parsed.data;
    chain.push(descriptor.name);
  }

  const risk = descriptor.riskForInput?.(args) ?? descriptor.risk;
  return {
    ok: true,
    value: {
      outerDescriptor,
      outerArgs: outerParsed.data,
      descriptor,
      args,
      chain,
      risk,
      confirmationSummary: risk
        ? descriptor.confirmationSummary?.(args) ??
          `Confirm ${descriptor.description.toLowerCase()}`
        : undefined,
    },
  };
}

export function agentToolNeedsApproval(toolName: string, input: unknown): boolean {
  const resolved = resolveAgentInvocation(toolName, input);
  return resolved.ok && Boolean(resolved.value.risk);
}

export function describeAgentToolApproval(
  toolName: string,
  input: unknown,
): { summary: string; category: AgentConfirmationCategory } | null {
  const resolved = resolveAgentInvocation(toolName, input);
  if (!resolved.ok || !resolved.value.risk) return null;
  return {
    category: resolved.value.risk,
    summary: resolved.value.confirmationSummary!,
  };
}

export function normalizeAgentToolArguments(
  toolName: string,
  input: unknown,
): { ok: true; value: unknown } | { ok: false } {
  const resolved = resolveAgentInvocation(toolName, input);
  if (!resolved.ok || !resolved.value.risk) return { ok: false };
  return {
    ok: true,
    value: {
      outer: {
        toolName: resolved.value.outerDescriptor.name,
        args: resolved.value.outerArgs,
      },
      target: {
        toolName: resolved.value.descriptor.name,
        args: resolved.value.args,
      },
    },
  };
}

function bounded(result: AgentToolResult, maxChars: number): AgentToolResult {
  const encoded = JSON.stringify(result);
  if (encoded.length <= maxChars) return result;
  return agentToolOk({
    truncated: true,
    preview: encoded.slice(0, maxChars),
    message: "The result exceeded the tool output limit. Narrow or paginate the request.",
  });
}

async function executeDescriptor(
  descriptor: AgentToolDescriptor,
  runtime: AgentToolRuntime,
  normalizedInput: unknown,
): Promise<AgentToolResult> {
  try {
    const run = () => descriptor.execute(runtime, normalizedInput);
    const runWithDomainBoundary = () =>
      descriptor.mutation === "write" && descriptor.mutationBoundary === "cms"
        ? runCmsTransaction(runtime.projectPath, descriptor.name, run)
        : run();
    // Discovery/execute is a packaging bridge — nested tools own mutation fencing.
    const wrapProjectMutation =
      descriptor.mutation === "write" &&
      descriptor.executionPlane === "main";
    const result = wrapProjectMutation
      ? await runProjectMutation(
          runtime.projectPath,
          { actor: "agent", surface: "agent", operation: descriptor.description, targets: [descriptor.name] },
          runWithDomainBoundary,
        )
      : await runWithDomainBoundary();
    const limited = bounded(result, descriptor.outputLimit);
    logActivity(runtime, descriptor, normalizedInput, limited);
    return limited;
  } catch (error) {
    const result = mapToolError(error);
    logActivity(runtime, descriptor, normalizedInput, result);
    return result;
  }
}

export async function invokeAgentTool(input: {
  runtime: AgentToolRuntime;
  composerMode: AgentComposerMode;
  toolName: string;
  args: unknown;
  approvedBySdk?: boolean;
}): Promise<AgentToolResult> {
  const resolved = resolveAgentInvocation(input.toolName, input.args);
  if (!resolved.ok) return resolved.result;
  const { outerDescriptor, descriptor, args, chain, risk } = resolved.value;
  for (const name of chain) {
    const item = AGENT_TOOL_REGISTRY.get(name)!;
    if (item.availability && !item.availability(input.runtime)) {
      return agentToolFail("PLATFORM_UNAVAILABLE", `${item.name} is not available in this project.`);
    }
  }
  if (
    input.composerMode === "ask" &&
    (outerDescriptor.mutation === "write" || descriptor.mutation === "write")
  ) {
    return agentToolFail("INVALID_INPUT", "Ask mode cannot run mutation tools.", {
      suggestedFix: "Switch to Agent mode to make changes.",
    });
  }
  const normalizeDocumentFile = (value: string) =>
    value.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
  const openDocumentFile = input.runtime.shellContext?.documentContext?.file;
  const closedDocumentFile = descriptor.requiresClosedDocument?.(args);
  if (
    openDocumentFile &&
    closedDocumentFile &&
    normalizeDocumentFile(openDocumentFile) ===
      normalizeDocumentFile(closedDocumentFile)
  ) {
    return agentToolFail(
      "UNSAVED_CHANGES",
      `${closedDocumentFile} is open in Composer and cannot be changed through a disk-based document command.`,
      {
        suggestedFix:
          "Use the live Composer canvas tools so the change participates in document history and save state.",
      },
    );
  }
  if (
    descriptor.executionPlane === "main" &&
    descriptor.mutation === "write" &&
    input.runtime.shellContext?.cmsContext?.dirty &&
    descriptor.blocksOnDirtyCms
  ) {
    return agentToolFail(
      "UNSAVED_CHANGES",
      "The open CMS entry has unsaved changes. Save or discard them before the Agent mutates CMS content.",
    );
  }
  if (risk && !input.approvedBySdk) {
    return agentToolFail(
      "CONFIRMATION_REQUIRED",
      "This operation must be approved through the conversation tool protocol.",
      { confirmationCategory: risk },
    );
  }
  return executeDescriptor(
    descriptor,
    { ...input.runtime, composerMode: input.composerMode },
    args,
  );
}
