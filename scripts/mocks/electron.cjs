module.exports = {
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  },
  BrowserWindow: class BrowserWindow {},
};
