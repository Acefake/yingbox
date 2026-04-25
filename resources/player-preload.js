const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('playerWin', {
  minimize: () => ipcRenderer.send('player-win:minimize'),
  close: () => ipcRenderer.send('player-win:close'),
})
