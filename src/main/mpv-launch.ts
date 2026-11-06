/**
 * 起一个 mpv 子进程并接上 IPC：spawn、错误 / 退出监听、连接失败时的清理与报错，
 * 以及连上之后的握手（换片保护钩子、增强、属性观察、缩小置顶快捷键）。
 * 进程状态归 MpvPlayer 管，这里只通过 {@link LaunchHost} 回调。
 */
import { type ChildProcess, spawn } from 'child_process'
import type { MpvEnhancement } from './mpv-enhancement'
import type { MpvImageEnhance } from './mpv-enhance'
import { COMPACT_KEY, COMPACT_MESSAGE, WATCH_PROPS } from './mpv-props'
import type { MpvSocket } from './mpv-socket'
import { locateMpvUi } from './mpv-ui'
import { killTree } from './plugins/process'
import { settingsStore } from './settings'

export interface LaunchHost {
  sock: MpvSocket
  /** 当前登记的进程；和本次起的不是同一个，说明已被更新的进程取代 */
  current(): ChildProcess | null
  adopt(child: ChildProcess): void
  /** 启动出错（spawn 失败）：报错并收尾 */
  onError(message: string): void
  /** 进程退出：收尾；livedMs 是它活了多久 */
  onExit(livedMs: number): void
  /** 连不上时收尾 */
  cleanup(): void
}

/** 起进程并等 IPC 连上；失败时不留没人管的进程，抛出带原因的错误。 */
export async function launchMpv(
  host: LaunchHost,
  exe: string,
  args: string[],
  socket: string
): Promise<ChildProcess> {
  const child = spawn(exe, args, { stdio: 'ignore', windowsHide: false })
  host.adopt(child)
  const startedAt = Date.now()
  let spawnError: Error | null = null
  let exitDetail: string | null = null
  child.once('error', e => {
    spawnError = e
    if (host.current() !== child) return
    host.onError(`mpv 启动失败: ${e.message}`)
  })
  child.once('exit', (code, signal) => {
    exitDetail = signal ? `信号 ${signal}` : `退出码 ${code ?? '未知'}`
    if (host.current() === child) host.onExit(Date.now() - startedAt)
  })
  try {
    await host.sock.connect(socket, undefined, () => host.current() !== child)
  } catch (error) {
    // 连不上：不留没人管的 mpv 进程
    if (host.current() === child) {
      host.cleanup()
      void killTree(child)
    }
    const failed = spawnError as Error | null
    if (failed) throw new Error(`mpv 启动失败: ${failed.message}`)
    if (exitDetail) throw new Error(`mpv 启动后退出（${exitDetail}）`)
    throw error
  }
  return child
}

export interface HandshakeDeps {
  sock: MpvSocket
  hookScript: string | null
  cmd(...args: unknown[]): Promise<unknown>
  setProp(name: string, value: unknown): Promise<void>
  enhancement: MpvEnhancement
  imageEnhance: MpvImageEnhance
  onWarn(error: unknown): void
}

/** 连上之后的握手；每一步失败都只降级，不让开播失败。 */
export async function handshakeMpv(d: HandshakeDeps): Promise<void> {
  const hookReady = d.hookScript
    ? await d
        .cmd('get_property', 'user-data/yingbox-vsr-hook')
        .catch(() => null)
    : null
  let protectedReady = hookReady === 'ready'
  if (protectedReady)
    protectedReady = await d
      .setProp('user-data/yingbox-vsr-controlled', true)
      .then(
        () => true,
        () => false
      )
  await d.enhancement.connect(protectedReady)
  for (let i = 0; i < WATCH_PROPS.length; i++) {
    await d.sock.send({ command: ['observe_property', i + 1, WATCH_PROPS[i]] })
  }
  await d.imageEnhance.reset().catch(d.onWarn)
  // mpv 窗口里按快捷键切换缩小置顶（mpv 不支持 keybind 命令时忽略）
  await d.sock
    .send({
      command: ['keybind', COMPACT_KEY, `script-message ${COMPACT_MESSAGE}`],
    })
    .catch(() => {})
}

/** 只能靠启动参数生效的设置（超分、控制条）的签名：待命进程的签名和现在对不上，就要重开 */
export function launchSignature(vsrWanted: boolean): string {
  const ui = locateMpvUi(settingsStore().get('player.mpvUi'))
  return `${vsrWanted}|${ui?.kind ?? 'default'}`
}

/** 是否要后台常驻一个 mpv：设置里开着、引擎选 mpv、应用没在退出 */
export function prewarmEnabled(quitting: boolean): boolean {
  const store = settingsStore()
  return (
    store.get('player.mpvPrewarm') &&
    store.get('player.engine') === 'mpv' &&
    !quitting
  )
}
