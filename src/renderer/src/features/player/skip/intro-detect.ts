/**
 * 自动检测片头片尾的渲染层入口：调主进程 introDetect 检测一季，结果并入 skip-store（手动优先）。
 *
 * - 只在桌面端可用（网页端没有 window.api，也没有本地 ffmpeg）；
 * - 进度按 key 存成全应用一份响应式表，剧集详情的按钮、播放时的自动检测共用；
 * - 传给 IPC 的一律是普通对象（不传 Vue 响应式对象）。
 */
import { type Ref, ref } from 'vue'

import type {
  IntroDetectProgress,
  IntroDetectRequest,
  IntroDetectResult,
  IntroDetectStatus,
} from '../../../../../shared/contract/intro-detect'
import { type ContinueMeta, recordId } from '../continue/continue-rules'
import { type MergeOutcome, mergeSummary } from './detect-merge'
import { skipKey } from './skip-rules'
import { applyDetected } from './skip-store'

/** 「继续播放」登记信息对应的标记 key（与播放器里 skipKey(continueId, …) 一致） */
export const skipKeyOf = (meta: ContinueMeta): string =>
  skipKey(recordId(meta.section, meta.key), meta.title)

/** 一次检测的结果：主进程原始结果、并入后的情况、给人看的一句话 */
export interface SeasonDetectOutcome {
  result: IntroDetectResult
  merge: MergeOutcome | null
  message: string
}

const progress: Ref<Record<string, IntroDetectProgress>> = ref({})
let listening = false

function listen(): void {
  if (listening || !window.api?.introDetect) return
  listening = true
  window.api.introDetect.onProgress(p => {
    const next = { ...progress.value }
    if (p.phase === 'finished') delete next[p.key]
    else next[p.key] = p
    progress.value = next
  })
}

/** 当前环境能不能用（桌面端才有） */
export const introDetectSupported = (): boolean =>
  typeof window !== 'undefined' && !!window.api?.introDetect

/** ffmpeg 是否可用；网页端直接不可用 */
export async function introDetectStatus(): Promise<IntroDetectStatus> {
  if (!introDetectSupported())
    return { available: false, reason: '只有桌面端能检测本地文件' }
  try {
    return await window.api.introDetect.status()
  } catch (error) {
    return { available: false, reason: (error as Error).message }
  }
}

/** 某一季的进度（响应式）；没在排队 / 检测时为 undefined */
export function detectProgressOf(key: string): IntroDetectProgress | undefined {
  listen()
  return progress.value[key]
}

/** 检测一季并把结果并入标记。 */
export async function detectSeason(
  request: IntroDetectRequest
): Promise<SeasonDetectOutcome> {
  listen()
  const plain: IntroDetectRequest = {
    key: request.key,
    label: request.label,
    files: [...request.files],
  }
  let result: IntroDetectResult
  try {
    result = await window.api.introDetect.detect(plain)
  } catch (error) {
    result = { key: plain.key, success: false, error: (error as Error).message }
  }
  if (!result.success)
    return {
      result,
      merge: null,
      message: result.cancelled
        ? '已取消检测片头片尾'
        : result.error || '检测片头片尾失败',
    }
  const merge = applyDetected(plain.key, {
    intro: result.intro,
    outro: result.outro,
  })
  return { result, merge, message: mergeSummary(merge) }
}

/** 取消某一季的检测 */
export async function cancelDetect(key: string): Promise<void> {
  if (!introDetectSupported()) return
  await window.api.introDetect.cancel(key)
}
