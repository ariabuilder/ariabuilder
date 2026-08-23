import { configureMutationCoordinator } from "../mutations";
import { configureComposerDraftPreview } from "../composer";
import { registerAppIpc } from "../app/ipc";
import { registerProjectIpc } from "../project/ipc";
import { registerThumbsIpc } from "../thumbs/ipc";
import { registerHistoryIpc } from "../history/ipc";
import { registerWorkspaceIpc } from "../workspace/ipc/core";
import { registerCollectionsIpc } from "../workspace/ipc/collections";
import { registerCmsEntriesIpc } from "../cms/ipc/entries";
import { registerCmsImportsIpc } from "../cms/ipc/imports";
import { registerExportsIpc } from "../workspace/ipc/exports";
import { registerMediaIpc } from "../media/ipc";
import { registerSiteSettingsIpc } from "../site/ipc/settings";
import { registerSiteDiscoveryIpc } from "../site/ipc/discovery";
import { registerStudioDocumentsIpc } from "../studio/ipc";
import { registerComposerIpc } from "../composer/ipc";
import { registerDesignIpc } from "../design/ipc";
import { registerGitIpc } from "../git/ipc";
import { registerTerminalIpc } from "../terminal/ipc";
import { registerAgentIpc } from "../agent/ipc";
import { registerUtilitiesIpc } from "../utilities/ipc";
import type { IpcRegistrar, IpcRuntimeContext } from "./registrar";

export function registerAllIpc(
  registrar: IpcRegistrar,
  context: IpcRuntimeContext,
): void {
  configureMutationCoordinator(context.userDataPath);
  configureComposerDraftPreview(context.userDataPath);
  registerAppIpc(registrar, context);
  registerProjectIpc(registrar, context);
  registerThumbsIpc(registrar, context);
  registerHistoryIpc(registrar, context);
  registerWorkspaceIpc(registrar, context);
  registerCollectionsIpc(registrar, context);
  registerCmsEntriesIpc(registrar, context);
  registerCmsImportsIpc(registrar, context);
  registerExportsIpc(registrar, context);
  registerMediaIpc(registrar, context);
  registerSiteSettingsIpc(registrar, context);
  registerSiteDiscoveryIpc(registrar, context);
  registerStudioDocumentsIpc(registrar, context);
  registerComposerIpc(registrar, context);
  registerDesignIpc(registrar, context);
  registerGitIpc(registrar, context);
  registerTerminalIpc(registrar, context);
  registerAgentIpc(registrar, context);
  registerUtilitiesIpc(registrar, context);
}
