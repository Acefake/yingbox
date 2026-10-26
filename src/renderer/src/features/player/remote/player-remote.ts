/**
 * 播放器的遥控执行端：AI 助手等外部功能经这里控制当前播放会话（开关弹幕、弹幕不透明度、字幕开关、
 * 睡眠定时、跳过片头、倍速）以及把问题交给「问剧情」。
 *
 * 跑在播放会话所在的页面：桌面端是独立播放器窗口（主窗口的请求经 host/player-host 转过来），
 * 网页端是页内播放层。只是把已有模块的接口接到一处：弹幕走设置（danmaku.*，useDanmaku 实时跟随），
 * 睡眠定时走 sleep-timer，跳过片头按 skip-store 的标记，字幕与倍速直接设在当前 Artplayer 实例上。
 * PlayerSession 拿到实例时 attach，换集 / 关闭时撤下；RecapLayer 登记问剧情。外置 mpv 播放时没有实例，不能遥控。
 */
import type Artplayer from 'artplayer'

import { setSetting } from '@/features/settings'

import { getSkipMarks } from '../skip/skip-store'
import { introSkipTarget } from '../skip/skip-rules'
import { type SleepChoice, sleepChoiceLabel } from '../sleep/sleep-rules'
import { setSleepChoice } from '../sleep/sleep-timer'

/** 外部能发给播放器的命令 */
export type PlayerRemoteCommand =
  | { kind: 'danmaku'; on: boolean }
  /** 弹幕不透明度 0.1–1 */
  | { kind: 'danmakuOpacity'; value: number }
  | { kind: 'subtitle'; on: boolean }
  | { kind: 'sleep'; choice: SleepChoice }
  | { kind: 'skipIntro' }
  /** 倍速 0.25–4 */
  | { kind: 'rate'; value: number }

/** 命令执行结果：text 是给用户看的一句话 */
export interface PlayerRemoteResult {
  ok: boolean
  text: string
}

/** PlayerSession 交给遥控的当前实例 */
export interface PlayerRemoteTarget {
  art: Artplayer
  /** 跳过片头标记的 key（skipKey()）；空串表示认不出是哪部剧 */
  skipKey: () => string
  /** 当前这一集的显示名 */
  title: () => string
  /** 来自私密板块 */
  private: boolean
}

type ChangeListener = () => void
const listeners = new Set<ChangeListener>()
const changed = (): void => listeners.forEach(listener => listener())

/**
 * 订阅遥控目标的变化（实例登记 / 撤下、问剧情登记 / 撤下）；播放器窗口据此把在播状态报给主窗口。
 * @returns 取消订阅
 */
export function onRemoteChange(listener: ChangeListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

let target: PlayerRemoteTarget | null = null
let plotAsk: ((question: string) => boolean) | null = null

/**
 * 登记当前播放器实例（换集会重新登记）。
 * @returns 撤下函数；实例已被替换时调用无效果
 */
export function attachPlayerRemote(next: PlayerRemoteTarget): () => void {
  target = next
  changed()
  const detach = (): void => {
    if (target !== next) return
    target = null
    changed()
  }
  next.art.on('destroy', detach)
  return detach
}

/**
 * 登记问剧情入口（RecapLayer）：收到问题时打开面板并提问，当前视频不支持时返回 false。
 * @returns 撤下函数
 */
export function attachPlotQa(ask: (question: string) => boolean): () => void {
  plotAsk = ask
  changed()
  return () => {
    if (plotAsk !== ask) return
    plotAsk = null
    changed()
  }
}

/** 本页的遥控目标能做什么 */
export interface LocalRemote {
  /** 有内置播放器实例可控制 */
  controllable: boolean
  /** 当前实例来自私密板块 */
  private: boolean
  /** 当前视频支持问剧情 */
  plotQa: boolean
  /** 当前这一集的显示名（没有实例时为空串） */
  title: string
  /** 播到第几秒 */
  seconds: number
}

/** 本页当前的遥控目标 */
export function localRemote(): LocalRemote {
  return {
    controllable: target !== null,
    private: target?.private === true,
    plotQa: plotAsk !== null,
    title: target?.title() ?? '',
    seconds: Math.floor(target?.art.currentTime || 0),
  }
}

/** 把数值夹到范围内并按步长取整 */
function clampStep(
  value: number,
  min: number,
  max: number,
  step: number
): number {
  const clamped = Math.min(max, Math.max(min, value))
  return Number((Math.round(clamped / step) * step).toFixed(4))
}

/** 在播放器上提示一句（全屏时也看得到） */
function notice(art: Artplayer, text: string): void {
  art.notice.show = text
}

/** 执行一条命令（需要内置播放器在播） */
function runOn(
  art: Artplayer,
  command: PlayerRemoteCommand
): PlayerRemoteResult {
  switch (command.kind) {
    case 'danmaku':
      void setSetting('danmaku.enabled', command.on).catch(() => {})
      return { ok: true, text: command.on ? '已打开弹幕' : '已关闭弹幕' }
    case 'danmakuOpacity': {
      const value = clampStep(command.value, 0.1, 1, 0.05)
      void setSetting('danmaku.opacity', value).catch(() => {})
      return {
        ok: true,
        text: `弹幕不透明度调到 ${Math.round(value * 100)}%`,
      }
    }
    case 'subtitle':
      if (command.on && !art.subtitle.url)
        return { ok: false, text: '这个视频还没有字幕' }
      art.subtitle.show = command.on
      return { ok: true, text: command.on ? '已显示字幕' : '已隐藏字幕' }
    case 'sleep':
      if (!setSleepChoice(command.choice))
        return { ok: false, text: '现在不能设睡眠定时' }
      return {
        ok: true,
        text:
          command.choice === 'off'
            ? '已关闭睡眠定时'
            : `睡眠定时：${sleepChoiceLabel(command.choice)}`,
      }
    case 'skipIntro': {
      const key = target?.skipKey() ?? ''
      const to = key
        ? introSkipTarget(getSkipMarks(key), art.currentTime)
        : null
      if (to === null)
        return { ok: false, text: '现在不在片头，或这部剧还没有标记片头' }
      art.seek = to
      return { ok: true, text: '已跳过片头' }
    }
    case 'rate': {
      const value = clampStep(command.value, 0.25, 4, 0.25)
      art.playbackRate = value
      return { ok: true, text: `已切到 ${value} 倍速` }
    }
  }
}

/** 在本页执行一条遥控命令；没有内置播放器实例（外置 mpv）时返回说明 */
export function runLocalCommand(
  command: PlayerRemoteCommand
): PlayerRemoteResult {
  if (!target) return { ok: false, text: '外置播放器播放时不能在这里控制' }
  const result = runOn(target.art, command)
  if (result.ok) notice(target.art, result.text)
  return result
}

/** 在本页把问题交给问剧情（打开面板并提问）；当前视频不支持时返回 false */
export function askLocalPlot(question: string): boolean {
  return plotAsk !== null && plotAsk(question)
}
