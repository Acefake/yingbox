/**
 * 内置播放器放在哪儿播：桌面端交给独立的播放器窗口（主进程 src/main/player-window），网页端是盖在页面上的
 * 播放层（modal/PlayerModal）。openMediaPlayer、关闭、在播状态与遥控都经这里，调用方不分桌面 / 网页。
 *
 * 桌面端（主窗口这一侧）：
 * - 开播：载荷转成普通 JSON（去掉 Vue 代理），媒体库条目带上片库记的续播位置（播放器窗口里没有片库缓存）；
 * - 回写：播放器窗口的进度事件经主进程转回来，在这里照 applyProgressEvent 就地写（片库进度缓存、继续播放、
 *   「已看完」），主窗口的片库与继续播放横排立即更新；
 * - 在播状态：播放器窗口报来的片名 / 私密 / 能否遥控 / 播到哪，关窗时清空；
 * - 遥控：请求经主进程转给播放器窗口，等它的回执；播放器窗口里要打开的应用内地址转回来由主窗口跳转。
 * 网页端：播放层就在本页，遥控直接落到本页的播放会话（remote/player-remote）。
 */
import { type ShallowRef, computed, shallowRef } from 'vue'

import { toast } from '@/components/ui'

import type { PlayerWindowState } from '../../../../../shared/player-window'
import { libraryResumeAt } from '../progress/library-sink'
import {
  type ProgressEvent,
  applyProgressEvent,
} from '../progress/progress-events'
import {
  type PlayerRemoteCommand,
  type PlayerRemoteResult,
  askLocalPlot,
  localRemote,
  runLocalCommand,
} from '../remote/player-remote'
import type { PlayerPayload } from '../utils/play-queue'

/** 网页端的播放层会话 */
export interface InPagePlayer {
  /** 会话序号：每次打开都换新，播放会话按它重建 */
  id: number
  payload: PlayerPayload
}

/** 当前播放会话（不管在哪儿播）：AI 助手、侧栏搜索据此判断 */
export interface PlayerSessionInfo {
  /** 来自私密板块 */
  private: boolean
  /** 播放层盖在本页上（网页端）；桌面端在独立窗口里播，为 false */
  inPage: boolean
}

/** 当前播放能被遥控到什么程度 */
export interface PlayerRemoteState {
  /** 有播放会话（播放器窗口开着，或网页端播放层开着） */
  playing: boolean
  /** 有内置播放器实例可控制 */
  controllable: boolean
  /** 当前播放来自私密板块 */
  private: boolean
  /** 当前视频支持问剧情 */
  plotQa: boolean
}

/** 当前在播的片名与时间点（秒） */
export interface PlayerNowPlaying {
  title: string
  seconds: number
  private: boolean
}

const inPage = shallowRef<InPagePlayer | null>(null)
let opened = 0
/** 播放器窗口报来的在播状态（桌面端） */
const windowState = shallowRef<PlayerWindowState | null>(null)

/** 当前页面是独立播放器窗口（player.html）：没有路由，应用内地址交给主窗口打开 */
export function inPlayerWindow(): boolean {
  return (
    typeof location !== 'undefined' &&
    location.pathname.endsWith('/player.html')
  )
}

/** 在主窗口打开应用内地址并把它带到前面（播放器窗口里用，如播完提示的「去追更」） */
export function openInMainWindow(to: string): void {
  void windowApi()
    ?.navigate(to)
    .catch(() => {})
}

/** 播放器窗口的桥（只有桌面端主窗口 / 播放器窗口的 preload 有） */
const windowApi = (): Window['api']['playerWindow'] | undefined =>
  typeof window !== 'undefined' ? window.api?.playerWindow : undefined

/** 载荷转成可经 IPC 传的普通 JSON，媒体库条目带上片库记的续播位置 */
function windowPayload(payload: PlayerPayload): PlayerPayload {
  const plain = JSON.parse(JSON.stringify(payload)) as PlayerPayload
  if (!plain.playlist) return plain
  return {
    ...plain,
    playlist: plain.playlist.map(entry => {
      const resume = libraryResumeAt(entry.library)
      return resume === undefined ? entry : { ...entry, libraryResume: resume }
    }),
  }
}

