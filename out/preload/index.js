let _electron_toolkit_preload = require("@electron-toolkit/preload");
let electron = require("electron");
//#region src/preload/index.ts
var api = {
	file: {
		read: (filePath) => electron.ipcRenderer.invoke("file:read", filePath),
		write: (filePath, content) => electron.ipcRenderer.invoke("file:write", filePath, content),
		delete: (filePath) => electron.ipcRenderer.invoke("file:delete", filePath),
		exists: (filePath) => electron.ipcRenderer.invoke("file:exists", filePath),
		mkdir: (dirPath) => electron.ipcRenderer.invoke("file:mkdir", dirPath),
		readdir: (dirPath) => electron.ipcRenderer.invoke("file:readdir", dirPath),
		readdirRecursive: (dirPath) => electron.ipcRenderer.invoke("file:readdirRecursive", dirPath),
		stat: (filePath) => electron.ipcRenderer.invoke("file:stat", filePath),
		copy: (srcPath, destPath) => electron.ipcRenderer.invoke("file:copy", srcPath, destPath),
		move: (srcPath, destPath) => electron.ipcRenderer.invoke("file:move", srcPath, destPath),
		readImage: (filePath) => electron.ipcRenderer.invoke("file:readImage", filePath)
	},
	http: {
		download: (url, filePath) => electron.ipcRenderer.invoke("http:download", url, filePath),
		fetch: (url, options) => electron.ipcRenderer.invoke("http:fetch", url, options ?? {}),
		fetchImage: (url, referer) => electron.ipcRenderer.invoke("http:fetchImage", url, referer)
	},
	path: {
		join: (...paths) => electron.ipcRenderer.invoke("path:join", ...paths),
		resolve: (...paths) => electron.ipcRenderer.invoke("path:resolve", ...paths),
		dirname: (filePath) => electron.ipcRenderer.invoke("path:dirname", filePath),
		basename: (filePath, ext) => electron.ipcRenderer.invoke("path:basename", filePath, ext),
		extname: (filePath) => electron.ipcRenderer.invoke("path:extname", filePath)
	},
	dialog: {
		openDirectory: () => electron.ipcRenderer.invoke("dialog:openDirectory"),
		openFile: (options) => electron.ipcRenderer.invoke("dialog:openFile", options),
		saveFile: (options) => electron.ipcRenderer.invoke("dialog:saveFile", options)
	},
	app: { getVersion: () => electron.ipcRenderer.invoke("app:getVersion") },
	update: {
		check: () => electron.ipcRenderer.invoke("update:check"),
		download: () => electron.ipcRenderer.invoke("update:download"),
		install: () => electron.ipcRenderer.invoke("update:install"),
		onStatus: (cb) => electron.ipcRenderer.on("update:status", (_e, status) => cb(status)),
		offStatus: () => electron.ipcRenderer.removeAllListeners("update:status")
	},
	shell: { openPath: (filePath) => electron.ipcRenderer.invoke("shell:openPath", filePath) },
	player: { open: (filePath) => electron.ipcRenderer.invoke("player:open", filePath) },
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
	scraper: {},
	downloader: {}
};
if (process.contextIsolated) try {
	electron.contextBridge.exposeInMainWorld("electron", _electron_toolkit_preload.electronAPI);
	electron.contextBridge.exposeInMainWorld("api", api);
} catch (error) {
	console.error(error);
}
else {
	window.electron = _electron_toolkit_preload.electronAPI;
	window.api = api;
}
//#endregion
