import type { UtilityLibraryId } from "../../shared/utilities";
import type { IpcRegistrar, IpcRuntimeContext } from "../ipc/registrar";
import { requireOpenSession } from "../sessions";
import {
  activateUtilityLibrary,
  disableUtilityLibrary,
  inspectUtilityManager,
} from "./index";

export function registerUtilitiesIpc(
  registrar: IpcRegistrar,
  _context: IpcRuntimeContext,
): void {
  const { handle } = registrar;
  handle("utilities:inspect", (_event, projectPath: string) =>
    inspectUtilityManager(requireOpenSession(projectPath)));
  handle(
    "utilities:activate",
    (event, projectPath: string, library: UtilityLibraryId) => {
      const root = requireOpenSession(projectPath);
      return activateUtilityLibrary(root, library, (progress) => {
        event.sender.send("utilities:progress", progress);
      });
    },
  );
  handle(
    "utilities:disable",
    (event, projectPath: string, library: UtilityLibraryId) => {
      const root = requireOpenSession(projectPath);
      return disableUtilityLibrary(root, library, (progress) => {
        event.sender.send("utilities:progress", progress);
      });
    },
  );
}
