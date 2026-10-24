/**
 * 播放器里的跳过片头片尾：右键菜单标记、进度条区间、「跳过片头」按钮、自动跳过、片尾「下一集」倒计时。
 *
 * 每集一个 Artplayer 实例：attach 时重置这一集的状态（自动跳过是否用掉、片尾卡片是否被关掉），
 * 实例销毁时自动断开。标记按剧存（skip-store），同一部剧每集通用。
 */
import type Artplayer from 'artplayer'
import {
  type ComputedRef,
  type Ref,
  type ShallowRef,
  computed,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
} from 'vue'

import { getSetting } from '@/features/settings'

import { drawSkipSpans } from './progress-spans'
import {
  type SkipMarks,
  autoSkipStep,
  formatClock,
  inOutro,
  introSkipTarget,
  markIntroEnd,
  markIntroStart,
  markOutroStart,
} from './skip-rules'
import { clearSkipMarks, getSkipMarks, setSkipMarks } from './skip-store'

/** 片尾「下一集」倒计时（秒） */
export const NEXT_COUNTDOWN = 8

/** useSkipSegments 的输入 */
export interface SkipSegmentsInput {
  /** 当前剧的标记 key（skipKey）；空串表示认不出是哪部剧 */
  key: () => string
  /** 有没有下一集 */
  hasNext: () => boolean
  /** 播放下一集（PlayerSession 的 playNext） */
  playNext: () => void
}

/** useSkipSegments 交给界面层的状态与动作 */
export interface SkipSegments {
  /** 当前这一集的实例（销毁后为 null） */
  art: ShallowRef<Artplayer | null>
  /** 在片头里时该跳到的秒数，否则 null */
  introTarget: ComputedRef<number | null>
  /** 是否显示片尾「下一集」卡片 */
  showNext: ComputedRef<boolean>
  /** 倒计时剩余秒数 */
  countdown: Ref<number>
  /** 接管新一集的实例 */
  attach: (player: Artplayer | null) => void
  /** 「跳过片头」按钮 */
  skipIntro: () => void
  /** 「立即播放」 */
  playNow: () => void
  /** 「看完片尾」：关掉卡片，本集不再出现 */
  watchCredits: () => void
}

