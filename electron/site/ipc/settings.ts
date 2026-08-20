import { type IpcMainInvokeEvent } from "../../electron-api";
import { requireOpenSession } from "../../sessions";
import { readSiteSettings, writeSiteSettings, updateContentLocalization, updateAnalyticsSettings, updateDiscoverySettings, updateSeoDefaults, type SiteSettings } from "../../siteSettings";
import { scanInjectionSources } from "../../injectionSourceScan";
import { updateSourceInjection } from "../../injectionSourceWrite";
import type { UpdateSourceInjectionInput } from "../../../shared/injections";
import { loadDiscoveryContext } from "../../loadDiscoveryContext";
import { buildDiscoveryReport, type DiscoverySettings } from "../../../shared/crawl";
import { listRedirects } from "../../redirects";
import type { IpcRegistrar, IpcRuntimeContext } from "../../ipc/registrar";

export function registerSiteSettingsIpc(
  registrar: IpcRegistrar,
  _context: IpcRuntimeContext,
): void {
  const { handle } = registrar;
  handle(
      "workspace:get_site_settings",
      (_event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return readSiteSettings(requireOpenSession(projectPath));
      },
    );

  handle(
      "workspace:set_site_settings",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        settings: SiteSettings,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return writeSiteSettings(requireOpenSession(projectPath), settings);
      },
    );

  handle(
      "workspace:update_content_localization",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        content: import("../../../shared/localization").ContentLocalizationSettings,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return updateContentLocalization(requireOpenSession(projectPath), content);
      },
    );

  handle(
      "workspace:update_seo_defaults",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        patch: {
          seoTitle?: string;
          seoDescription?: string;
          ogImage?: string;
          seoKeywords?: string;
          twitterCard?: string;
        },
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return updateSeoDefaults(requireOpenSession(projectPath), patch ?? {});
      },
    );

  handle(
      "workspace:update_analytics",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        analytics: import("../../../shared/types").AnalyticsSettings,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return updateAnalyticsSettings(
          requireOpenSession(projectPath),
          analytics,
        );
      },
    );

  handle(
      "workspace:scan_injections",
      (_event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return scanInjectionSources(requireOpenSession(projectPath));
      },
    );

  handle(
      "workspace:update_source_injection",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: UpdateSourceInjectionInput,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (!input || typeof input !== "object" || typeof input.op !== "string") {
          throw new Error("Injection update is required");
        }
        return updateSourceInjection(requireOpenSession(projectPath), input);
      },
    );

  handle(
      "workspace:update_discovery",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        patch: Partial<DiscoverySettings>,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return updateDiscoverySettings(
          requireOpenSession(projectPath),
          patch ?? {},
        );
      },
    );

  handle(
      "workspace:get_discovery_report",
      async (_event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        const root = requireOpenSession(projectPath);
        const settings = readSiteSettings(root);
        const { pages } = await loadDiscoveryContext(root, settings);
        return buildDiscoveryReport({
          siteSettings: settings,
          pages,
          redirects: listRedirects(root, { includeDisabled: true }),
        });
      },
    );
}
