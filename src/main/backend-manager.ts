import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { spawn } from 'child_process'
import * as fsSync from 'fs'
import { join } from 'path'

let goProc: ReturnType<typeof spawn> | null = null
let stopping = false

/**
 * 启动 Go 后端（打包后从 resources/backend/main.exe）。
 *
 * 开发模式下后端由 `pnpm dev:backend` 启动，这里不重复拉起。
 * 退出时先杀掉后端再退出应用（Windows 需要 taskkill /T 连子进程一起收）。
 */
export function startBackend(options: {
  configPath: string
  downloadPath: string
}): void {
  const isDev = is.dev
  console.log('[Go] isDev:', isDev, 'resourcesPath:', process.resourcesPath)

  if (isDev) {
    console.log('[Go] Development mode: backend should be started by pnpm dev:backend')
    return
  }

  const goExe = join(
    process.resourcesPath,
    'backend',
    process.platform === 'win32' ? 'main.exe' : 'main'
  )
  const goCwd = join(process.resourcesPath, 'backend')

  console.log('[Go] Looking for backend at:', goExe)

  if (fsSync.existsSync(goExe)) {
    console.log('[Go] Starting backend from:', goExe)
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      YINGBOX_CONFIG_PATH: options.configPath,
      PROJECT_ROOT: app.getAppPath(),
      NODE_EXECUTABLE: process.execPath,
    }
    env.ELECTRON_RUN_AS_NODE = '1'
    if (options.downloadPath) {
      env.MISSAV_VIDEO_PATH = options.downloadPath
      console.log('[Go] Using custom download path:', options.downloadPath)
    }

    try {
      goProc = spawn(goExe, [], { cwd: goCwd, env, shell: false, windowsHide: true })
      goProc.stdout?.on('data', (d: Buffer) =>
        console.log('[Go stdout]', d.toString().trim())
      )
      goProc.stderr?.on('data', (d: Buffer) =>
        console.error('[Go stderr]', d.toString().trim())
      )
      goProc.on('exit', (code, signal) => {
        console.log('[Go] exited with code', code, 'signal:', signal)
      })
      goProc.on('error', err => {
        console.error('[Go] spawn error:', err.message)
      })
      console.log('[Go] Backend process started with PID:', goProc.pid)
    } catch (err) {
      console.error('[Go] Failed to start backend:', err)
    }
  } else {
    console.error('[Go] backend exe not found:', goExe)
    try {
      const resourcesDir = join(process.resourcesPath, 'backend')
      if (fsSync.existsSync(resourcesDir)) {
        const files = fsSync.readdirSync(resourcesDir)
        console.log('[Go] Resources/backend contents:', files)
      } else {
        console.error('[Go] Resources/backend directory does not exist')
      }
    } catch (e) {
      console.error('[Go] Error listing resources:', e)
    }
  }

  app.on('before-quit', event => {
    if (!goProc || stopping) return
    event.preventDefault()
    stopping = true
    const child = goProc
    const finish = (): void => {
      goProc = null
      app.quit()
    }
    if (process.platform === 'win32' && child.pid) {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
      })
      killer.once('error', () => {
        child.kill()
        finish()
      })
      killer.once('exit', finish)
    } else {
      child.once('exit', finish)
      child.kill('SIGTERM')
      setTimeout(() => {
        child.kill('SIGKILL')
        finish()
      }, 5000).unref()
    }
  })
}
