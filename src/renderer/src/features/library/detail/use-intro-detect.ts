/**
 * 剧集详情里的「检测片头片尾」：对当前季的本地文件做自动检测，结果写进这部剧的片头片尾标记
 * （与播放器右键手动标记同一份，手动优先）。
 *
 * - 只在桌面端显示（网页端的片库服务没有本地 ffmpeg）；ffmpeg 不可用时按钮禁用并给出原因；
 * - 本季有文件的集不足两集时禁用；
 * - 检测中再点一次即取消；进度来自主进程广播，离开详情页再回来也能接上。
 */
import { toast } from '@/components/ui'
import { type ComputedRef, computed, onMounted, ref } from 'vue'

import type { LibraryItemNode } from '../../../../../shared/library/ipc'
import {
  cancelDetect,
  detectProgressOf,
  detectSeason,
  introDetectStatus,
  introDetectSupported,
  skipKeyOf,
} from '@/features/player'

import { usesLibraryServer } from '../api/bridge'
import { seasonName } from './detail-rules'
import { continueMetaOf, playableEpisodes, videoFiles } from './playback'

/** 交给剧集区块的状态与动作 */
export interface IntroDetectControl {
  /** 是否显示入口（桌面端） */
  visible: boolean
  /** 禁用原因；可用时为空串 */
  blocked: ComputedRef<string>
  /** 按钮文字（含进度） */
  label: ComputedRef<string>
  /** 是否在排队 / 检测中 */
  running: ComputedRef<boolean>
  /** 开始检测；检测中则取消 */
  toggle: () => Promise<void>
}

export function useIntroDetect(
  series: () => LibraryItemNode,
  season: () => LibraryItemNode | null
): IntroDetectControl {
  const visible = !usesLibraryServer() && introDetectSupported()
  const available = ref(false)
  const unavailableReason = ref('')

  onMounted(async () => {
    if (!visible) return
    const status = await introDetectStatus()
    available.value = status.available
    unavailableReason.value = status.reason ?? ''
  })

  const files = computed(() => {
    const current = season()
    return current ? playableEpisodes(current).map(ep => videoFiles(ep)[0]) : []
  })
  const key = computed(() => skipKeyOf(continueMetaOf(series())))
  const progress = computed(() => detectProgressOf(key.value))

  /** 禁用原因；可用时为空串 */
  const blocked = computed(() => {
    if (!available.value)
      return unavailableReason.value || '没有找到 ffmpeg，无法检测片头片尾'
    if (files.value.length < 2) return '本季本地文件不足两集，无法比对'
    return ''
  })

  const label = computed(() => {
    const p = progress.value
    if (!p) return '检测片头片尾'
    if (p.phase === 'queued') return '排队中，点击取消'
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0
    return `检测中 ${pct}%，点击取消`
  })

  async function toggle(): Promise<void> {
    if (progress.value) {
      await cancelDetect(key.value)
      return
    }
    const current = season()
    if (blocked.value || !current) return
    const outcome = await detectSeason({
      key: key.value,
      label: `${series().title} ${seasonName(current)}`,
      files: files.value,
    })
    if (outcome.result.cancelled) toast.info(outcome.message)
    else if (!outcome.result.success) toast.error(outcome.message)
    else if (
      outcome.merge?.intro === 'applied' ||
      outcome.merge?.outro === 'applied'
    )
      toast.success(outcome.message)
    else toast.info(outcome.message)
  }

  return {
    visible,
    blocked,
    label,
    running: computed(() => !!progress.value),
    toggle,
  }
}
