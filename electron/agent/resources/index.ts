/**
 * Admin resource verbs — isomorphic CRUD for inventory (not live canvas).
 */

import { z } from "zod";
import {
  agentToolFail,
  agentToolOk,
  type AgentToolResult,
} from "../../../shared/agent";
import { hashRevision } from "../../../shared/agent/revision";
import {
  CreateEntryRequestSchema,
  UpdateEntryRequestSchema,
} from "../../../shared/cms";
import { readCollections } from "../../collections";
import {
  getEntry,
  listEntries,
} from "../../cms";
import {
  readRedirects,
} from "../../redirects";
import { readSiteSettings } from "../../siteSettings";
import { scanProject } from "../../workspace";
import { readPagesMeta } from "../../pagesMeta";
import { listMedia } from "../../media";
import {
  finalizeToolDescriptor,
  type AgentToolDescriptor,
  type AgentToolRuntime,
} from "../toolTypes";

export const ADMIN_RESOURCE_TYPES = [
  "page",
  "layout",
  "component",
  "collection",
  "entry",
  "redirect",
  "discovery",
  "site",
  "media",
] as const;

export type AdminResourceType = (typeof ADMIN_RESOURCE_TYPES)[number];

const ResourceTypeSchema = z.enum(ADMIN_RESOURCE_TYPES);

const documentCreateDataSchema = z
  .object({ name: z.string().trim().min(1).max(255) })
  .strict();
const redirectCreateDataSchema = z
  .object({
    fromPath: z.string().trim().min(1).max(512),
    toPath: z.string().trim().min(1).max(2_048),
    statusCode: z.union([z.literal(301), z.literal(302)]).default(301),
  })
  .strict();
const entryCreateDataSchema = CreateEntryRequestSchema.omit({
  commentsClosed: true,
  status: true,
});
const entryUpdateDataSchema = UpdateEntryRequestSchema.extend({
  patch: UpdateEntryRequestSchema.shape.patch.omit({
    commentsClosed: true,
    status: true,
    translationMeta: true,
  }),
});
const sitePatchSchema = z
  .object({
    siteName: z.string().max(200).optional(),
    siteDescription: z.string().max(2_000).optional(),
    siteUrl: z.string().max(2_048).optional(),
  })
  .strict();
const discoveryPatchSchema = z
  .object({
    expectedRevision: z.string().trim().min(1),
    sitemapMode: z.enum(["auto", "custom", "off"]).optional(),
    robotsMode: z.enum(["auto", "custom"]).optional(),
    includeSitemapInRobots: z.boolean().optional(),
    llmsMode: z.enum(["auto", "custom", "off"]).optional(),
    discourageSearchEngines: z.boolean().optional(),
    trailingSlashPolicy: z.enum(["strip", "add", "none"]).optional(),
    sitemapPingOnPublish: z.boolean().optional(),
    aiBotPolicy: z.enum(["allow-all", "block-training", "custom"]).optional(),
  })
  .strict();
const redirectPatchSchema = z
  .object({
    fromPath: z.string().max(512).optional(),
    toPath: z.string().max(2_048).optional(),
    statusCode: z.union([z.literal(301), z.literal(302)]).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
const pageMetaPatchSchema = z
  .object({
    kind: z.literal("meta"),
    expectedRevision: z.string().trim().min(1),
    changes: z
      .object({
        title: z.string().max(300).optional(),
        description: z.string().max(1_000).optional(),
      })
      .strict(),
  })
  .strict();
const pageSeoPatchSchema = z
  .object({
    kind: z.literal("seo"),
    expectedRevision: z.string().trim().min(1),
    changes: z
      .object({
        title: z.string().max(300).optional(),
        description: z.string().max(1_000).optional(),
        canonical: z.string().max(2_000).optional(),
        noindex: z.boolean().optional(),
        nofollow: z.boolean().optional(),
        ogTitle: z.string().max(300).optional(),
        ogDescription: z.string().max(1_000).optional(),
        ogImage: z.string().max(2_000).optional(),
      })
      .strict(),
  })
  .strict();

const createResourceTypes = z.enum([
  "page",
  "layout",
  "component",
  "redirect",
  "entry",
]);
export const CreateResourceInputSchema = z
  .object({
    type: createResourceTypes,
    data: z.union([
      documentCreateDataSchema,
      redirectCreateDataSchema,
      entryCreateDataSchema,
    ]),
  })
  .strict()
  .superRefine((value, context) => {
    const expected =
      value.type === "redirect"
        ? redirectCreateDataSchema
        : value.type === "entry"
          ? entryCreateDataSchema
          : documentCreateDataSchema;
    const parsed = expected.safeParse(value.data);
    if (!parsed.success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["data"],
        message: `Invalid ${value.type} create payload: ${parsed.error.issues[0]?.message ?? "invalid data"}`,
      });
    }
  });

