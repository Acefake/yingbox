/**
 * 播放器里的 AI 字幕：为当前本地视频发起 / 取消任务、显示进度，生成完自动加载到播放器；
 * 已生成过的（视频旁边或字幕缓存里）可一键加载。在线播放不支持。
 */
import {
  type ComputedRef,
  type Ref,
  computed,
  onBeforeUnmount,
  ref,
  watch,
} from 'vue'

import { toast } from '@/components/ui'
import { useSetting } from '@/features/settings'

import type {
  AiSubtitleJob,
  AiSubtitleMode,
  AiSubtitleRecord,
} from '../../../../../shared/ai-subtitles/types'
import {
  aiSubtitleJobs,
  aiSubtitlesAvailable,
  cancelAiSubtitle,
  findAiSubtitle,
  onAiSubtitleFinished,
  startAiSubtitle,
} from './ai-subtitle-api'
import { latestJobFor, subtitleDisplayName } from './ai-subtitle-rules'

/** useAiSubtitle 的依赖 */
export interface AiSubtitleOptions {
  /** 当前播放地址（解析后）；local:// 才支持 */
  source: () => string
  /** 来自私密板块 */
  isPrivate: () => boolean
  /** 片名（翻译上下文） */
  title: () => string
  /** 把字幕文件挂到播放器；成功返回 true */
  load: (path: string, name: string) => Promise<boolean>
}

/** useAiSubtitle 的返回值 */
export interface AiSubtitleState {
  /** 当前视频能否生成（桌面端 + 本地文件） */
  supported: ComputedRef<boolean>
  /** 输出模式（记在设置 ai.subtitle.mode） */
  mode: Ref<AiSubtitleMode>
  setMode: (mode: AiSubtitleMode) => void
  /** 当前视频最新的任务 */
  job: ComputedRef<AiSubtitleJob | null>
  /** 当前视频已生成的字幕 */
  existing: Ref<AiSubtitleRecord | null>
  starting: Ref<boolean>
  start: () => Promise<void>
  cancel: () => Promise<void>
  loadExisting: () => Promise<void>
}

/** 创建播放器的 AI 字幕状态 */
export function useAiSubtitle(options: AiSubtitleOptions): AiSubtitleState {
  const available = aiSubtitlesAvailable()
  const jobs = available ? aiSubtitleJobs() : null
  const mode = useSetting('ai.subtitle.mode')
  const existing = ref<AiSubtitleRecord | null>(null)
  const starting = ref(false)

  const supported = computed(
    () => available && options.source().startsWith('local://')
  )
  const job = computed(() =>
    jobs ? latestJobFor(jobs.value.values(), options.source()) : null
  )

  const refreshExisting = async (): Promise<void> => {
    const source = options.source()
    const found = supported.value ? await findAiSubtitle(source) : null
    if (options.source() === source) existing.value = found
  }
  watch(options.source, () => void refreshExisting(), { immediate: true })

  const load = async (path: string): Promise<void> => {
    const ok = await options.load(path, subtitleDisplayName(path))
    if (!ok) toast.error('字幕已生成，但加载到播放器失败')
  }

  // 生成完成：还在播这个视频就自动加载
  const off = onAiSubtitleFinished(finished => {
    if (finished.source !== options.source()) return
    if (finished.phase === 'done' && finished.outputPath) {
      void load(finished.outputPath)
      void refreshExisting()
    } else if (finished.phase === 'failed') {
      toast.error(
        finished.error
          ? `AI 字幕生成失败：${finished.error}`
          : 'AI 字幕生成失败'
      )
    }
  })
  onBeforeUnmount(off)

  const start = async (): Promise<void> => {
    if (!supported.value || starting.value) return
    starting.value = true
    try {
      await startAiSubtitle(options.source(), {
        mode: mode.value,
        private: options.isPrivate(),
        title: options.title(),
      })
    } catch (error) {
      toast.error((error as Error).message || 'AI 字幕无法开始')
    } finally {
      starting.value = false
    }
  }

  const cancel = async (): Promise<void> => {
    const current = job.value
    if (current) await cancelAiSubtitle(current.id)
  }

  const loadExisting = async (): Promise<void> => {
    if (existing.value) await load(existing.value.path)
  }

  const setMode = (value: AiSubtitleMode): void => {
    mode.value = value
  }

  return {
    supported,
    mode,
    setMode,
    job,
    existing,
    starting,
    start,
    cancel,
    loadExisting,
  }
}
