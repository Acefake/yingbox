"use strict";
const utils = require("@electron-toolkit/utils");
const electron = require("electron");
const child_process = require("child_process");
const fsSync = require("fs");
const fs$1 = require("fs/promises");
const path = require("path");
const electronUpdater = require("electron-updater");
const fs = require("node:fs/promises");
const path$1 = require("node:path");
const node_crypto = require("node:crypto");
const node_stream = require("node:stream");
const node_fs = require("node:fs");
const promises = require("node:stream/promises");
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
const fs__namespace$1 = /* @__PURE__ */ _interopNamespaceDefault(fs$1);
const path__namespace$1 = /* @__PURE__ */ _interopNamespaceDefault(path);
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path$1);
const icon = path.join(__dirname, "../../resources/icon.svg");
const locks = /* @__PURE__ */ new Map();
const keyFor = (value) => {
  const resolved = path__namespace.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};
async function withPathLocks(paths, action) {
  const keys = [...new Set(paths.map(keyFor))].sort();
  const previous = keys.map((key) => locks.get(key) ?? Promise.resolve());
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  for (const key of keys) locks.set(key, current);
  await Promise.all(previous);
  try {
    return await action();
  } finally {
    release();
    for (const key of keys) if (locks.get(key) === current) locks.delete(key);
  }
}
async function exists(filePath) {
  try {
    await fs__namespace.lstat(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function replaceFile(source, destination) {
  const backup = `${destination}.${node_crypto.randomUUID()}.backup`;
  const hadDestination = await exists(destination);
  if (hadDestination && !(await fs__namespace.lstat(destination)).isFile()) {
    throw new Error("目标不是普通文件");
  }
  let backedUp = false;
  try {
    if (hadDestination) {
      await fs__namespace.rename(destination, backup);
      backedUp = true;
    }
    await fs__namespace.rename(source, destination);
  } catch (error) {
    if (backedUp) {
      try {
        await fs__namespace.rename(backup, destination);
      } catch {
        throw new Error(`替换失败，原文件保留在 ${backup}: ${error.message}`);
      }
    }
    throw error;
  }
  if (backedUp) await fs__namespace.unlink(backup).catch((error) => console.warn(`旧文件备份保留在 ${backup}`, error));
}
async function movePath(source, destination, replace = false) {
  const src = path__namespace.resolve(source);
  const dest = path__namespace.resolve(destination);
  if (keyFor(src) === keyFor(dest)) {
    await fs__namespace.access(src);
    return;
  }
  await withPathLocks([src, dest], async () => {
    const sourceStats = await fs__namespace.lstat(src);
    const relative = path__namespace.relative(src, dest);
    if (sourceStats.isDirectory() && relative && !relative.startsWith(`..${path__namespace.sep}`) && relative !== ".." && !path__namespace.isAbsolute(relative)) {
      throw new Error("不能将目录移动到自身的子目录");
    }
    const targetExists = await exists(dest);
    if (targetExists && !replace) throw new Error(`目标已存在: ${dest}`);
    if (targetExists && (!sourceStats.isFile() || !(await fs__namespace.lstat(dest)).isFile())) {
      throw new Error("仅支持替换普通文件");
    }
    const backup = `${dest}.${node_crypto.randomUUID()}.backup`;
    let backedUp = false;
    let committed = false;
    try {
      if (targetExists) {
        await fs__namespace.rename(dest, backup);
        backedUp = true;
      }
      try {
        await fs__namespace.rename(src, dest);
        committed = true;
      } catch (error) {
        if (error.code !== "EXDEV") throw error;
        const staging = `${dest}.${node_crypto.randomUUID()}.partial`;
        try {
          await fs__namespace.cp(src, staging, { recursive: true, force: false, errorOnExist: true });
          await fs__namespace.rename(staging, dest);
          committed = true;
          await fs__namespace.rm(src, { recursive: sourceStats.isDirectory() });
        } finally {
          await fs__namespace.rm(staging, { recursive: true, force: true }).catch(() => {
          });
        }
      }
    } catch (error) {
      if (backedUp && !committed) {
        try {
          await fs__namespace.rename(backup, dest);
        } catch {
          throw new Error(`移动失败，原文件保留在 ${backup}: ${error.message}`);
        }
      }
      throw error;
    }
    if (backedUp) {
      await fs__namespace.unlink(backup).catch((error) => console.warn(`旧文件备份保留在 ${backup}`, error));
    }
  });
}
async function atomicWrite(filePath, content) {
  await withPathLocks([filePath], async () => {
    const temporary = `${filePath}.${node_crypto.randomUUID()}.partial`;
    try {
      await fs__namespace.writeFile(temporary, content, { flag: "wx" });
      await replaceFile(temporary, filePath);
    } finally {
      await fs__namespace.unlink(temporary).catch(() => {
      });
    }
  });
}
const mimeTypes = {
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
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || !match[1] && !match[2] || size === 0) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < size ? { start, end } : null;
}
async function serveLocalMedia(request) {
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405 });
  let filePath;
  try {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname);
    if (url.host && !/^[a-z]$/i.test(url.host)) return new Response(null, { status: 400 });
    filePath = url.host ? `${url.host.toUpperCase()}:${pathname}` : pathname.replace(/^\/(?=\/)/, "");
  } catch {
    return new Response(null, { status: 400 });
  }
  try {
    const handle = await fs.open(filePath, "r");
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) {
        await handle.close();
        return new Response(null, { status: 404 });
      }
      const headers = new Headers({
        "Content-Type": mimeTypes[path$1.extname(filePath).toLowerCase()] || "application/octet-stream",
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
        "Last-Modified": stats.mtime.toUTCString()
      });
      const requested = request.headers.get("Range");
      const range = requested ? parseRange(requested, stats.size) : null;
      if (requested && !range) {
        await handle.close();
        headers.set("Content-Range", `bytes */${stats.size}`);
        return new Response(null, { status: 416, headers });
      }
      headers.set("Content-Length", String(range ? range.end - range.start + 1 : stats.size));
      if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${stats.size}`);
      if (request.method === "HEAD" || stats.size === 0) {
        await handle.close();
        return new Response(null, { status: range ? 206 : 200, headers });
      }
      const stream = handle.createReadStream(range ?? {});
      const abort = () => stream.destroy();
      request.signal.addEventListener("abort", abort, { once: true });
      stream.once("close", () => request.signal.removeEventListener("abort", abort));
      if (request.signal.aborted) abort();
      return new Response(node_stream.Readable.toWeb(stream), {
        status: range ? 206 : 200,
        headers
      });
    } catch (error) {
      await handle.close().catch(() => {
      });
      throw error;
    }
  } catch (error) {
    const code = error.code;
    return new Response(null, { status: code === "ENOENT" ? 404 : code === "EACCES" ? 403 : 500 });
  }
}
let playerWindow = null;
let pendingPayload = null;
function normalizePayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const filePath = typeof payload.filePath === "string" ? payload.filePath.trim() : "";
  const url = typeof payload.url === "string" ? payload.url.trim() : "";
  const title = typeof payload.title === "string" ? payload.title : void 0;
  const poster = typeof payload.poster === "string" ? payload.poster.trim() : "";
  const startAt = typeof payload.startAt === "number" && Number.isFinite(payload.startAt) ? Math.max(0, payload.startAt) : void 0;
  if (!filePath && !url) return null;
  return {
    ...filePath ? { filePath } : {},
    ...url ? { url } : {},
    ...title ? { title } : {},
    ...poster ? { poster } : {},
    ...typeof startAt === "number" ? { startAt } : {}
  };
}
function buildPlayerHash(payload) {
  const q = new URLSearchParams();
  if (payload.url) q.set("url", payload.url);
  if (payload.filePath) q.set("filePath", payload.filePath);
  if (payload.title) q.set("title", payload.title);
  if (typeof payload.startAt === "number" && payload.startAt > 0) {
    q.set("startAt", String(Math.floor(payload.startAt)));
  }
  const qs = q.toString();
  return qs ? `player-popout?${qs}` : "player-popout";
}
function windowTitle(payload) {
  const t = typeof payload.title === "string" ? payload.title.trim() : "";
  return t ? `影盒 - ${t}` : "影盒 - 正在播放";
}
function applyWindowTitle(payload) {
  if (!playerWindow || playerWindow.isDestroyed()) return;
  try {
    playerWindow.setTitle(windowTitle(payload));
  } catch {
  }
}
function sendLoad(payload) {
  if (!playerWindow || playerWindow.isDestroyed()) return;
  applyWindowTitle(payload);
  playerWindow.webContents.send("player:load", payload);
}
function openPlayerWindow(payload, _mainWindow) {
  pendingPayload = payload;
  const hash = buildPlayerHash(payload);
  if (playerWindow && !playerWindow.isDestroyed()) {
    if (playerWindow.isMinimized()) playerWindow.restore();
    playerWindow.focus();
    sendLoad(payload);
    try {
      const current = playerWindow.webContents.getURL();
      if (current.includes("#")) {
        const base = current.split("#")[0];
        playerWindow.loadURL(`${base}#/${hash}`);
      }
    } catch {
    }
    return;
  }
  playerWindow = new electron.BrowserWindow({
    width: 960,
    height: 600,
    minWidth: 640,
    minHeight: 360,
    show: false,
    frame: true,
    title: windowTitle(payload),
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      webSecurity: false
    }
  });
  playerWindow.on("closed", () => {
    playerWindow = null;
    pendingPayload = null;
  });
  const deliverPending = () => {
    if (pendingPayload) sendLoad(pendingPayload);
  };
  playerWindow.once("ready-to-show", () => {
    playerWindow?.show();
    deliverPending();
  });
  playerWindow.webContents.on("did-finish-load", () => {
    deliverPending();
  });
  if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    playerWindow.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/#/${hash}`);
  } else {
    playerWindow.loadFile(path.join(__dirname, "../renderer/index.html"), {
      hash
    });
  }
}
function closePlayerWindow() {
  if (playerWindow && !playerWindow.isDestroyed()) {
    playerWindow.close();
  }
  playerWindow = null;
  pendingPayload = null;
}
function registerPlayerWindowIpc(getMainWindow) {
  electron.ipcMain.handle("player:open", (_event, payload) => {
    const normalized = normalizePayload(payload);
    if (!normalized) {
      return { success: false, error: "filePath or url required" };
    }
    try {
      openPlayerWindow(normalized, getMainWindow());
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  electron.ipcMain.handle("player:close", () => {
    closePlayerWindow();
    return { success: true };
  });
  electron.ipcMain.handle("player:getPending", () => pendingPayload);
}
const videoExtensions = /* @__PURE__ */ new Set([
  ".mp4",
  ".avi",
  ".mkv",
  ".mov",
  ".wmv",
  ".flv",
  ".webm",
  ".m4v",
  ".ts",
  ".rmvb"
]);
const ignored = /* @__PURE__ */ new Set([".actors", "@eadir", "$recycle.bin", "system volume information"]);
const normPath = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "");
const pathKey = (p) => process.platform === "win32" ? normPath(p).toLowerCase() : normPath(p);
async function scanMediaDirectory(root, previousIndex) {
  const data = [];
  const warnings = [];
  let reused = 0;
  const rootResolved = path$1.resolve(root);
  const prevByPath = /* @__PURE__ */ new Map();
  if (previousIndex?.length) {
    for (const entry of previousIndex) {
      prevByPath.set(pathKey(entry.path), entry);
    }
  }
  const collectCachedDescendants = (dirNorm) => {
    const prefix = pathKey(dirNorm) + "/";
    const out = [];
    for (const [p, entry] of prevByPath) {
      if (!p.startsWith(prefix)) continue;
      out.push({
        name: entry.name || path$1.basename(entry.path),
        path: entry.path,
        size: entry.size,
        mtime: entry.mtime,
        isDirectory: Boolean(entry.isDirectory),
        isFile: entry.isFile !== void 0 ? Boolean(entry.isFile) : !entry.isDirectory
      });
    }
    return out;
  };
  const directories = [rootResolved];
  while (directories.length) {
    const batch = directories.splice(0, 4);
    await Promise.all(
      batch.map(async (directory) => {
        const dirNorm = pathKey(directory);
        try {
          if (directory !== rootResolved && prevByPath.size > 0) {
            try {
              const dirStats = await fs.stat(directory);
              const prev = prevByPath.get(dirNorm);
              if (prev && prev.isDirectory && prev.mtime === dirStats.mtimeMs) {
                const cached = collectCachedDescendants(dirNorm);
                data.push(...cached);
                reused += cached.length;
                return;
              }
            } catch {
            }
          }
          const entries = await fs.readdir(directory, { withFileTypes: true });
          for (const entry of entries) {
            const name = entry.name.toLowerCase();
            if (name.startsWith(".") || name.startsWith("__") || ignored.has(name) || entry.isSymbolicLink()) {
              continue;
            }
            const filePath = path$1.join(directory, entry.name);
            const isVideo = videoExtensions.has(path$1.extname(name));
            const isSidecar = name.endsWith(".nfo") || /\.(jpe?g|png|webp)$/i.test(name);
            if (!entry.isDirectory() && (!entry.isFile() || !isVideo && !isSidecar)) {
              continue;
            }
            try {
              const stats = await fs.stat(filePath);
              data.push({
                name: entry.name,
                path: filePath,
                size: stats.isFile() ? stats.size : 0,
                mtime: stats.mtimeMs,
                isDirectory: stats.isDirectory(),
                isFile: stats.isFile()
              });
              if (entry.isDirectory()) directories.push(filePath);
            } catch (error) {
              warnings.push(`${filePath}: ${error.message}`);
            }
          }
        } catch (error) {
          if (directory === rootResolved) throw error;
          warnings.push(`${directory}: ${error.message}`);
          if (prevByPath.size > 0) {
            const cached = collectCachedDescendants(dirNorm);
            if (cached.length) {
              data.push(...cached);
              reused += cached.length;
            }
          }
        }
      })
    );
  }
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
  for (const item of data) {
    const key = pathKey(item.path);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return {
    data: deduped.sort((a, b) => a.path.localeCompare(b.path)),
    warnings,
    reused
  };
}
async function fetchHttp(url, options = {}, timeoutMs = 3e4) {
  if (!/^https?:\/\//i.test(url)) throw new Error("仅支持 HTTP/HTTPS 地址");
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response;
}
async function readLimited(response, maxBytes = 16 * 1024 * 1024) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (; ; ) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("响应内容超过大小限制");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => {
    });
    reader.releaseLock();
  }
}
async function downloadFile(url, filePath) {
  await withPathLocks([filePath], async () => {
    const temporary = `${filePath}.${node_crypto.randomUUID()}.partial`;
    try {
      const response = await fetchHttp(url, {}, 6e4);
      if (!response.body) throw new Error("下载响应为空");
      await promises.pipeline(
        node_stream.Readable.fromWeb(response.body),
        node_fs.createWriteStream(temporary, { flags: "wx" })
      );
      await replaceFile(temporary, filePath);
    } finally {
      await fs.unlink(temporary).catch(() => {
      });
    }
  });
}
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
async function saveConfig() {
  await atomicWrite(configPath, JSON.stringify({ downloadPath }, null, 2));
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
  const w = Math.min(sw, Math.max(Math.floor(sw * ratio), minW));
  const h = Math.min(sh, Math.max(Math.floor(sh * ratio), minH));
  return { width: w, height: h };
}
function registerWindowHandlers() {
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
  electron.ipcMain.handle("app:getUserDataPath", () => electron.app.getPath("userData"));
  electron.ipcMain.handle("app:getVersion", async () => {
    try {
      const packageJsonPath = path__namespace$1.join(__dirname, "../../package.json");
      const packageJson = JSON.parse(
        await fs__namespace$1.readFile(packageJsonPath, "utf-8")
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
}
function createWindow() {
  const { width, height } = getScreenBasedSize(0.85, 1200, 900);
  mainWindow = new electron.BrowserWindow({
    width,
    height,
    minWidth: Math.min(1200, width),
    minHeight: Math.min(900, height),
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
  mainWindow.on("closed", () => {
    mainWindow = null;
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
  electron.protocol.handle("local", serveLocalMedia);
  electron.app.on("browser-window-created", (_, window) => {
    utils.optimizer.watchWindowShortcuts(window);
  });
  electron.ipcMain.on("ping", () => console.log("pong"));
  electron.ipcMain.handle("file:read", async (_, filePath) => {
    try {
      const data = await fs__namespace$1.readFile(filePath, "utf-8");
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("file:write", async (_, filePath, content) => {
    try {
      await atomicWrite(filePath, content);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("file:delete", async (_, filePath) => {
    try {
      await fs__namespace$1.unlink(filePath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("file:exists", async (_, filePath) => {
    try {
      await fs__namespace$1.access(filePath);
      return { success: true, exists: true };
    } catch {
      return { success: true, exists: false };
    }
  });
  electron.ipcMain.handle("file:mkdir", async (_, dirPath) => {
    try {
      await fs__namespace$1.mkdir(dirPath, { recursive: true });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("file:readdir", async (_, dirPath) => {
    try {
      const files = await fs__namespace$1.readdir(dirPath, { withFileTypes: true });
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
  electron.ipcMain.handle(
    "file:scanMediaDirectory",
    async (_, dirPath, previousIndex) => {
      try {
        return { success: true, ...await scanMediaDirectory(dirPath, previousIndex) };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  );
  electron.ipcMain.handle("file:stat", async (_, filePath) => {
    try {
      const stats = await fs__namespace$1.stat(filePath);
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
      const data = await fs__namespace$1.readFile(filePath);
      const ext = path__namespace$1.extname(filePath).toLowerCase();
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
      await fs__namespace$1.copyFile(srcPath, destPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("file:move", async (_, srcPath, destPath, options) => {
    try {
      await movePath(srcPath, destPath, options?.replace === true);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("path:join", (_, ...paths) => {
    return path__namespace$1.join(...paths);
  });
  electron.ipcMain.handle("path:resolve", (_, ...paths) => {
    return path__namespace$1.resolve(...paths);
  });
  electron.ipcMain.handle("path:dirname", (_, filePath) => {
    return path__namespace$1.dirname(filePath);
  });
  electron.ipcMain.handle("path:basename", (_, filePath, ext) => {
    return path__namespace$1.basename(filePath, ext);
  });
  electron.ipcMain.handle("path:extname", (_, filePath) => {
    return path__namespace$1.extname(filePath);
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
    if (typeof path2 !== "string" || !path2.trim()) throw new Error("下载目录不能为空");
    const stats = await fs__namespace$1.stat(path2);
    if (!stats.isDirectory()) throw new Error("下载路径必须是目录");
    const previous = downloadPath;
    downloadPath = path2;
    try {
      await saveConfig();
    } catch (error) {
      downloadPath = previous;
      throw error;
    }
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
  electron.ipcMain.handle("http:fetch", async (_, url, options = {}) => {
    try {
      const response = await fetchHttp(url, {
        method: options.method ?? "GET",
        headers: options.headers,
        body: options.body
      }, options.timeoutMs ?? 3e4);
      const text = (await readLimited(response)).toString("utf-8");
      try {
        return { success: true, status: response.status, data: JSON.parse(text) };
      } catch {
        return { success: true, status: response.status, data: text, raw: true };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("http:fetchImage", async (_, url, referer) => {
    try {
      const response = await fetchHttp(url, { headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: referer || new URL(url).origin + "/",
        Accept: "image/webp,image/apng,image/*,*/*;q=0.8"
      } }, 15e3);
      const contentType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
      if (!contentType.startsWith("image/")) {
        await response.body?.cancel();
        throw new Error("响应不是图片");
      }
      const buffer = await readLimited(response);
      return { success: true, data: `data:${contentType};base64,${buffer.toString("base64")}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle("http:download", async (_, url, filePath) => {
    try {
      await downloadFile(url, filePath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle(
    "file:readdirRecursive",
    async (_event, dirPath) => {
      try {
        const allItems = [];
        async function scanDirectory(currentPath) {
          const items = await fs__namespace$1.readdir(currentPath, { withFileTypes: true });
          for (const item of items) {
            if (item.name.startsWith(".")) {
              continue;
            }
            const fullPath = path__namespace$1.join(currentPath, item.name);
            const stats = await fs__namespace$1.stat(fullPath);
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
      const env = { ...process.env, YINGBOX_CONFIG_PATH: configPath, PROJECT_ROOT: electron.app.getAppPath(), NODE_EXECUTABLE: process.execPath };
      env.ELECTRON_RUN_AS_NODE = "1";
      if (downloadPath) {
        env.MISSAV_VIDEO_PATH = downloadPath;
        console.log("[Go] Using custom download path:", downloadPath);
      }
      try {
        goProc = child_process.spawn(goExe, [], { cwd: goCwd, env, shell: false, windowsHide: true });
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
    let stoppingBackend = false;
    electron.app.on("before-quit", (event) => {
      if (!goProc || stoppingBackend) return;
      event.preventDefault();
      stoppingBackend = true;
      const child = goProc;
      const finish = () => {
        goProc = null;
        electron.app.quit();
      };
      if (process.platform === "win32" && child.pid) {
        const killer = child_process.spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
        killer.once("error", () => {
          child.kill();
          finish();
        });
        killer.once("exit", finish);
      } else {
        child.once("exit", finish);
        child.kill("SIGTERM");
        setTimeout(() => {
          child.kill("SIGKILL");
          finish();
        }, 5e3).unref();
      }
    });
  }
  electron.ipcMain.handle("shell:openPath", async (_, filePath) => {
    const error = await electron.shell.openPath(filePath);
    return { success: !error, error: error || void 0 };
  });
  registerWindowHandlers();
  registerPlayerWindowIpc(() => mainWindow);
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
