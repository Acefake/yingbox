/**
 * 独立播放器窗口的跨进程数据：主窗口把播放交给播放器窗口，播放器窗口把进度、在播状态与遥控回执交回来。
 * 主进程只转发、不解析播放载荷与进度事件（两头都是同一份渲染层代码，字段由 player feature 校验）；
 * 在播状态与遥控回执在主进程边界按这里的规则收窄。
 *
 * 本文件被 sandboxed preload 间接打包，只能依赖纯 TS。
 */

import type { contract } from './contract'

/** 主进程给播放器窗口加的启动参数（webPreferences.additionalArguments），preload 据此只暴露下面这些域 */
export const PLAYER_WINDOW_ARG = '--yingbox-player-window'

/**
 * 播放器窗口能用的域：播放会话用到的那些（解析在线地址、字幕 / 弹幕 / AI 字幕、杜比视界重建、片头检测、截图、
 * 托盘与窗口控制、和主窗口往来）。片库、下载、网盘之类主窗口的能力不在这里；播放进度经 playerWindow 交给主窗口写。
 */
export const PLAYER_WINDOW_DOMAINS = [
  'ai',
  'aiSubtitles',
  'capture',
  'danmaku',
  'dolbyVision',
  'introDetect',
  'media',
  'mpv',
  'nowPlaying',
  'online',
  'playerWindow',
  'recap',
  'settings',
  'subtitle',
  'win',
] as const satisfies ReadonlyArray<keyof typeof contract>

/** 播放载荷（渲染层 PlayerPayload；主进程原样转发） */
export type PlayerWindowPayload = { readonly [key: string]: unknown }

/** 进度事件（渲染层 ProgressEvent；主进程原样转给主窗口） */
export type PlayerWindowProgress = { readonly [key: string]: unknown }

/** 播放器窗口里的在播状态（主窗口的 AI 助手、侧栏搜索据此判断在播与私密） */
export interface PlayerWindowState {
  /** 当前条目名 */
  title: string
  /** 来自私密板块 */
  private: boolean
  /** 有内置播放器实例可遥控 */
  controllable: boolean
  /** 当前视频能问剧情 */
  plotQa: boolean
  /** 播到第几秒 */
  seconds: number
}

/** 主窗口发给播放器窗口的请求：遥控命令（渲染层 PlayerRemoteCommand）或问剧情 */
export type PlayerWindowRequest =
  | { kind: 'remote'; command: { readonly [key: string]: unknown } }
  | { kind: 'ask'; question: string }

/** 请求的回执：text 是给用户看的一句话 */
export interface PlayerWindowReply {
  ok: boolean
  text: string
}

/** 片名最长保留的字符数 */
const TITLE_MAX = 200

const isObject = (raw: unknown): raw is Record<string, unknown> =>
  Boolean(raw) && typeof raw === 'object' && !Array.isArray(raw)

/** 解析在播状态；外形不对返回 undefined，null 表示没在播 */
export function parsePlayerWindowState(
  raw: unknown
): PlayerWindowState | null | undefined {
  if (raw === null) return null
  if (!isObject(raw) || typeof raw.title !== 'string') return undefined
  for (const key of ['private', 'controllable', 'plotQa'] as const)
    if (typeof raw[key] !== 'boolean') return undefined
  const seconds = raw.seconds
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0)
    return undefined
  return {
    title: raw.title.trim().slice(0, TITLE_MAX),
    private: raw.private as boolean,
    controllable: raw.controllable as boolean,
    plotQa: raw.plotQa as boolean,
    seconds: Math.floor(seconds),
  }
}

/** 解析主窗口的请求；外形不对返回 undefined */
export function parsePlayerWindowRequest(
  raw: unknown
): PlayerWindowRequest | undefined {
  if (!isObject(raw)) return undefined
  if (raw.kind === 'remote' && isObject(raw.command))
    return { kind: 'remote', command: raw.command }
  if (raw.kind === 'ask' && typeof raw.question === 'string')
    return { kind: 'ask', question: raw.question }
  return undefined
}

/** 解析回执；外形不对返回 undefined */
export function parsePlayerWindowReply(
  raw: unknown
): PlayerWindowReply | undefined {
  if (!isObject(raw) || typeof raw.ok !== 'boolean') return undefined
  return { ok: raw.ok, text: typeof raw.text === 'string' ? raw.text : '' }
}
