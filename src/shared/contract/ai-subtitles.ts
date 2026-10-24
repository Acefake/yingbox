import {
  AI_SUBTITLE_MODES,
  type AiSubtitleJob,
  type AiSubtitleMode,
  type AiSubtitleRecord,
  type AiSubtitleStartOptions,
} from '../ai-subtitles/types'
import { ContractError, call, defineDomain, event, record, str } from './define'

/** 校验发起选项（只保留认识的字段） */
export function parseStartOptions(raw: unknown): AiSubtitleStartOptions {
  const input = record<Record<string, unknown>>(raw, 'options')
  if (!AI_SUBTITLE_MODES.includes(input.mode as AiSubtitleMode))
    throw new ContractError('参数 options.mode 不合法')
  const options: AiSubtitleStartOptions = { mode: input.mode as AiSubtitleMode }
  if (input.private === true) options.private = true
  if (typeof input.title === 'string' && input.title.trim())
    options.title = input.title.trim().slice(0, 200)
  if (typeof input.language === 'string' && /^[a-z]{2,3}$/.test(input.language))
    options.language = input.language
  return options
}

/**
 * AI 字幕：本地视频 → ffmpeg 抽音频 → Whisper（本地 whisper.cpp / 云端转写）→ 大模型翻译 → SRT。
 * 主进程一次跑一个任务（实现见 src/main/ai-subtitles）；只接受 local:// 地址。
 */
export const aiSubtitles = defineDomain(
  'aiSubtitles',
  {
    /** 加入队列；同一视频已有排队 / 进行中的任务时返回那个任务 */
    start: call<
      [localUrl: string, options: AiSubtitleStartOptions],
      AiSubtitleJob
    >(a => [str(a[0], 'localUrl'), parseStartOptions(a[1])]),
    /** 取消排队中或进行中的任务；返回是否找到 */
    cancel: call<[jobId: string], boolean>(a => [str(a[0], 'jobId')]),
    /** 最近的任务（进行中、排队、最近完成 / 失败） */
    list: call<AiSubtitleJob[]>(),
    /** 这个视频已生成的 AI 字幕（文件已不在时返回 null） */
    find: call<[localUrl: string], AiSubtitleRecord | null>(a => [
      str(a[0], 'localUrl'),
    ]),
  },
  {
    /** 任务状态或进度变化（进度节流推送） */
    changed: event<AiSubtitleJob>(),
  }
)
