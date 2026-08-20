export const app = {
  isPackaged: false,
  getPath: () => "/tmp",
  getVersion: () => "0.0.0-test",
  whenReady: async () => {},
  on: () => {},
};
export const BrowserWindow = class BrowserWindow {};
export const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
};
export const ipcMain = { handle: () => {} };
export const shell = { openExternal: async () => {} };
