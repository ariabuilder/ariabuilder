import { createRequire } from "node:module";
import type {
  BrowserWindow as BrowserWindowType,
  IpcMainInvokeEvent,
} from "electron";

const require = createRequire(import.meta.url);
const electron = require("electron") as typeof import("electron");

export const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  session,
  shell,
} = electron;
export type BrowserWindow = BrowserWindowType;
export type { IpcMainInvokeEvent };
