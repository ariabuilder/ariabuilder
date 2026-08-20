import type { ComposerEditTransaction } from "../../shared/composer";
import { runCmsTransaction } from "../cms";
import {
  ipcMain,
  type BrowserWindow as BrowserWindowType,
  type IpcMainInvokeEvent,
} from "../electron-api";
import { shouldRejectIpcDuringShutdown } from "../ipcShutdownPolicy";
import {
  mutationMetaForChannel,
  runProjectMutation,
} from "../mutations";
import { assertRendererReady, assertTrustedIpc } from "../security";
import { requireOpenSession } from "../sessions";

export type IpcHandleOptions = {
  beforeHandshake?: boolean;
  duringShutdown?: boolean;
};

export interface IpcRegistrar {
  handle<TArgs extends unknown[]>(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: TArgs) => unknown,
    options?: IpcHandleOptions,
  ): void;
}

export interface IpcRuntimeContext {
  userDataPath: string;
  getVersion(): string;
  createWindow(initialProject?: string): BrowserWindowType;
  refreshApplicationMenu(): void;
  senderWindow(event: IpcMainInvokeEvent): BrowserWindowType | null;
}

type CreateIpcRegistrarOptions = {
  appRoot: string;
  isDev: boolean;
  devUrl: string;
  rendererToken?: string;
  trustedRenderers: Set<number>;
  isAppWindow(win: BrowserWindowType): boolean;
  isQuitting(): boolean;
};

export function createIpcRegistrar(
  options: CreateIpcRegistrarOptions,
): IpcRegistrar {
  const registeredChannels = new Set<string>();

  return {
    handle<TArgs extends unknown[]>(
      channel: string,
      listener: (event: IpcMainInvokeEvent, ...args: TArgs) => unknown,
      handleOptions?: IpcHandleOptions,
    ): void {
      if (registeredChannels.has(channel)) {
        throw new Error(`Duplicate IPC channel registration: ${channel}`);
      }
      registeredChannels.add(channel);

      ipcMain.handle(channel, (event, ...args: unknown[]) => {
        if (
          shouldRejectIpcDuringShutdown(
            options.isQuitting(),
            channel,
            handleOptions?.duringShutdown,
          )
        ) {
          throw new Error("Aria is shutting down");
        }

        const securityConfig = {
          isAppWindow: options.isAppWindow,
          appRoot: options.appRoot,
          isDev: options.isDev,
          devUrl: options.devUrl,
          rendererToken: options.rendererToken,
          trustedRenderers: options.trustedRenderers,
          requireHandshake: options.isDev && !handleOptions?.beforeHandshake,
        };

        if (handleOptions?.beforeHandshake) {
          if (channel !== "renderer:ready") {
            throw new Error("Invalid pre-handshake IPC channel");
          }
          assertRendererReady(event, securityConfig, args[0]);
        } else {
          assertTrustedIpc(event, securityConfig);
        }

        const mutationMeta = mutationMetaForChannel(channel, args);
        if (!mutationMeta) {
          return listener(event, ...(args as TArgs));
        }

        const projectPath =
          channel === "composer:commit_transaction"
            ? (args[0] as ComposerEditTransaction | undefined)?.projectPath
            : args[0];
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        const root = requireOpenSession(projectPath);
        const invoke = () => listener(event, ...(args as TArgs));
        const cmsMutation =
          channel.startsWith("cms:") ||
          channel === "workspace:update_collections";
        return runProjectMutation(root, mutationMeta, () =>
          cmsMutation
            ? runCmsTransaction(root, mutationMeta.operation, invoke)
            : invoke(),
        );
      });
    },
  };
}
