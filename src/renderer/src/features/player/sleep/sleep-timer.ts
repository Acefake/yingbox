/**
 * 睡眠定时：播放器设置菜单里的「睡眠定时」，到点前 10 秒渐弱音量，然后暂停并恢复音量。
 *
 * 定时状态是模块级的（同一页面同一时刻只有一个播放会话）：自动连播换集会重建 Artplayer，
 * 新实例挂上来时沿用定时；关掉播放器超过 SLEEP_REATTACH_MS 再开播则作废。纯规则见 sleep-rules.ts。
 */
import type { Setting } from 'artplayer'
import type Artplayer from 'artplayer'

import { artIcon } from '../utils/art-options'
import {
  SLEEP_CHOICES,
  type SleepChoice,
  type SleepState,
  formatSleepRemaining,
  keepSleepOnAttach,
  sleepChoiceLabel,
  sleepChoiceOf,
  sleepEndsAtVideoEnd,
  sleepRemainingMs,
  sleepStep,
  startSleep,
} from './sleep-rules'

/** 设置菜单项名（Artplayer setting 的 name） */
const SETTING_NAME = 'ybSleep'
/** 检查间隔（毫秒）：渐弱需要足够细，250ms 听不出台阶 */
const TICK_MS = 250

let state: SleepState | null = null
/** 上一个播放器拆掉的时刻；有播放器挂着时为 null */
let detachedAt: number | null = null

/** 当前挂着的播放器在定时被结束事件消费后的收尾（恢复音量、刷新菜单）；没有播放器为 null */
let onConsumed: (() => void) | null = null

/** 当前挂着的播放器上「选一项」的入口（同时刷新菜单）；没有播放器为 null */
let pickOnPlayer: ((choice: SleepChoice) => void) | null = null

/**
 * 从播放器外面（AI 助手）设睡眠定时，效果与在设置菜单里选同一项一样。
 * @returns 有播放器挂着并已设置时为 true
 */
export function setSleepChoice(choice: SleepChoice): boolean {
  if (!pickOnPlayer) return false
  pickOnPlayer(choice)
  return true
}

/** 当前定时（测试与调试用） */
export function currentSleep(): SleepState | null {
  return state
}

/**
 * 播放结束（ended）时同步检查并消费睡眠定时：生效则清掉定时并返回 true，
 * 调用方据此停在本集、不自动连播；之后新挂上的播放器不会再沿用这次的定时。
 * 由自动连播入口（PlayerSession 的 onEnded）在 playNext 之前调用。
 * @param now 当前时刻（毫秒）
 */
export function consumeSleepAtEnd(now = Date.now()): boolean {
  if (!sleepEndsAtVideoEnd(state, now)) return false
  state = null
  onConsumed?.()
  return true
}

/** 菜单右侧的提示：选中项，按分钟计时时换成剩余时间 */
function tooltipText(art: Artplayer): string {
  if (!state) return sleepChoiceLabel('off')
  const left = sleepRemainingMs(state, Date.now(), art.video)
  if (state.mode === 'minutes' && left !== null)
    return formatSleepRemaining(left)
  return sleepChoiceLabel(sleepChoiceOf(state))
}

/** 设置菜单项（按当前定时标出选中项） */
function settingConfig(
  art: Artplayer,
  onPick: (choice: SleepChoice) => void
): Setting {
  const current = sleepChoiceOf(state)
  return {
    name: SETTING_NAME,
    html: '睡眠定时',
    icon: artIcon('moon'),
    width: 200,
    tooltip: tooltipText(art),
    selector: SLEEP_CHOICES.map(choice => ({
      html: sleepChoiceLabel(choice),
      value: choice,
      default: choice === current,
    })),
    onSelect(item) {
      onPick(item.value as SleepChoice)
      return tooltipText(art)
    },
  }
}

/**
 * 给一个播放器实例装上睡眠定时（设置菜单项 + 计时）。实例销毁时自动拆除。
 * @param art Artplayer 实例
 */
export function installSleepTimer(art: Artplayer): void {
  const now = Date.now()
  if (!keepSleepOnAttach(detachedAt, now)) state = null
  detachedAt = null

  /** 渐弱开始时的音量；不在渐弱中为 null */
  let baseVolume: number | null = null
  let lastTooltip = ''

  const restoreVolume = (): void => {
    if (baseVolume === null) return
    art.video.volume = baseVolume
    baseVolume = null
  }

  const refreshMenu = (): void => {
    art.setting.update(settingConfig(art, pick))
  }

  const pick = (choice: SleepChoice): void => {
    restoreVolume()
    state = startSleep(choice, Date.now())
    if (choice === 'off') art.notice.show = '已关闭睡眠定时'
    else if (choice === 'episode') art.notice.show = '本集播完后暂停'
    else art.notice.show = `${choice} 分钟后暂停播放`
  }

  const stop = (): void => {
    state = null
    const wasPlaying = !art.video.paused
    art.video.pause()
    restoreVolume()
    if (wasPlaying) art.notice.show = '睡眠定时到了，已暂停播放'
    refreshMenu()
  }

  const tick = (): void => {
    const step = sleepStep(state, Date.now(), art.video, !art.video.paused)
    if (step.kind === 'stop') {
      stop()
      return
    }
    if (step.kind === 'fade') {
      if (baseVolume === null) baseVolume = art.video.volume
      art.video.volume = baseVolume * step.factor
    } else {
      restoreVolume()
    }
    const text = tooltipText(art)
    if (text !== lastTooltip) {
      lastTooltip = text
      const tip = art.setting.find(SETTING_NAME)?.$tooltip
      if (tip) tip.textContent = text
    }
  }

  const consumed = (): void => {
    restoreVolume()
    refreshMenu()
  }

  const pickAndRefresh = (choice: SleepChoice): void => {
    pick(choice)
    refreshMenu()
  }

  art.setting.add(settingConfig(art, pick))
  onConsumed = consumed
  pickOnPlayer = pickAndRefresh
  const timer = window.setInterval(tick, TICK_MS)
  art.on('destroy', () => {
    window.clearInterval(timer)
    if (onConsumed === consumed) onConsumed = null
    if (pickOnPlayer === pickAndRefresh) pickOnPlayer = null
    restoreVolume()
    detachedAt = Date.now()
  })
}
