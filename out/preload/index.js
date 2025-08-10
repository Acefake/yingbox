"use strict";
const preload = require("@electron-toolkit/preload");
const electron = require("electron");
const api = {
  file: {
    // Read file content
    read: (filePath) => electron.ipcRenderer.invoke("file:read", filePath),
    // Write content to file
    write: (filePath, content) => electron.ipcRenderer.invoke("file:write", filePath, content),
    // Delete file
    delete: (filePath) => electron.ipcRenderer.invoke("file:delete", filePath),
    // Check if file exists
    exists: (filePath) => electron.ipcRenderer.invoke("file:exists", filePath),
    // Create directory
    mkdir: (dirPath) => electron.ipcRenderer.invoke("file:mkdir", dirPath),
    // Read directory contents
    readdir: (dirPath) => electron.ipcRenderer.invoke("file:readdir", dirPath),
    // Read directory contents recursively
    readdirRecursive: (dirPath) => electron.ipcRenderer.invoke("file:readdirRecursive", dirPath),
    // Get file stats
    stat: (filePath) => electron.ipcRenderer.invoke("file:stat", filePath),
    // Copy file
    copy: (srcPath, destPath) => electron.ipcRenderer.invoke("file:copy", srcPath, destPath),
    // Move file
    move: (srcPath, destPath) => electron.ipcRenderer.invoke("file:move", srcPath, destPath),
    // Read image as data URL
    readImage: (filePath) => electron.ipcRenderer.invoke("file:readImage", filePath)
  },
  http: {
    // Download file from URL
    download: (url, filePath) => electron.ipcRenderer.invoke("http:download", url, filePath)
  },
  path: {
    // Join path segments
    join: (...paths) => electron.ipcRenderer.invoke("path:join", ...paths),
    // Resolve path
    resolve: (...paths) => electron.ipcRenderer.invoke("path:resolve", ...paths),
    // Get directory name
    dirname: (filePath) => electron.ipcRenderer.invoke("path:dirname", filePath),
    // Get base name
    basename: (filePath, ext) => electron.ipcRenderer.invoke("path:basename", filePath, ext),
    // Get file extension
    extname: (filePath) => electron.ipcRenderer.invoke("path:extname", filePath)
  },
  // Dialog operations
  dialog: {
    // Open directory dialog
    openDirectory: () => electron.ipcRenderer.invoke("dialog:openDirectory"),
    // Open file dialog
    openFile: (options) => electron.ipcRenderer.invoke("dialog:openFile", options),
    saveFile: (options) => electron.ipcRenderer.invoke("dialog:saveFile", options)
  },
  app: {
    // Get app version info from package.json
    getVersion: () => electron.ipcRenderer.invoke("app:getVersion")
  }
};
if (process.contextIsolated) {
  try {
    electron.contextBridge.exposeInMainWorld("electron", preload.electronAPI);
    electron.contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  window.electron = preload.electronAPI;
  window.api = api;
}