export function useSkipSegments(input: SkipSegmentsInput): SkipSegments {
  const art = shallowRef<Artplayer | null>(null)
  const time = ref(0)
  const duration = ref(0)
  /** 片尾卡片：用户点了「看完片尾」后本集不再出现 */
  const creditsDismissed = ref(false)
  const countdown = ref(NEXT_COUNTDOWN)
  /** 这一集的自动跳过是否已用掉 */
  let autoConsumed = false
  let timer: number | undefined

  const marks = computed<SkipMarks>(() => getSkipMarks(input.key()))
  const introTarget = computed(() => introSkipTarget(marks.value, time.value))
  const showNext = computed(
    () =>
      !!art.value &&
      input.hasNext() &&
      !creditsDismissed.value &&
      inOutro(marks.value, time.value, duration.value)
  )

  const notice = (text: string): void => {
    if (art.value) art.value.notice.show = text
  }

  const seekTo = (target: number): void => {
    const player = art.value
    if (!player) return
    player.video.currentTime = target
    time.value = target
  }

  /** 右键菜单的动作：改标记并提示结果 */
  const edit = (
    apply: (now: SkipMarks, t: number, d: number) => string
  ): void => {
    const player = art.value
    const key = input.key()
    if (!player) return
    if (!key) {
      notice('认不出是哪部剧，暂时不能标记')
      return
    }
    notice(apply(marks.value, player.video.currentTime, player.video.duration))
  }

  const menu: { name: string; html: string; run: () => void }[] = [
    {
      name: 'skip-intro-start',
      html: '标记片头开始',
      run: () =>
        edit((now, t) => {
          const next = markIntroStart(now, t)
          setSkipMarks(input.key(), next)
          return `片头开始 ${formatClock(next.intro!.start)}，再标记片头结束`
        }),
    },
    {
      name: 'skip-intro-end',
      html: '标记片头结束',
      run: () =>
        edit((now, t) => {
          const next = markIntroEnd(now, t)
          if (next === now) return '片头需在 5 秒到 10 分钟之间，未标记'
          setSkipMarks(input.key(), next)
          return `片头 ${formatClock(next.intro!.start)} – ${formatClock(next.intro!.end)}`
        }),
    },
    {
      name: 'skip-outro-start',
      html: '标记片尾开始',
      run: () =>
        edit((now, t, d) => {
          const next = markOutroStart(now, t, d)
          if (next === now) return '片尾需在最后 15 分钟内且不短于 5 秒，未标记'
          setSkipMarks(input.key(), next)
          return `片尾：最后 ${formatClock(next.outro!)}`
        }),
    },
    {
      name: 'skip-clear',
      html: '清除本剧片头片尾',
      run: () =>
        edit(() => {
          clearSkipMarks(input.key())
          return '已清除本剧片头片尾'
        }),
    },
  ]

  const redraw = (): void => {
    if (art.value) drawSkipSpans(art.value, marks.value, duration.value)
  }

  /** 播放进度：更新时间，必要时自动跳过片头 */
  const onTime = (): void => {
    const player = art.value
    if (!player) return
    time.value = player.video.currentTime
    if (Number.isFinite(player.video.duration))
      duration.value = player.video.duration
    if (player.video.seeking) return
    const step = autoSkipStep(marks.value, time.value, autoConsumed)
    if (step.target === null) {
      autoConsumed = step.consumed
      return
    }
    // 设置关着时不跳也不用掉，这样中途打开设置仍对本集生效
    if (!getSetting('player.autoSkipIntro')) return
    autoConsumed = true
    seekTo(step.target)
    notice('已跳过片头')
  }

  const onDuration = (): void => {
    const d = art.value?.video.duration
    duration.value = typeof d === 'number' && Number.isFinite(d) ? d : 0
    redraw()
  }

  const stopCountdown = (): void => {
    if (timer) window.clearInterval(timer)
    timer = undefined
    countdown.value = NEXT_COUNTDOWN
  }

  const detach = (): void => {
    stopCountdown()
    art.value = null
    time.value = 0
    duration.value = 0
  }

  const attach = (player: Artplayer | null): void => {
    detach()
    autoConsumed = false
    creditsDismissed.value = false
    if (!player) return
    art.value = player
    // 没有右键菜单层的实例（例如测试替身）只是不挂菜单
    for (const item of menu)
      player.contextmenu?.add({
        name: item.name,
        html: item.html,
        click: component => {
          component.show = false
          item.run()
        },
      })
    player.on('video:timeupdate', onTime)
    player.on('video:loadedmetadata', onDuration)
    player.on('video:durationchange', onDuration)
    player.on('destroy', () => {
      if (art.value === player) detach()
    })
    onDuration()
  }

  // 标记变了（本窗口或别的窗口）就重画进度条
  watch(marks, redraw)

  // 片尾卡片出现时开始倒计时（暂停时不走），到 0 播下一集
  watch(showNext, visible => {
    stopCountdown()
    if (!visible) return
    timer = window.setInterval(() => {
      if (art.value?.video.paused) return
      countdown.value -= 1
      if (countdown.value > 0) return
      stopCountdown()
      input.playNext()
    }, 1000)
  })

  onBeforeUnmount(detach)

  return {
    art,
    introTarget,
    showNext,
    countdown,
    attach,
    skipIntro: (): void => {
      if (introTarget.value !== null) seekTo(introTarget.value)
    },
    playNow: (): void => {
      stopCountdown()
      input.playNext()
    },
    watchCredits: (): void => {
      creditsDismissed.value = true
    },
  }
}
