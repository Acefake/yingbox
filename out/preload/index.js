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
    saveFile: (options) => electron.ipcRenderer.invoke("dialog:saveFile", options)
  },
  app: {
    // Get app version info from package.json
    getVersion: () => electron.ipcRenderer.invoke("app:getVersion")
  },
  shell: {
    openPath: (filePath) => electron.ipcRenderer.invoke("shell:openPath", filePath)
  },
  player: {
    open: (filePath) => electron.ipcRenderer.invoke("player:open", filePath)
  },
  win: {
    minimize: () => electron.ipcRenderer.invoke("win:minimize"),
    maximize: () => electron.ipcRenderer.invoke("win:maximize"),
    close: () => electron.ipcRenderer.invoke("win:close"),
    isMaximized: () => electron.ipcRenderer.invoke("win:isMaximized")
  },
  detail: {
    open: (itemData) => electron.ipcRenderer.invoke("detail:open", itemData),
    getData: () => electron.ipcRenderer.invoke("detail:getData"),
    onUpdate: (cb) => electron.ipcRenderer.on("detail:update", (_e, data) => cb(data)),
    offUpdate: () => electron.ipcRenderer.removeAllListeners("detail:update")
  },
  scraper: {
    fetchMeta: (avid) => electron.ipcRenderer.invoke("scraper:fetchMeta", avid),
    scrape: (avid) => electron.ipcRenderer.invoke("scraper:scrape", avid)
  },
  downloader: {
    start: (avid) => electron.ipcRenderer.send("downloader:start", avid),
    cancel: (avid) => electron.ipcRenderer.send("downloader:cancel", avid),
    onLog: (cb) => {
      electron.ipcRenderer.on("downloader:log", (_e, data) => cb(data));
    },
    onDone: (cb) => {
      electron.ipcRenderer.on("downloader:done", (_e, data) => cb(data));
    },
    offLog: () => electron.ipcRenderer.removeAllListeners("downloader:log"),
    offDone: () => electron.ipcRenderer.removeAllListeners("downloader:done")
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
