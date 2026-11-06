/* eslint-disable @typescript-eslint/no-require-imports -- 独立运行时直接加载的 CommonJS 入口，不依赖应用模块。 */
/** 在安装目录外运行，旧版退出与文件替换均不会销毁进度窗口。 */
const { app, BrowserWindow, ipcMain } = require('electron')
const { readFile, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const { spawn } = require('node:child_process')
const { mkdirSync } = require('node:fs')

const root = __dirname
let window
let state = { color: 'purple' }
let complete = false

function publish() {
  if (window && !window.isDestroyed())
    window.webContents.send('update-state', state)
}

function parentAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}

async function install(config) {
  while (parentAlive(config.parentPid))
    await new Promise(resolve => setTimeout(resolve, 100))
  await new Promise((resolve, reject) => {
    const child = spawn(config.installer, config.args, {
      env: { ...process.env, YINGBOX_UPDATE_UI: '1' },
      windowsHide: true,
      stdio: 'ignore',
    })
    child.once('error', reject)
    child.once('exit', code =>
      code === 0 ? resolve() : reject(new Error(`安装程序退出，错误码 ${code}`))
    )
  })
  complete = true
  app.quit()
}

mkdirSync(join(root, 'profile'), { recursive: true })
app.setPath('userData', join(root, 'profile'))
app
  .whenReady()
  .then(async () => {
    const config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'))
    state.color = config.color
    window = new BrowserWindow({
      width: 480,
      height: 320,
      frame: false,
      resizable: false,
      show: false,
      backgroundMaterial: 'acrylic',
      backgroundColor: '#00000000',
      darkTheme: true,
      webPreferences: {
        preload: join(root, 'preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    window.on('close', event => {
      if (!complete && !state.error) event.preventDefault()
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('console-message', (_event, ...details) =>
      console.error('[renderer]', ...details)
    )
    window.webContents.on('render-process-gone', (_event, details) =>
      console.error('[renderer-gone]', details)
    )
    window.webContents.on('will-navigate', event => event.preventDefault())
    ipcMain.on('update-ready', event => {
      if (event.sender === window.webContents) publish()
    })
    ipcMain.on('update-close', event => {
      if (event.sender === window.webContents && state.error) app.quit()
    })
    const painted = new Promise(resolve =>
      window.once('ready-to-show', resolve)
    )
    const mounted = new Promise(resolve => {
      ipcMain.on('update-mounted', event => {
        if (event.sender === window.webContents) resolve()
      })
    })
    await window.loadFile(join(root, 'renderer', 'update.html'))
    await Promise.all([painted, mounted])
    window.restore()
    window.show()
    window.focus()
    await writeFile(join(root, 'helper.pid'), String(process.pid))
    await writeFile(join(root, 'ready'), 'ready')
    await install(config)
  })
  .catch(error => {
    state.error = error.message
    publish()
    console.error(error)
  })
