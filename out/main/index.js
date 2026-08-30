"use strict";
const utils = require("@electron-toolkit/utils");
const electron = require("electron");
const child_process = require("child_process");
const fsSync = require("fs");
const fs = require("fs/promises");
const http = require("http");
const https = require("https");
const path = require("path");
const electronUpdater = require("electron-updater");
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
const icon = path.join(__dirname, "../../resources/icon.svg");
electron.Menu.setApplicationMenu(null);
electron.app.commandLine.appendSwitch(
  "enable-features",
  "EnableDrDc,CanvasOopRasterization"
);
electron.protocol.registerSchemesAsPrivileged([
  {
    scheme: "local",
    privileges: { secure: true, standard: true, stream: true, bypassCSP: true }
  }
]);
let mainWindow = null;
const configPath = path.join(electron.app.getPath("userData"), "config.json");
let downloadPath = "";
try {
  if (fsSync__namespace.existsSync(configPath)) {
    const config = JSON.parse(fsSync__namespace.readFileSync(configPath, "utf-8"));
    downloadPath = config.downloadPath || "";
  }
} catch (err) {
  console.error("Failed to load config:", err);
}
function saveConfig() {
  try {
    const config = { downloadPath };
    fsSync__namespace.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error("Failed to save config:", err);
  }
}
electronUpdater.autoUpdater.autoDownload = false;
electronUpdater.autoUpdater.autoInstallOnAppQuit = true;
electronUpdater.autoUpdater.on("checking-for-update", () => {
  mainWindow?.webContents.send("update:status", {
    status: "checking"
  });
});
electronUpdater.autoUpdater.on("update-available", (info) => {
  mainWindow?.webContents.send("update:status", {
    status: "available",
    info
  });
});
electronUpdater.autoUpdater.on("update-not-available", (info) => {
  mainWindow?.webContents.send("update:status", {
    status: "not-available",
    info
  });
});
electronUpdater.autoUpdater.on("download-progress", (progress) => {
  mainWindow?.webContents.send("update:status", {
    status: "downloading",
    progress
  });
});
electronUpdater.autoUpdater.on("update-downloaded", (info) => {
  mainWindow?.webContents.send("update:status", {
    status: "downloaded",
    info
  });
});
electronUpdater.autoUpdater.on("error", (error) => {
  mainWindow?.webContents.send("update:status", {
    status: "error",
    error: error.message
  });
});
function getScreenBasedSize(ratio = 0.85, minW = 1200, minH = 900) {
  const primary = electron.screen.getPrimaryDisplay();
  const { width: sw, height: sh } = primary.workAreaSize;
  const w = Math.max(Math.floor(sw * ratio), minW);
  const h = Math.max(Math.floor(sh * ratio), minH);
  return { width: w, height: h };
}
function createWindow() {
  const { width, height } = getScreenBasedSize(0.85, 1200, 900);
  mainWindow = new electron.BrowserWindow({
    width,
    height,
    minWidth: 1200,
    minHeight: 900,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    ...process.platform === "linux" ? { icon } : {},
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      webSecurity: false
    }
  });
  electron.ipcMain.handle("win:minimize", (event) => {
    electron.BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  electron.ipcMain.handle("win:maximize", (event) => {
    const win = electron.BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  electron.ipcMain.handle("win:close", (event) => {
    electron.BrowserWindow.fromWebContents(event.sender)?.close();
  });
  electron.ipcMain.handle("win:isMaximized", (event) => {
    return electron.BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });
  electron.ipcMain.handle("app:getVersion", async () => {
    try {
      const packageJsonPath = path__namespace.join(__dirname, "../../package.json");
      const packageJson = JSON.parse(
        await fs__namespace.readFile(packageJsonPath, "utf-8")
      );
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
  electron.ipcMain.handle("update:check", async () => {
    if (utils.is.dev) {
      return { success: false, error: "开发环境不检查更新" };
    }
    try {
      const result = await electronUpdater.autoUpdater.checkForUpdates();
      return { success: true, data: result?.updateInfo ?? null };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("update:download", async () => {
    try {
      await electronUpdater.autoUpdater.downloadUpdate();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("update:install", () => {
    electronUpdater.autoUpdater.quitAndInstall(false, true);
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
    if (!utils.is.dev) {
      electronUpdater.autoUpdater.checkForUpdates().catch((error) => {
        console.warn("[Updater] check failed:", error);
      });
    }
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
  utils.electronApp.setAppUserModelId("com.yingbox.app");
  electron.session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    headers["Content-Security-Policy"] = [
      "default-src * 'unsafe-inline' 'unsafe-eval' blob: data:; media-src * blob: data:; img-src * blob: data:; connect-src *"
    ];
    callback({ responseHeaders: headers });
  });
  electron.protocol.handle("local", async (request) => {
    const url = new URL(request.url);
    const host = url.host;
    const pathname = decodeURIComponent(url.pathname);
    const filePath = host ? `${host.toUpperCase()}:${pathname}` : pathname.replace(/^\//, "");
    const ext = path__namespace.extname(filePath).toLowerCase();
    const mimeMap = {
      ".mp4": "video/mp4",
      ".webm": "video/webm",
      ".mkv": "video/x-matroska",
      ".avi": "video/x-msvideo",
      ".mov": "video/quicktime",
      ".m4v": "video/mp4",
      ".wmv": "video/x-ms-wmv",
      ".flv": "video/x-flv",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif"
    };
    const mime = mimeMap[ext] || "application/octet-stream";
    try {
      await fs__namespace.access(filePath);
    } catch {
      return new Response(null, { status: 404 });
    }
    const isMedia = [".mp4", ".webm", ".mkv", ".avi", ".mov", ".m4v", ".wmv", ".flv"].includes(ext);
    if (isMedia) {
      const stream = fsSync__namespace.createReadStream(filePath);
      return new Response(stream, {
        headers: {
          "Content-Type": mime,
          "Cache-Control": "public, max-age=86400"
        }
      });
    } else {
      try {
        const buffer = await fs__namespace.readFile(filePath);
        return new Response(buffer, {
          headers: {
            "Content-Type": mime,
            "Cache-Control": "public, max-age=86400"
          }
        });
      } catch {
        return new Response(null, { status: 500 });
      }
    }
  });
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
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    try {
      if (srcPath === destPath) return { success: true };
      try {
        await fs__namespace.access(destPath);
        return { success: false, error: `目标已存在: ${destPath}`, code: "EEXIST" };
      } catch {
      }
      let lastError = null;
      for (let i = 0; i < 5; i++) {
        try {
          await fs__namespace.rename(srcPath, destPath);
          return { success: true };
        } catch (error) {
          const err = error;
          lastError = err;
          if (err.code === "EXDEV") {
            await fs__namespace.cp(srcPath, destPath, { recursive: true });
            await fs__namespace.rm(srcPath, { recursive: true, force: true });
            return { success: true };
          }
          if (!["EPERM", "EBUSY", "ENOTEMPTY"].includes(err.code || "")) break;
          await sleep(300 * (i + 1));
        }
      }
      return {
        success: false,
        error: lastError?.message || "move failed",
        code: lastError?.code
      };
    } catch (error) {
      const err = error;
      return { success: false, error: err.message, code: err.code };
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
  electron.ipcMain.handle("dialog:selectDirectory", async () => {
    try {
      const result = await electron.dialog.showOpenDialog({
        properties: ["openDirectory"],
        title: "选择下载目录"
      });
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0];
    } catch (error) {
      console.error("Failed to select directory:", error);
      return null;
    }
  });
  electron.ipcMain.handle("config:setDownloadPath", async (_, path2) => {
    downloadPath = path2;
    saveConfig();
    console.log("Download path set to:", path2);
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
    "http:fetch",
    async (_event, url, options = {}) => {
      try {
        const protocol2 = url.startsWith("https:") ? https__namespace : http__namespace;
        const timeout = options.timeoutMs ?? 3e4;
        return new Promise((resolve) => {
          const urlObj = new URL(url);
          const reqOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method: options.method ?? "GET",
            headers: options.headers ?? {}
          };
          const req = protocol2.request(reqOptions, (res) => {
            let data = "";
            res.setEncoding("utf-8");
            res.on("data", (chunk) => {
              data += chunk;
            });
            res.on("end", () => {
              try {
                const json = JSON.parse(data);
                resolve({ success: true, status: res.statusCode, data: json });
              } catch {
                resolve({
                  success: true,
                  status: res.statusCode,
                  data,
                  raw: true
                });
              }
            });
          });
          req.setTimeout(timeout, () => {
            req.destroy();
            resolve({ success: false, error: "请求超时" });
          });
          req.on("error", (err) => {
            resolve({ success: false, error: err.message });
          });
          if (options.body) req.write(options.body);
          req.end();
        });
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  );
  electron.ipcMain.handle(
    "http:fetchImage",
    async (_event, url, referer) => {
      try {
        const protocol2 = url.startsWith("https:") ? https__namespace : http__namespace;
        return new Promise((resolve) => {
          const urlObj = new URL(url);
          const reqOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (url.startsWith("https:") ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: "GET",
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              Referer: referer || `${urlObj.protocol}//${urlObj.hostname}/`,
              Accept: "image/webp,image/apng,image/*,*/*;q=0.8"
            }
          };
          const req = protocol2.request(reqOptions, (res) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => {
              if (res.statusCode && res.statusCode >= 400) {
                resolve({ success: false, error: `HTTP ${res.statusCode}` });
                return;
              }
              const buffer = Buffer.concat(chunks);
              const contentType = res.headers["content-type"] || "image/jpeg";
              const base64 = buffer.toString("base64");
              resolve({
                success: true,
                data: `data:${contentType};base64,${base64}`
              });
            });
          });
          req.setTimeout(15e3, () => {
            req.destroy();
            resolve({ success: false, error: "超时" });
          });
          req.on(
            "error",
            (err) => resolve({ success: false, error: err.message })
          );
          req.end();
        });
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  );
  electron.ipcMain.handle(
    "http:download",
    async (_event, url, filePath) => {
      try {
        const protocol2 = url.startsWith("https:") ? https__namespace : http__namespace;
        return new Promise((resolve) => {
          const request = protocol2.get(url, (response) => {
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
    async (_event, dirPath) => {
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
  const isDev = utils.is.dev;
  console.log("[Go] isDev:", isDev, "resourcesPath:", process.resourcesPath);
  if (isDev) {
    console.log("[Go] Development mode: backend should be started by pnpm dev:backend");
  } else {
    const goExe = path.join(
      process.resourcesPath,
      "backend",
      process.platform === "win32" ? "main.exe" : "main"
    );
    const goCwd = path.join(process.resourcesPath, "backend");
    let goProc = null;
    console.log("[Go] Looking for backend at:", goExe);
    if (fsSync__namespace.existsSync(goExe)) {
      console.log("[Go] Starting backend from:", goExe);
      const env = { ...process.env };
      if (downloadPath) {
        env.MISSAV_VIDEO_PATH = downloadPath;
        console.log("[Go] Using custom download path:", downloadPath);
      }
      try {
        goProc = child_process.spawn(goExe, [], { cwd: goCwd, env, shell: true });
        goProc.stdout?.on(
          "data",
          (d) => console.log("[Go stdout]", d.toString().trim())
        );
        goProc.stderr?.on(
          "data",
          (d) => console.error("[Go stderr]", d.toString().trim())
        );
        goProc.on("exit", (code, signal) => {
          console.log("[Go] exited with code", code, "signal:", signal);
        });
        goProc.on("error", (err) => {
          console.error("[Go] spawn error:", err.message);
        });
        console.log("[Go] Backend process started with PID:", goProc.pid);
      } catch (err) {
        console.error("[Go] Failed to start backend:", err);
      }
    } else {
      console.error("[Go] backend exe not found:", goExe);
      try {
        const resourcesDir = path.join(process.resourcesPath, "backend");
        if (fsSync__namespace.existsSync(resourcesDir)) {
          const files = fsSync__namespace.readdirSync(resourcesDir);
          console.log("[Go] Resources/backend contents:", files);
        } else {
          console.error("[Go] Resources/backend directory does not exist");
        }
      } catch (e) {
        console.error("[Go] Error listing resources:", e);
      }
    }
    electron.app.on("will-quit", () => {
      if (goProc) {
        console.log("[Go] Killing backend process...");
        goProc.kill();
      }
    });
  }
  electron.ipcMain.handle("shell:openPath", async (_, filePath) => {
    const error = await electron.shell.openPath(filePath);
    return { success: !error, error: error || void 0 };
  });
  electron.ipcMain.handle("player:open", async (_, filePath, customTitle) => {
    const isOnlineUrl = filePath.startsWith("http://") || filePath.startsWith("https://");
    const videoUrl = isOnlineUrl ? filePath : "file:///" + filePath.replace(/\\/g, "/");
    const title = customTitle || (isOnlineUrl ? "在线播放" : path__namespace.basename(filePath));
    const playerHtml = path.join(__dirname, "../../resources/player.html");
    const playerPreload = path.join(__dirname, "../../resources/player-preload.js");
    const { width: pw, height: ph } = getScreenBasedSize(0.8, 900, 560);
    const win = new electron.BrowserWindow({
      width: pw,
      height: ph,
      minWidth: 640,
      minHeight: 400,
      backgroundColor: "#000000",
      title,
      frame: false,
      autoHideMenuBar: true,
      webPreferences: {
        webSecurity: false,
        nodeIntegration: false,
        contextIsolation: true,
        preload: playerPreload
      }
    });
    const onMin = (_e) => {
      if (_e.sender === win.webContents) win.minimize();
    };
    const onClose = (_e) => {
      if (_e.sender === win.webContents) win.close();
    };
    electron.ipcMain.on("player-win:minimize", onMin);
    electron.ipcMain.on("player-win:close", onClose);
    win.on("closed", () => {
      electron.ipcMain.off("player-win:minimize", onMin);
      electron.ipcMain.off("player-win:close", onClose);
    });
    const query = "?src=" + encodeURIComponent(videoUrl) + "&title=" + encodeURIComponent(title);
    win.loadFile(playerHtml, { search: query });
    return { success: true };
  });
  createWindow();
  const registerDevToolsShortcut = () => {
    electron.globalShortcut.register("F12", () => {
      if (mainWindow) {
        mainWindow.webContents.toggleDevTools();
      }
    });
    const accelerator = process.platform === "darwin" ? "Command+Option+I" : "Control+Shift+I";
    electron.globalShortcut.register(accelerator, () => {
      if (mainWindow) {
        mainWindow.webContents.toggleDevTools();
      }
    });
  };
  registerDevToolsShortcut();
  electron.app.on("activate", function() {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  electron.globalShortcut.unregisterAll();
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
