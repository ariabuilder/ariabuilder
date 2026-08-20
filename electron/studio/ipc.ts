import type { StudioDocumentKind } from "../../shared/types";
import { shell, type IpcMainInvokeEvent } from "../electron-api";
import type { IpcRegistrar, IpcRuntimeContext } from "../ipc/registrar";
import { requireOpenSession } from "../sessions";
import {
  deleteStudioDocument,
  duplicateStudioDocument,
  inspectStudioComponent,
  resolveStudioDocumentFile,
} from "./documents";

function documentInput(value: unknown): {
  kind: StudioDocumentKind;
  file: string;
} {
  if (!value || typeof value !== "object") throw new Error("Document input is required");
  const input = value as { kind?: unknown; file?: unknown };
  if (input.kind !== "component" && input.kind !== "layout") {
    throw new Error("Invalid document kind");
  }
  if (typeof input.file !== "string" || !input.file.trim()) {
    throw new Error("Document file is required");
  }
  return { kind: input.kind, file: input.file.trim() };
}

export function registerStudioDocumentsIpc(
  registrar: IpcRegistrar,
  _context: IpcRuntimeContext,
): void {
  const { handle } = registrar;

  handle(
    "workspace:inspect_component",
    (_event: IpcMainInvokeEvent, projectPath: string, relativeFile: string) => {
      if (typeof projectPath !== "string" || !projectPath.trim()) {
        throw new Error("Project path is required");
      }
      if (typeof relativeFile !== "string" || !relativeFile.trim()) {
        throw new Error("Component file is required");
      }
      return inspectStudioComponent(requireOpenSession(projectPath), relativeFile.trim());
    },
  );

  handle(
    "workspace:duplicate_studio_document",
    (
      _event: IpcMainInvokeEvent,
      projectPath: string,
      rawInput: unknown,
    ) => {
      if (typeof projectPath !== "string" || !projectPath.trim()) {
        throw new Error("Project path is required");
      }
      const input = documentInput(rawInput);
      const name = (rawInput as { name?: unknown }).name;
      if (typeof name !== "string" || !name.trim()) {
        throw new Error("Document name is required");
      }
      return duplicateStudioDocument(requireOpenSession(projectPath), {
        ...input,
        name: name.trim(),
      });
    },
  );

  handle(
    "workspace:delete_studio_document",
    (
      _event: IpcMainInvokeEvent,
      projectPath: string,
      rawInput: unknown,
    ) => {
      if (typeof projectPath !== "string" || !projectPath.trim()) {
        throw new Error("Project path is required");
      }
      return deleteStudioDocument(requireOpenSession(projectPath), documentInput(rawInput));
    },
  );

  handle(
    "workspace:resolve_studio_document",
    (
      _event: IpcMainInvokeEvent,
      projectPath: string,
      rawInput: unknown,
    ) => {
      if (typeof projectPath !== "string" || !projectPath.trim()) {
        throw new Error("Project path is required");
      }
      const input = documentInput(rawInput);
      return {
        path: resolveStudioDocumentFile(
          requireOpenSession(projectPath),
          input.kind,
          input.file,
        ),
      };
    },
  );

  handle(
    "workspace:reveal_studio_document",
    (
      _event: IpcMainInvokeEvent,
      projectPath: string,
      rawInput: unknown,
    ) => {
      if (typeof projectPath !== "string" || !projectPath.trim()) {
        throw new Error("Project path is required");
      }
      const input = documentInput(rawInput);
      const absolute = resolveStudioDocumentFile(
        requireOpenSession(projectPath),
        input.kind,
        input.file,
      );
      shell.showItemInFolder(absolute);
      return { path: absolute };
    },
  );
}