/** 开始播放：桌面端交给播放器窗口（开着就换片并聚焦），网页端打开本页的播放层（正在播就换成新的会话） */
export function openPlayer(payload: PlayerPayload): void {
  const api = windowApi()
  if (!api) {
    inPage.value = { id: ++opened, payload: { ...payload } }
    return
  }
  api.open(windowPayload(payload)).catch((error: unknown) => {
    console.warn('[player] 打开播放器窗口失败', error)
    toast.error('打开播放器窗口失败')
  })
}

/** 停止播放：桌面端关掉播放器窗口（主窗口、播放器窗口里都能调），网页端关掉播放层 */
export function closePlayer(): void {
  const api = windowApi()
  if (api) void api.close().catch(() => {})
  else inPage.value = null
}

/** 网页端播放层的会话（响应式，只读）；桌面端恒为 null */
export function inPagePlayer(): Readonly<ShallowRef<InPagePlayer | null>> {
  return inPage
}

const session = computed<PlayerSessionInfo | null>(() => {
  if (inPage.value)
    return { private: inPage.value.payload.private === true, inPage: true }
  if (windowState.value)
    return { private: windowState.value.private, inPage: false }
  return null
})

/** 当前播放会话（响应式，只读）；没在播时为 null */
export function playerSession(): Readonly<{
  value: PlayerSessionInfo | null
}> {
  return session
}

/** 当前遥控状态 */
export function playerRemoteState(): PlayerRemoteState {
  const state = windowState.value
  if (state)
    return {
      playing: true,
      controllable: state.controllable,
      private: state.private,
      plotQa: state.plotQa,
    }
  const page = inPage.value
  if (!page)
    return {
      playing: false,
      controllable: false,
      private: false,
      plotQa: false,
    }
  const local = localRemote()
  return {
    playing: true,
    controllable: local.controllable,
    private: page.payload.private === true || local.private,
    plotQa: local.plotQa,
  }
}

/** 当前在播什么、播到哪（给助手做上下文）；没在播或外置播放器时为 null */
export function playerNowPlaying(): PlayerNowPlaying | null {
  const state = playerRemoteState()
  if (!state.playing || !state.controllable) return null
  const source = windowState.value ?? localRemote()
  return {
    title: source.title,
    seconds: source.seconds,
    private: state.private,
  }
}

/** 执行一条遥控命令；没在播或是外置 mpv 时返回说明 */
export async function runPlayerCommand(
  command: PlayerRemoteCommand
): Promise<PlayerRemoteResult> {
  if (!playerRemoteState().playing)
    return { ok: false, text: '现在没有正在播放的视频' }
  const api = windowApi()
  if (windowState.value && api)
    return api
      .command({ kind: 'remote', command })
      .catch(() => ({ ok: false, text: '播放器没有响应' }))
  return runLocalCommand(command)
}

/** 把问题交给问剧情（打开面板并提问）；当前视频不支持时返回 false */
export async function askPlotQuestion(question: string): Promise<boolean> {
  if (!playerRemoteState().plotQa) return false
  const api = windowApi()
  if (windowState.value && api)
    return api
      .command({ kind: 'ask', question })
      .then(reply => reply.ok)
      .catch(() => false)
  return askLocalPlot(question)
}

let installed = false

/**
 * 主窗口启动时调一次（应用入口）：接上播放器窗口转回来的进度事件、在播状态与要打开的应用内地址。
 * 网页端没有播放器窗口，什么也不做。
 * @param navigate 在主窗口打开应用内地址（路由跳转）
 */
export function installPlayerHost(navigate: (to: string) => void): void {
  const api = windowApi()
  if (installed || !api) return
  installed = true
  api.onRelay(event => applyProgressEvent(event as unknown as ProgressEvent))
  api.onSession(state => {
    windowState.value = state
  })
  api.onRoute(navigate)
}