const patchResourceTypes = z.enum([
  "site",
  "discovery",
  "redirect",
  "page",
  "entry",
]);
export const PatchResourceInputSchema = z
  .object({
    type: patchResourceTypes,
    id: z.string().trim().min(1).optional(),
    patch: z.union([
      sitePatchSchema,
      discoveryPatchSchema,
      redirectPatchSchema,
      pageMetaPatchSchema,
      pageSeoPatchSchema,
      entryUpdateDataSchema,
    ]),
  })
  .strict()
  .superRefine((value, context) => {
    const expected =
      value.type === "site"
        ? sitePatchSchema
        : value.type === "discovery"
          ? discoveryPatchSchema
          : value.type === "redirect"
            ? redirectPatchSchema
            : value.type === "page"
              ? z.union([pageMetaPatchSchema, pageSeoPatchSchema])
              : entryUpdateDataSchema;
    const parsed = expected.safeParse(value.patch);
    if (!parsed.success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["patch"],
        message: `Invalid ${value.type} patch payload: ${parsed.error.issues[0]?.message ?? "invalid patch"}`,
      });
    }
    if ((value.type === "redirect" || value.type === "page") && !value.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: `${value.type} patch requires id.`,
      });
    }
  });

export const DeleteResourceInputSchema = z
  .object({
    type: z.enum(["page", "component", "redirect", "entry"]),
    id: z.string().trim().min(1),
    collectionId: z.string().trim().min(1).optional(),
    version: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.type !== "entry") return;
    if (!value.collectionId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["collectionId"],
        message: "Entry delete requires collectionId.",
      });
    }
    if (!value.version) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["version"],
        message: "Entry delete requires version.",
      });
    }
  });

function collectionRevision(state: ReturnType<typeof readCollections>): string {
  return hashRevision(state, "c");
}

async function listResource(
  runtime: AgentToolRuntime,
  type: AdminResourceType,
  input: { collectionId?: string; limit?: number },
): Promise<AgentToolResult> {
  switch (type) {
    case "page": {
      const scan = await scanProject(runtime.projectPath);
      const pageMeta = readPagesMeta(runtime.projectPath);
      return agentToolOk({
        type,
        items: scan.pages.map(({ route, file, title, mtimeMs }) => ({
          route,
          file,
          title,
          mtimeMs,
        })),
        meta: pageMeta.pages,
        metaRevision: hashRevision(pageMeta, "p"),
      });
    }
    case "component": {
      const scan = await scanProject(runtime.projectPath);
      return agentToolOk({
        type,
        items: scan.components.map(({ id, name, file, mtimeMs }) => ({
          id,
          name,
          file,
          mtimeMs,
        })),
      });
    }
    case "layout": {
      const scan = await scanProject(runtime.projectPath);
      return agentToolOk({
        type,
        items: scan.layouts.map(({ id, name, file, mtimeMs }) => ({
          id,
          name,
          file,
          mtimeMs,
        })),
      });
    }
    case "collection": {
      const state = readCollections(runtime.projectPath);
      return agentToolOk({
        type,
        items: state.collections,
        revision: collectionRevision(state),
        untrustedContent: true,
      });
    }
    case "entry": {
      if (!input.collectionId) {
        return agentToolFail(
          "INVALID_INPUT",
          "list entry requires collectionId.",
        );
      }
      const listed = listEntries(runtime.projectPath, {
        collectionId: input.collectionId,
        limit: input.limit ?? 50,
      });
      return agentToolOk({ type, ...listed, untrustedContent: true });
    }
    case "redirect":
      return agentToolOk({
        type,
        items: readRedirects(runtime.projectPath),
      });
    case "media": {
      const media = listMedia(runtime.projectPath);
      const limit = input.limit ?? 40;
      return agentToolOk({
        type,
        items: media.slice(0, limit).map((asset) => ({
          id: asset.id,
          name: asset.name,
          path: asset.id,
        })),
        total: media.length,
      });
    }
    case "site": {
      const { agent: _agent, ...settings } = readSiteSettings(runtime.projectPath);
      return agentToolOk({ type, site: settings });
    }
    case "discovery": {
      const settings = readSiteSettings(runtime.projectPath);
      return agentToolOk({
        type,
        discovery: settings.discovery ?? null,
        revision: hashRevision(settings.discovery ?? null, "s"),
      });
    }
    default: {
      const _exhaustive: never = type;
      return agentToolFail("INVALID_INPUT", `Unsupported type: ${_exhaustive}`);
    }
  }
}

