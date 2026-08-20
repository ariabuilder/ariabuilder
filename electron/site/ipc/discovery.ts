import { type IpcMainInvokeEvent } from "../../electron-api";
import { requireOpenSession } from "../../sessions";
import { installFaviconFile, pickFaviconFile, readPublicAssetDataUrl, readSiteSettings, writeSiteSettings } from "../../siteSettings";
import { loadDiscoveryContext } from "../../loadDiscoveryContext";
import { prepareSeoTakeover, withRefreshedSeoScan, seoTakeoverChecklist } from "../../seoTakeover";
import { buildDiscoveryArtifacts, buildGeneratedDiscoveryBaseline, DiscoveryGeneratedBaselineSchema } from "../../../shared/crawl";
import { createRedirect, deleteRedirect, flattenRedirectChain, importRedirectsCsv, listRedirects, listRedirectTargets, updateRedirect } from "../../redirects";
import { runProjectMutation } from "../../mutations";
import type { IpcRegistrar, IpcRuntimeContext } from "../../ipc/registrar";

export function registerSiteDiscoveryIpc(
  registrar: IpcRegistrar,
  context: IpcRuntimeContext,
): void {
  const { handle } = registrar;
  handle(
      "workspace:list_redirects",
      async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        options?: { includeDisabled?: boolean },
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        const root = requireOpenSession(projectPath);
        return { redirects: listRedirects(root, options) };
      },
    );

  handle(
      "workspace:list_redirect_targets",
      async (_event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        const root = requireOpenSession(projectPath);
        return { targets: await listRedirectTargets(root) };
      },
    );

  handle(
      "workspace:create_redirect",
      async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: {
          fromPath: string;
          toPath: string;
          statusCode?: 301 | 302;
          enabled?: boolean;
          note?: string;
        },
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return createRedirect(requireOpenSession(projectPath), input);
      },
    );

  handle(
      "workspace:update_redirect",
      async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: {
          id: string;
          fromPath?: string;
          toPath?: string;
          statusCode?: 301 | 302;
          enabled?: boolean;
          note?: string | null;
        },
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return updateRedirect(requireOpenSession(projectPath), input);
      },
    );

  handle(
      "workspace:delete_redirect",
      async (_event: IpcMainInvokeEvent, projectPath: string, id: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof id !== "string" || !id.trim()) {
          throw new Error("Redirect id is required");
        }
        return deleteRedirect(requireOpenSession(projectPath), id);
      },
    );

  handle(
      "workspace:flatten_redirect_chain",
      async (_event: IpcMainInvokeEvent, projectPath: string, id: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof id !== "string" || !id.trim()) {
          throw new Error("Redirect id is required");
        }
        return flattenRedirectChain(requireOpenSession(projectPath), id);
      },
    );

  handle(
      "workspace:import_redirects_csv",
      async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: { csv: string; replaceExisting?: boolean },
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof input?.csv !== "string" || !input.csv.trim()) {
          throw new Error("CSV is required");
        }
        return importRedirectsCsv(
          requireOpenSession(projectPath),
          input.csv,
          input.replaceExisting === true,
        );
      },
    );

  handle(
      "workspace:get_discovery_artifacts",
      async (_event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        const root = requireOpenSession(projectPath);
        const settings = readSiteSettings(root);
        const { pages, cmsEntries } = await loadDiscoveryContext(root, settings);
        return buildDiscoveryArtifacts({
          siteSettings: settings,
          pages,
          cmsEntries,
        });
      },
    );

  handle(
      "workspace:get_discovery_baseline",
      async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        artifact: "robots" | "sitemap" | "llms",
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (artifact !== "robots" && artifact !== "sitemap" && artifact !== "llms") {
          throw new Error("Invalid discovery artifact");
        }
        const root = requireOpenSession(projectPath);
        const settings = readSiteSettings(root);
        const { pages } = await loadDiscoveryContext(root, settings);
        const content = buildGeneratedDiscoveryBaseline({
          artifact,
          siteSettings: settings,
          pages,
          forEditorSeed: true,
        });
        return DiscoveryGeneratedBaselineSchema.parse({
          artifact,
          content,
          generatedAt: new Date().toISOString(),
        });
      },
    );

  handle(
      "workspace:scan_seo_sources",
      (_event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        const root = requireOpenSession(projectPath);
        const current = readSiteSettings(root);
        const next = withRefreshedSeoScan(root, current);
        return writeSiteSettings(root, next);
      },
    );

  handle(
      "workspace:confirm_seo_takeover",
      (_event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        const root = requireOpenSession(projectPath);
        const current = readSiteSettings(root);
        const next = prepareSeoTakeover(root, current);
        return writeSiteSettings(root, next);
      },
    );

  handle(
      "workspace:seo_takeover_checklist",
      (_event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        const settings = readSiteSettings(requireOpenSession(projectPath));
        return seoTakeoverChecklist(settings);
      },
    );

  handle(
      "workspace:pick_favicon",
      async (event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        const root = requireOpenSession(projectPath);
        const selection = await pickFaviconFile(context.senderWindow(event));
        if ("canceled" in selection) return selection;
        return runProjectMutation(
          root,
          { actor: "user", surface: "workspace", operation: "pick favicon", targets: [] },
          () => installFaviconFile(root, selection.filePath),
        );
      },
    );

  handle(
      "workspace:favicon_preview",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        faviconPath: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof faviconPath !== "string" || !faviconPath.trim()) {
          return { dataUrl: null as string | null };
        }
        return {
          dataUrl: readPublicAssetDataUrl(requireOpenSession(projectPath), faviconPath),
        };
      },
    );
}
