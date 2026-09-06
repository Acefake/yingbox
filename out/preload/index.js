"use strict";
const preload = require("@electron-toolkit/preload");
const electron = require("electron");
const api = {
  file: {
    // 读取
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
    scanMediaDirectory: (dirPath, previousIndex) => electron.ipcRenderer.invoke("file:scanMediaDirectory", dirPath, previousIndex),
    // Get file stats
    stat: (filePath) => electron.ipcRenderer.invoke("file:stat", filePath),
    // Copy file
    copy: (srcPath, destPath) => electron.ipcRenderer.invoke("file:copy", srcPath, destPath),
    // Move file
    move: (srcPath, destPath, options) => electron.ipcRenderer.invoke("file:move", srcPath, destPath, options),
    // Read image as data URL
    readImage: (filePath) => electron.ipcRenderer.invoke("file:readImage", filePath)
  },
  http: {
    // Download file from URL
    download: (url, filePath) => electron.ipcRenderer.invoke("http:download", url, filePath),
    // JSON request (GET/POST) via main process Node.js http/https
    fetch: (url, options) => electron.ipcRenderer.invoke("http:fetch", url, options ?? {}),
    // Fetch image as base64 data URL via main process (bypasses hotlink protection)
    fetchImage: (url, referer) => electron.ipcRenderer.invoke("http:fetchImage", url, referer)
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
    saveFile: (options) => electron.ipcRenderer.invoke("dialog:saveFile", options),
    // Select directory (returns single path)
    selectDirectory: () => electron.ipcRenderer.invoke("dialog:selectDirectory")
  },
  config: {
    // Set download path
    setDownloadPath: (path) => electron.ipcRenderer.invoke("config:setDownloadPath", path)
  },
  app: {
    getUserDataPath: () => electron.ipcRenderer.invoke("app:getUserDataPath"),
    // Get app version info from package.json
    getVersion: () => electron.ipcRenderer.invoke("app:getVersion")
  },
  update: {
    check: () => electron.ipcRenderer.invoke("update:check"),
    download: () => electron.ipcRenderer.invoke("update:download"),
    install: () => electron.ipcRenderer.invoke("update:install"),
    onStatus: (cb) => electron.ipcRenderer.on("update:status", (_e, status) => cb(status)),
    offStatus: () => electron.ipcRenderer.removeAllListeners("update:status")
  },
  shell: {
    openPath: (filePath) => electron.ipcRenderer.invoke("shell:openPath", filePath)
  },
  win: {
    minimize: () => electron.ipcRenderer.invoke("win:minimize"),
    maximize: () => electron.ipcRenderer.invoke("win:maximize"),
    close: () => electron.ipcRenderer.invoke("win:close"),
    isMaximized: () => electron.ipcRenderer.invoke("win:isMaximized")
  },
  player: {
    open: (payload) => electron.ipcRenderer.invoke("player:open", payload),
    close: () => electron.ipcRenderer.invoke("player:close"),
    getPending: () => electron.ipcRenderer.invoke("player:getPending"),
    onLoad: (cb) => {
      const handler = (_e, payload) => {
        cb(payload);
      };
      electron.ipcRenderer.on("player:load", handler);
    },
    offLoad: () => electron.ipcRenderer.removeAllListeners("player:load")
  },
  scraper: {},
  downloader: {}
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
