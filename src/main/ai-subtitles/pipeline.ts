/**
 * 一个 AI 字幕任务的流程：读时长 → 分段（10 分钟）抽 16k 单声道 wav → 逐段识别并平移到整片时间轴
 * → （需要时）分批翻译 → 合成 SRT 并写出。进程、网络、文件都经 {@link PipelineDeps} 注入，测试可全部替换。
 */
import { join } from 'node:path'
import { formatSrt } from '../../shared/ai-subtitles/srt'
import type {
  AiSubtitleCue,
  AiSubtitleMode,
} from '../../shared/ai-subtitles/types'
import {
  type AudioChunk,
  type Transcript,
  dominantLanguage,
  isChinese,
  offsetCues,
  planChunks,
} from './speech-rules'
import { type TranslateDeps, composeCues, translateCues } from './translate'

/** 流程依赖 */
export interface PipelineDeps {
  /** 视频时长（秒） */
  probeDuration(videoPath: string, signal: AbortSignal): Promise<number>
  /** 临时目录（任务结束后删除） */
  makeTempDir(): Promise<string>
  removeTempDir(dir: string): Promise<void>
  /** 抽一段音频到 wavPath */
  extract(
    videoPath: string,
    chunk: AudioChunk,
    wavPath: string,
    signal: AbortSignal
  ): Promise<void>
  /** 识别一段 wav（时间相对这一段的起点） */
  recognize(
    wavPath: string,
    chunk: AudioChunk,
    options: {
      language?: string
      signal: AbortSignal
      onProgress: (percent: number) => void
    }
  ): Promise<Transcript>
  /** 翻译前检查模型可用（没配置 / 私密拦截时抛错，免得识别完才发现） */
  checkTranslate(): void
  /** 翻译用的模型调用 */
  translate: TranslateDeps
  /** 写出 SRT，返回实际路径 */
  write(
    videoPath: string,
    mode: AiSubtitleMode,
    language: string,
    srt: string
  ): Promise<string>
  /** 降级等非致命情况的日志 */
  warn?(message: string): void
}

/** 流程输入 */
export interface PipelineInput {
  videoPath: string
  mode: AiSubtitleMode
  title?: string
  /** 指定识别语言；省略为自动 */
  language?: string
}

/** 进度回调：识别 / 翻译阶段的百分比 */
export interface PipelineProgress {
  (phase: 'recognizing' | 'translating', percent: number): void
}

/** 流程结果 */
export interface PipelineResult {
  outputPath: string
  language: string
  cues: AiSubtitleCue[]
}

/** 跑完整流程 */
export async function runPipeline(
  input: PipelineInput,
  deps: PipelineDeps,
  options: { signal: AbortSignal; onProgress: PipelineProgress }
): Promise<PipelineResult> {
  const { signal, onProgress } = options
  if (input.mode !== 'original') deps.checkTranslate()

  onProgress('recognizing', 0)
  const duration = await deps.probeDuration(input.videoPath, signal)
  const chunks = planChunks(duration)
  if (!chunks.length) throw new Error('读不到视频时长，无法分段识别')

  const temp = await deps.makeTempDir()
  const cues: AiSubtitleCue[] = []
  const languages: string[] = []
  try {
    for (const chunk of chunks) {
      signal.throwIfAborted()
      const report = (fraction: number): void =>
        onProgress(
          'recognizing',
          Math.min(
            99,
            Math.floor(((chunk.index + fraction) / chunks.length) * 100)
          )
        )
      report(0)
      const wav = join(temp, `chunk-${chunk.index}.wav`)
      await deps.extract(input.videoPath, chunk, wav, signal)
      const part = await deps.recognize(wav, chunk, {
        language: input.language,
        signal,
        onProgress: percent => report(Math.min(1, Math.max(0, percent / 100))),
      })
      languages.push(part.language)
      cues.push(
        ...offsetCues(part.cues, chunk.start).map(cue => ({
          ...cue,
          // 段尾的字幕不超出这一段
          end: Math.min(
            cue.end,
            Math.round((chunk.start + chunk.duration) * 1000)
          ),
        }))
      )
    }
  } finally {
    await deps.removeTempDir(temp).catch(() => {})
  }
  onProgress('recognizing', 100)
  if (!cues.length) throw new Error('没有识别到台词')
  cues.sort((a, b) => a.start - b.start)

  const language = input.language || dominantLanguage(languages)
  let translations = cues.map(cue => cue.text)
  if (input.mode !== 'original' && !isChinese(language)) {
    onProgress('translating', 0)
    translations = await translateCues(cues, {
      deps: deps.translate,
      title: input.title,
      language,
      signal,
      onProgress: percent => onProgress('translating', percent),
      onWarn: deps.warn,
    })
  }
  const final = composeCues(cues, translations, input.mode)
  signal.throwIfAborted()
  const outputPath = await deps.write(
    input.videoPath,
    input.mode,
    language,
    formatSrt(final)
  )
  return { outputPath, language, cues: final }
}
