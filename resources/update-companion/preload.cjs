/* eslint-disable @typescript-eslint/no-require-imports -- sandboxed preload 仅允许 require electron。 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('updateCompanion', {
  ready: () => ipcRenderer.send('update-mounted'),
  close: () => ipcRenderer.send('update-close'),
  onState(callback) {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('update-state', listener)
    ipcRenderer.send('update-ready')
    return () => ipcRenderer.removeListener('update-state', listener)
  },
})
