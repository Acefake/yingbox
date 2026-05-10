//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let _electron_toolkit_utils = require("@electron-toolkit/utils");
let electron = require("electron");
let child_process = require("child_process");
let fs = require("fs");
fs = __toESM(fs);
let fs_promises = require("fs/promises");
fs_promises = __toESM(fs_promises);
let http = require("http");
http = __toESM(http);
let https = require("https");
https = __toESM(https);
let path = require("path");
path = __toESM(path);
let electron_updater = require("electron-updater");
//#region resources/icon.svg?asset
var icon_default = (0, path.join)(__dirname, "../../resources/icon.svg");
//#endregion
//#region src/main/index.ts
electron.Menu.setApplicationMenu(null);
electron.app.commandLine.appendSwitch("enable-features", "EnableDrDc,CanvasOopRasterization");
electron.protocol.registerSchemesAsPrivileged([{
	scheme: "local",
	privileges: {
		secure: true,
		standard: true,
		stream: true,
		bypassCSP: true
	}
}]);
var mainWindow = null;
electron_updater.autoUpdater.autoDownload = false;
electron_updater.autoUpdater.autoInstallOnAppQuit = true;
electron_updater.autoUpdater.on("checking-for-update", () => {
	mainWindow?.webContents.send("update:status", { status: "checking" });
});
electron_updater.autoUpdater.on("update-available", (info) => {
	mainWindow?.webContents.send("update:status", {
		status: "available",
		info
	});
});
electron_updater.autoUpdater.on("update-not-available", (info) => {
	mainWindow?.webContents.send("update:status", {
		status: "not-available",
		info
	});
});
electron_updater.autoUpdater.on("download-progress", (progress) => {
	mainWindow?.webContents.send("update:status", {
		status: "downloading",
		progress
	});
});
electron_updater.autoUpdater.on("update-downloaded", (info) => {
	mainWindow?.webContents.send("update:status", {
		status: "downloaded",
		info
	});
});
electron_updater.autoUpdater.on("error", (error) => {
	mainWindow?.webContents.send("update:status", {
		status: "error",
		error: error.message
	});
});
function getScreenBasedSize(ratio = .85, minW = 1200, minH = 900) {
	const { width: sw, height: sh } = electron.screen.getPrimaryDisplay().workAreaSize;
	return {
		width: Math.max(Math.floor(sw * ratio), minW),
		height: Math.max(Math.floor(sh * ratio), minH)
	};
}
function createWindow() {
	const { width, height } = getScreenBasedSize(.85, 1200, 900);
	mainWindow = new electron.BrowserWindow({
		width,
		height,
		minWidth: 1200,
		minHeight: 900,
		show: false,
		frame: false,
		autoHideMenuBar: true,
		...process.platform === "linux" ? { icon: icon_default } : {},
		webPreferences: {
			preload: (0, path.join)(__dirname, "../preload/index.js"),
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
			const packageJsonPath = path.join(__dirname, "../../package.json");
			const packageJson = JSON.parse(await fs_promises.readFile(packageJsonPath, "utf-8"));
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
		if (_electron_toolkit_utils.is.dev) return {
			success: false,
			error: "开发环境不检查更新"
		};
		try {
			return {
				success: true,
				data: (await electron_updater.autoUpdater.checkForUpdates())?.updateInfo ?? null
			};
		} catch (error) {
			return {
				success: false,
				error: error.message
			};
		}
	});
	electron.ipcMain.handle("update:download", async () => {
		try {
			await electron_updater.autoUpdater.downloadUpdate();
			return { success: true };
		} catch (error) {
			return {
				success: false,
				error: error.message
			};
		}
	});
	electron.ipcMain.handle("update:install", () => {
		electron_updater.autoUpdater.quitAndInstall(false, true);
	});
	mainWindow.on("ready-to-show", () => {
		mainWindow.show();
		if (!_electron_toolkit_utils.is.dev) electron_updater.autoUpdater.checkForUpdates().catch((error) => {
			console.warn("[Updater] check failed:", error);
		});
	});
	mainWindow.webContents.setWindowOpenHandler((details) => {
		electron.shell.openExternal(details.url);
		return { action: "deny" };
	});
	if (_electron_toolkit_utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
	else mainWindow.loadFile((0, path.join)(__dirname, "../renderer/index.html"));
}
electron.app.whenReady().then(() => {
	_electron_toolkit_utils.electronApp.setAppUserModelId("com.yingbox.app");
	electron.session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
		const headers = { ...details.responseHeaders };
		headers["Content-Security-Policy"] = ["default-src * 'unsafe-inline' 'unsafe-eval' blob: data:; media-src * blob: data:; img-src * blob: data:; connect-src *"];
		callback({ responseHeaders: headers });
	});
	electron.protocol.handle("local", async (request) => {
		const url = new URL(request.url);
		const host = url.host;
		const pathname = decodeURIComponent(url.pathname);
		const filePath = host ? `${host.toUpperCase()}:${pathname}` : pathname.replace(/^\//, "");
		const mime = {
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
		}[path.extname(filePath).toLowerCase()] || "application/octet-stream";
		try {
			await fs_promises.access(filePath);
		} catch {
			return new Response(null, { status: 404 });
		}
		return new Response(fs.createReadStream(filePath), { headers: {
			"Content-Type": mime,
			"Cache-Control": "public, max-age=86400"
		} });
	});
	electron.app.on("browser-window-created", (_, window) => {
		_electron_toolkit_utils.optimizer.watchWindowShortcuts(window);
	});
	electron.ipcMain.on("ping", () => console.log("pong"));
	electron.ipcMain.handle("file:read", async (_, filePath) => {
		try {
			return {
				success: true,
				data: await fs_promises.readFile(filePath, "utf-8")
			};
		} catch (error) {
			return {
				success: false,
				error: error.message
			};
		}
	});
	electron.ipcMain.handle("file:write", async (_, filePath, content) => {
		try {
			await fs_promises.writeFile(filePath, content, "utf-8");
			return { success: true };
		} catch (error) {
			return {
				success: false,
				error: error.message
			};
		}
	});
	electron.ipcMain.handle("file:delete", async (_, filePath) => {
		try {
			await fs_promises.unlink(filePath);
			return { success: true };
		} catch (error) {
			return {
				success: false,
				error: error.message
			};
		}
	});
	electron.ipcMain.handle("file:exists", async (_, filePath) => {
		try {
			await fs_promises.access(filePath);
			return {
				success: true,
				exists: true
			};
		} catch {
			return {
				success: true,
				exists: false
			};
		}
	});
	electron.ipcMain.handle("file:mkdir", async (_, dirPath) => {
		try {
			await fs_promises.mkdir(dirPath, { recursive: true });
			return { success: true };
		} catch (error) {
			return {
				success: false,
				error: error.message
			};
		}
	});
	electron.ipcMain.handle("file:readdir", async (_, dirPath) => {
		try {
			return {
				success: true,
				data: (await fs_promises.readdir(dirPath, { withFileTypes: true })).map((file) => ({
					name: file.name,
					isDirectory: file.isDirectory(),
					isFile: file.isFile()
				}))
			};
		} catch (error) {
			return {
				success: false,
				error: error.message
			};
		}
	});
	electron.ipcMain.handle("file:stat", async (_, filePath) => {
		try {
			const stats = await fs_promises.stat(filePath);
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
			return {
				success: false,
				error: error.message
			};
		}
	});
	electron.ipcMain.handle("file:readImage", async (_, filePath) => {
		try {
			const data = await fs_promises.readFile(filePath);
			const ext = path.extname(filePath).toLowerCase();
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
			return {
				success: true,
				data: `data:${mimeType};base64,${base64}`
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
			await fs_promises.copyFile(srcPath, destPath);
			return { success: true };
		} catch (error) {
			return {
				success: false,
				error: error.message
			};
		}
	});
	electron.ipcMain.handle("file:move", async (_, srcPath, destPath) => {
		try {
			await fs_promises.rename(srcPath, destPath);
			return { success: true };
		} catch (error) {
			return {
				success: false,
				error: error.message
			};
		}
	});
	electron.ipcMain.handle("path:join", (_, ...paths) => {
		return path.join(...paths);
	});
	electron.ipcMain.handle("path:resolve", (_, ...paths) => {
		return path.resolve(...paths);
	});
	electron.ipcMain.handle("path:dirname", (_, filePath) => {
		return path.dirname(filePath);
	});
	electron.ipcMain.handle("path:basename", (_, filePath, ext) => {
		return path.basename(filePath, ext);
	});
	electron.ipcMain.handle("path:extname", (_, filePath) => {
		return path.extname(filePath);
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
	electron.ipcMain.handle("http:fetch", async (_event, url, options = {}) => {
		try {
			const protocol = url.startsWith("https:") ? https : http;
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
				const req = protocol.request(reqOptions, (res) => {
					let data = "";
					res.setEncoding("utf-8");
					res.on("data", (chunk) => {
						data += chunk;
					});
					res.on("end", () => {
						try {
							const json = JSON.parse(data);
							resolve({
								success: true,
								status: res.statusCode,
								data: json
							});
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
					resolve({
						success: false,
						error: "请求超时"
					});
				});
				req.on("error", (err) => {
					resolve({
						success: false,
						error: err.message
					});
				});
				if (options.body) req.write(options.body);
				req.end();
			});
		} catch (error) {
			return {
				success: false,
				error: error.message
			};
		}
	});
	electron.ipcMain.handle("http:fetchImage", async (_event, url, referer) => {
		try {
			const protocol = url.startsWith("https:") ? https : http;
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
				const req = protocol.request(reqOptions, (res) => {
					const chunks = [];
					res.on("data", (chunk) => chunks.push(chunk));
					res.on("end", () => {
						if (res.statusCode && res.statusCode >= 400) {
							resolve({
								success: false,
								error: `HTTP ${res.statusCode}`
							});
							return;
						}
						const buffer = Buffer.concat(chunks);
						resolve({
							success: true,
							data: `data:${res.headers["content-type"] || "image/jpeg"};base64,${buffer.toString("base64")}`
						});
					});
				});
				req.setTimeout(15e3, () => {
					req.destroy();
					resolve({
						success: false,
						error: "超时"
					});
				});
				req.on("error", (err) => resolve({
					success: false,
					error: err.message
				}));
				req.end();
			});
		} catch (error) {
			return {
				success: false,
				error: error.message
			};
		}
	});
	electron.ipcMain.handle("http:download", async (_event, url, filePath) => {
		try {
			const protocol = url.startsWith("https:") ? https : http;
			return new Promise((resolve) => {
				const request = protocol.get(url, (response) => {
					if (response.statusCode === 200) {
						const fileStream = fs.createWriteStream(filePath);
						response.pipe(fileStream);
						fileStream.on("finish", () => {
							fileStream.close();
							resolve({ success: true });
						});
						fileStream.on("error", (error) => {
							resolve({
								success: false,
								error: error.message
							});
						});
					} else resolve({
						success: false,
						error: `HTTP ${response.statusCode}: ${response.statusMessage}`
					});
				});
				request.on("error", (error) => {
					resolve({
						success: false,
						error: error.message
					});
				});
				request.setTimeout(3e4, () => {
					request.destroy();
					resolve({
						success: false,
						error: "下载超时"
					});
				});
			});
		} catch (error) {
			return {
				success: false,
				error: error.message
			};
		}
	});
	electron.ipcMain.handle("file:readdirRecursive", async (_event, dirPath) => {
		try {
			const allItems = [];
			async function scanDirectory(currentPath) {
				const items = await fs_promises.readdir(currentPath, { withFileTypes: true });
				for (const item of items) {
					if (item.name.startsWith(".")) continue;
					const fullPath = path.join(currentPath, item.name);
					const stats = await fs_promises.stat(fullPath);
					allItems.push({
						name: item.name,
						path: fullPath,
						size: item.isFile() ? stats.size : 0,
						isDirectory: item.isDirectory(),
						isFile: item.isFile()
					});
					if (item.isDirectory()) await scanDirectory(fullPath);
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
	});
	if (_electron_toolkit_utils.is.dev) {
		console.log("[Go] Development mode: backend should be started by pnpm dev:backend");
		console.log("[Go] Skipping backend spawn in development");
	} else {
		const goExe = (0, path.join)(process.resourcesPath, "backend", process.platform === "win32" ? "main.exe" : "main");
		const goCwd = (0, path.join)(process.resourcesPath, "backend");
		let goProc = null;
		if (fs.existsSync(goExe)) {
			goProc = (0, child_process.spawn)(goExe, [], { cwd: goCwd });
			goProc.stdout?.on("data", (d) => console.log("[Go]", d.toString().trim()));
			goProc.stderr?.on("data", (d) => console.error("[Go]", d.toString().trim()));
			goProc.on("exit", (code) => console.log("[Go] exited with code", code));
		} else console.warn("[Go] backend exe not found:", goExe);
		electron.app.on("will-quit", () => {
			goProc?.kill();
		});
	}
	electron.ipcMain.handle("shell:openPath", async (_, filePath) => {
		const error = await electron.shell.openPath(filePath);
		return {
			success: !error,
			error: error || void 0
		};
	});
	let pendingDetailData = null;
	let detailWin = null;
	electron.ipcMain.handle("detail:open", async (_, itemData) => {
		pendingDetailData = itemData;
		if (detailWin && !detailWin.isDestroyed()) {
			detailWin.webContents.send("detail:update", itemData);
			if (detailWin.isMinimized()) detailWin.restore();
			detailWin.focus();
			return { success: true };
		}
		const { width: dw, height: dh } = getScreenBasedSize(.75, 900, 680);
		detailWin = new electron.BrowserWindow({
			width: dw,
			height: dh,
			minWidth: 800,
			minHeight: 600,
			frame: false,
			autoHideMenuBar: true,
			webPreferences: {
				preload: (0, path.join)(__dirname, "../preload/index.js"),
				sandbox: false,
				webSecurity: false
			}
		});
		detailWin.on("closed", () => {
			detailWin = null;
			pendingDetailData = null;
		});
		if (_electron_toolkit_utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
			detailWin.loadURL(process.env["ELECTRON_RENDERER_URL"] + "#/online-detail");
			detailWin.webContents.openDevTools();
		} else detailWin.loadFile((0, path.join)(__dirname, "../renderer/index.html"), { hash: "/online-detail" });
		return { success: true };
	});
	electron.ipcMain.handle("detail:getData", () => pendingDetailData);
	electron.ipcMain.handle("player:open", async (_, filePath, customTitle) => {
		const isOnlineUrl = filePath.startsWith("http://") || filePath.startsWith("https://");
		const videoUrl = isOnlineUrl ? filePath : "file:///" + filePath.replace(/\\/g, "/");
		const title = customTitle || (isOnlineUrl ? "在线播放" : path.basename(filePath));
		const playerHtml = (0, path.join)(__dirname, "../../resources/player.html");
		const playerPreload = (0, path.join)(__dirname, "../../resources/player-preload.js");
		const { width: pw, height: ph } = getScreenBasedSize(.8, 900, 560);
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
			if (mainWindow) mainWindow.webContents.toggleDevTools();
		});
		const accelerator = process.platform === "darwin" ? "Command+Option+I" : "Control+Shift+I";
		electron.globalShortcut.register(accelerator, () => {
			if (mainWindow) mainWindow.webContents.toggleDevTools();
		});
	};
	registerDevToolsShortcut();
	electron.app.on("activate", function() {
		if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});
electron.app.on("window-all-closed", () => {
	electron.globalShortcut.unregisterAll();
	if (process.platform !== "darwin") electron.app.quit();
});
//#endregion
