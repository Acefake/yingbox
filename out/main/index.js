"use strict";
const utils = require("@electron-toolkit/utils");
const electron = require("electron");
const fsSync = require("fs");
const fs = require("fs/promises");
const http = require("http");
const https = require("https");
const path = require("path");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const fsSync__namespace = /* @__PURE__ */ _interopNamespaceDefault(fsSync);
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
const http__namespace = /* @__PURE__ */ _interopNamespaceDefault(http);
const https__namespace = /* @__PURE__ */ _interopNamespaceDefault(https);
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
const icon = path.join(__dirname, "../../resources/icon.png");
function createWindow() {
  const mainWindow = new electron.BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 1200,
    minHeight: 900,
    show: false,
    autoHideMenuBar: true,
    ...process.platform === "linux" ? { icon } : {},
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  });
  electron.ipcMain.handle("app:getVersion", async () => {
    try {
      const packageJsonPath = path__namespace.join(__dirname, "../../package.json");
      const packageJson = JSON.parse(await fs__namespace.readFile(packageJsonPath, "utf-8"));
      return {
        success: true,
        data: {
          name: packageJson.name,
          version: packageJson.version,
          description: packageJson.description,
          author: packageJson.author
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: null
      };
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
electron.app.whenReady().then(() => {
  utils.electronApp.setAppUserModelId("com.electron");
  electron.app.on("browser-window-created", (_, window) => {
    utils.optimizer.watchWindowShortcuts(window);
  });
  electron.ipcMain.on("ping", () => console.log("pong"));
  electron.ipcMain.handle("file:read", async (_, filePath) => {
    try {
      const data = await fs__namespace.readFile(filePath, "utf-8");
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("file:write", async (_, filePath, content) => {
    try {
      await fs__namespace.writeFile(filePath, content, "utf-8");
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("file:delete", async (_, filePath) => {
    try {
      await fs__namespace.unlink(filePath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("file:exists", async (_, filePath) => {
    try {
      await fs__namespace.access(filePath);
      return { success: true, exists: true };
    } catch {
      return { success: true, exists: false };
    }
  });
  electron.ipcMain.handle("file:mkdir", async (_, dirPath) => {
    try {
      await fs__namespace.mkdir(dirPath, { recursive: true });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("file:readdir", async (_, dirPath) => {
    try {
      const files = await fs__namespace.readdir(dirPath, { withFileTypes: true });
      const result = files.map((file) => ({
        name: file.name,
        isDirectory: file.isDirectory(),
        isFile: file.isFile()
      }));
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("file:stat", async (_, filePath) => {
    try {
      const stats = await fs__namespace.stat(filePath);
      return {
        success: true,
        data: {
          size: stats.size,
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile(),
          mtime: stats.mtime,
          ctime: stats.ctime
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("file:readImage", async (_, filePath) => {
    try {
      const data = await fs__namespace.readFile(filePath);
      const ext = path__namespace.extname(filePath).toLowerCase();
      let mimeType = "image/png";
      switch (ext) {
        case ".jpg":
        case ".jpeg":
          mimeType = "image/jpeg";
          break;
        case ".png":
          mimeType = "image/png";
          break;
        case ".gif":
          mimeType = "image/gif";
          break;
        case ".webp":
          mimeType = "image/webp";
          break;
        case ".svg":
          mimeType = "image/svg+xml";
          break;
      }
      const base64 = data.toString("base64");
      const dataUrl = `data:${mimeType};base64,${base64}`;
      return {
        success: true,
        data: dataUrl
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  });
  electron.ipcMain.handle("file:copy", async (_, srcPath, destPath) => {
    try {
      await fs__namespace.copyFile(srcPath, destPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("file:move", async (_, srcPath, destPath) => {
    try {
      await fs__namespace.rename(srcPath, destPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("path:join", (_, ...paths) => {
    return path__namespace.join(...paths);
  });
  electron.ipcMain.handle("path:resolve", (_, ...paths) => {
    return path__namespace.resolve(...paths);
  });
  electron.ipcMain.handle("path:dirname", (_, filePath) => {
    return path__namespace.dirname(filePath);
  });
  electron.ipcMain.handle("path:basename", (_, filePath, ext) => {
    return path__namespace.basename(filePath, ext);
  });
  electron.ipcMain.handle("path:extname", (_, filePath) => {
    return path__namespace.extname(filePath);
  });
  electron.ipcMain.handle("dialog:openDirectory", async () => {
    try {
      const result = await electron.dialog.showOpenDialog({
        properties: ["openDirectory"],
        title: "选择目录"
      });
      return {
        success: true,
        canceled: result.canceled,
        filePaths: result.filePaths
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        canceled: true,
        filePaths: []
      };
    }
  });
  electron.ipcMain.handle("dialog:openFile", async (_, options) => {
    try {
      const result = await electron.dialog.showOpenDialog({
        properties: ["openFile"],
        title: "选择文件",
        ...options
      });
      return {
        success: true,
        canceled: result.canceled,
        filePaths: result.filePaths
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        canceled: true,
        filePaths: []
      };
    }
  });
  electron.ipcMain.handle("dialog:saveFile", async (_, options) => {
    try {
      const result = await electron.dialog.showSaveDialog({
        title: "保存文件",
        ...options
      });
      return {
        success: true,
        canceled: result.canceled,
        filePath: result.filePath
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        canceled: true,
        filePath: ""
      };
    }
  });
  electron.ipcMain.handle(
    "http:download",
    async (event, url, filePath) => {
      try {
        const protocol = url.startsWith("https:") ? https__namespace : http__namespace;
        return new Promise((resolve) => {
          const request = protocol.get(url, (response) => {
            if (response.statusCode === 200) {
              const fileStream = fsSync__namespace.createWriteStream(filePath);
              response.pipe(fileStream);
              fileStream.on("finish", () => {
                fileStream.close();
                resolve({ success: true });
              });
              fileStream.on("error", (error) => {
                resolve({ success: false, error: error.message });
              });
            } else {
              resolve({
                success: false,
                error: `HTTP ${response.statusCode}: ${response.statusMessage}`
              });
            }
          });
          request.on("error", (error) => {
            resolve({ success: false, error: error.message });
          });
          request.setTimeout(3e4, () => {
            request.destroy();
            resolve({ success: false, error: "下载超时" });
          });
        });
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  );
  electron.ipcMain.handle(
    "file:readdirRecursive",
    async (event, dirPath) => {
      try {
        const allItems = [];
        async function scanDirectory(currentPath) {
          const items = await fs__namespace.readdir(currentPath, { withFileTypes: true });
          for (const item of items) {
            if (item.name.startsWith(".")) {
              continue;
            }
            const fullPath = path__namespace.join(currentPath, item.name);
            const stats = await fs__namespace.stat(fullPath);
            allItems.push({
              name: item.name,
              path: fullPath,
              size: item.isFile() ? stats.size : 0,
              isDirectory: item.isDirectory(),
              isFile: item.isFile()
            });
            if (item.isDirectory()) {
              await scanDirectory(fullPath);
            }
          }
        }
        await scanDirectory(dirPath);
        return {
          success: true,
          data: allItems
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          data: []
        };
      }
    }
  );
  createWindow();
  electron.app.on("activate", function() {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