async function getResource(
  runtime: AgentToolRuntime,
  type: AdminResourceType,
  input: {
    id?: string;
    file?: string;
    collectionId?: string;
    entryId?: string;
  },
): Promise<AgentToolResult> {
  switch (type) {
    case "page":
    case "component":
    case "layout": {
      const file = input.file ?? input.id;
      if (!file) {
        return agentToolFail("INVALID_INPUT", `get ${type} requires file or id.`);
      }
      const scan = await scanProject(runtime.projectPath);
      const candidates =
        type === "page"
          ? scan.pages
          : type === "layout"
            ? scan.layouts
            : scan.components;
      const found = candidates.find(
        (candidate) =>
          candidate.file === file ||
          ("id" in candidate && candidate.id === file) ||
          ("route" in candidate && candidate.route === file),
      );
      if (!found) return agentToolFail("NOT_FOUND", `${type} not found: ${file}`);
      return agentToolOk({
        type,
        item: found,
        hint: "Use aria_read_page / aria_read_component / aria_read_layout for full source.",
      });
    }
    case "collection": {
      const id = input.id ?? input.collectionId;
      if (!id) {
        return agentToolFail("INVALID_INPUT", "get collection requires id.");
      }
      const state = readCollections(runtime.projectPath);
      const collection = state.collections.find((item) => item.id === id);
      if (!collection) return agentToolFail("NOT_FOUND", `Collection not found: ${id}`);
      return agentToolOk({
        type,
        collection,
        revision: collectionRevision(state),
        untrustedContent: true,
      });
    }
    case "entry": {
      const collectionId = input.collectionId;
      const entryId = input.entryId ?? input.id;
      if (!collectionId || !entryId) {
        return agentToolFail(
          "INVALID_INPUT",
          "get entry requires collectionId and entryId (or id).",
        );
      }
      const entry = getEntry(runtime.projectPath, collectionId, entryId);
      if (!entry) return agentToolFail("NOT_FOUND", `Entry not found: ${entryId}`);
      return agentToolOk({ type, entry, untrustedContent: true });
    }
    case "redirect": {
      if (!input.id) {
        return agentToolFail("INVALID_INPUT", "get redirect requires id.");
      }
      const redirect = readRedirects(runtime.projectPath).find(
        (item) => item.id === input.id,
      );
      if (!redirect) return agentToolFail("NOT_FOUND", `Redirect not found: ${input.id}`);
      return agentToolOk({ type, redirect });
    }
    case "site":
      return listResource(runtime, "site", {});
    case "discovery":
      return listResource(runtime, "discovery", {});
    case "media": {
      if (!input.id) {
        return agentToolFail("INVALID_INPUT", "get media requires id.");
      }
      const asset = listMedia(runtime.projectPath).find((item) => item.id === input.id);
      if (!asset) return agentToolFail("NOT_FOUND", `Media not found: ${input.id}`);
      return agentToolOk({ type, asset });
    }
    default: {
      const _exhaustive: never = type;
      return agentToolFail("INVALID_INPUT", `Unsupported type: ${_exhaustive}`);
    }
  }
}

function delegatedOnly(): AgentToolResult {
  return agentToolFail("INTERNAL", "Delegated resource command was not resolved.");
}

