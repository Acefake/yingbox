/**
 * AI 字幕的共享类型：主进程任务队列（src/main/ai-subtitles）、IPC 契约（contract/ai-subtitles）
 * 与播放器字幕面板（features/player/ai-subtitle）共用。本文件被 sandboxed preload 间接打包，只能是纯 TS。
 */

/** 输出：译成中文 / 中文 + 原文双语 / 只要原文（不翻译） */
export type AiSubtitleMode = 'zh' | 'bilingual' | 'original'

/** 全部输出模式 */
export const AI_SUBTITLE_MODES: readonly AiSubtitleMode[] = [
  'zh',
  'bilingual',
  'original',
]

/** 任务阶段 */
export type AiSubtitlePhase =
  | 'queued'
  | 'recognizing'
  | 'translating'
  | 'done'
  | 'failed'
  | 'cancelled'

/** 一条字幕（时间为毫秒） */
export interface AiSubtitleCue {
  start: number
  end: number
  text: string
}

/** 发起任务的选项 */
export interface AiSubtitleStartOptions {
  mode: AiSubtitleMode
  /**
   * 来自私密板块（AV / 番号 / lada 等）。翻译请求带 private，
   * 设置「私密板块只用本地模型」打开时只发给本地模型；云端转写同样只允许本地接口。
   */
  private?: boolean
  /** 片名（翻译时作为上下文） */
  title?: string
  /** 识别语言（ISO 639-1，如 en / ja）；省略为自动检测 */
  language?: string
}

/** 一个 AI 字幕任务的快照 */
export interface AiSubtitleJob {
  id: string
  /** 发起时的 local:// 地址（渲染层据此对应到当前播放的视频） */
  source: string
  /** 视频文件路径 */
  videoPath: string
  title: string
  mode: AiSubtitleMode
  private: boolean
  phase: AiSubtitlePhase
  /** 当前阶段的进度 0–100 */
  percent: number
  /** 识别出的语言（ISO 639-1；未知为空串） */
  language: string
  /** 完成后的字幕文件路径 */
  outputPath?: string
  /** 失败原因 */
  error?: string
  createdAt: number
  updatedAt: number
}

/** 已生成的 AI 字幕（按视频记在 userData/ai-subtitles/index.json） */
export interface AiSubtitleRecord {
  videoPath: string
  /** SRT 文件路径（视频同目录或 userData 字幕缓存） */
  path: string
  mode: AiSubtitleMode
  /** 原文语言（ISO 639-1；未知为空串） */
  language: string
  updatedAt: number
  /** 本功能为这个视频写过的字幕文件（新的在前）；只有这些允许被再次覆盖 */
  outputs?: string[]
}