export const adminResourceDescriptors: AgentToolDescriptor[] = [
  finalizeToolDescriptor({
    name: "list_resources",
    description:
      "List admin resources (page, layout, component, collection, entry, redirect, discovery, site, media). Not for live Composer canvas.",
    inputSchema: z
      .object({
        type: ResourceTypeSchema,
        collectionId: z.string().trim().min(1).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .strict(),
    executionPlane: "main",
    mutation: "read",
    execute: (runtime, input) =>
      listResource(runtime, input.type, {
        collectionId: input.collectionId,
        limit: input.limit,
      }),
  }),
  finalizeToolDescriptor({
    name: "get_resource",
    description:
      "Get one admin resource by type + id/file. Not for live Composer canvas mutations.",
    inputSchema: z
      .object({
        type: ResourceTypeSchema,
        id: z.string().trim().min(1).optional(),
        file: z.string().trim().min(1).optional(),
        collectionId: z.string().trim().min(1).optional(),
        entryId: z.string().trim().min(1).optional(),
      })
      .strict(),
    executionPlane: "main",
    mutation: "read",
    execute: (runtime, input) =>
      getResource(runtime, input.type, {
        id: input.id,
        file: input.file,
        collectionId: input.collectionId,
        entryId: input.entryId,
      }),
  }),
  finalizeToolDescriptor({
    name: "create_resource",
    description:
      "Create an admin resource (page, layout, component, redirect, entry). Prefer dedicated tools for complex CMS schemas.",
    inputSchema: CreateResourceInputSchema,
    executionPlane: "main",
    mutation: "write",
    delegate: (input) => ({
      toolName:
        input.type === "page"
          ? "aria_create_page"
          : input.type === "layout"
            ? "aria_create_layout"
            : input.type === "component"
              ? "aria_create_component"
              : input.type === "redirect"
                ? "aria_create_redirect"
                : "aria_create_entry",
      args: input.data,
    }),
    execute: delegatedOnly,
  }),
  finalizeToolDescriptor({
    name: "apply_resource_patch",
    description:
      "Patch an admin resource (site, discovery, redirect, page meta/seo, entry). Never use for live canvas nodes.",
    inputSchema: PatchResourceInputSchema,
    executionPlane: "main",
    mutation: "write",
    delegate: (input) => {
      if (input.type === "site") {
        return {
          toolName: "aria_update_site_settings",
          args: sitePatchSchema.parse(input.patch),
        };
      }
      if (input.type === "discovery") {
        return {
          toolName: "aria_update_discovery_settings",
          args: discoveryPatchSchema.parse(input.patch),
        };
      }
      if (input.type === "redirect") {
        return {
          toolName: "aria_update_redirect",
          args: { id: input.id!, ...redirectPatchSchema.parse(input.patch) },
        };
      }
      if (input.type === "entry") {
        const patch = entryUpdateDataSchema.parse(input.patch);
        return {
          toolName: "aria_update_entry",
          args: { ...patch, id: input.id ?? patch.id },
        };
      }
      const patch = z
        .union([pageMetaPatchSchema, pageSeoPatchSchema])
        .parse(input.patch);
      return {
        toolName:
          patch.kind === "seo"
            ? "aria_update_page_seo"
            : "aria_update_page_meta",
        args: {
          file: input.id!,
          expectedRevision: patch.expectedRevision,
          patch: patch.changes,
        },
      };
    },
    execute: delegatedOnly,
  }),
  finalizeToolDescriptor({
    name: "delete_resource",
    description:
      "Delete an admin resource (page, component, redirect, entry). Requires confirmation for destructive types.",
    inputSchema: DeleteResourceInputSchema,
    executionPlane: "main",
    mutation: "write",
    risk: "delete_content",
    confirmationSummary: (input) =>
      `Delete ${(input as { type: string; id: string }).type} ${(input as { id: string }).id}?`,
    delegate: (input) => {
      if (input.type === "page" || input.type === "component") {
        return {
          toolName: "aria_delete_document",
          args: { kind: input.type, file: input.id },
        };
      }
      if (input.type === "redirect") {
        return { toolName: "aria_delete_redirect", args: { id: input.id } };
      }
      return {
        toolName: "aria_delete_entry",
        args: {
          collectionId: input.collectionId!,
          entryId: input.id,
          version: input.version!,
        },
      };
    },
    execute: delegatedOnly,
  }),
];
