import { ContractError, call, defineDomain, event, record, str } from './define'

/** 一季最多检测多少集（再多也没必要，徒增耗时） */
export const INTRO_DETECT_MAX_FILES = 60

/** 检测请求：一季的本地视频 */
export interface IntroDetectRequest {
  /** 标记 key（渲染层 skipKey），结果按它写回 */
  key: string
  /** 给人看的名字（进度提示用），例如「某剧 第 1 季」 */
  label: string
  /** 按集号排好的本地视频绝对路径 */
  files: string[]
}

/** 检测结果 */
export interface IntroDetectResult {
  key: string
  /** 正常结束（有没有检测到看 intro / outro）；false 时看 error / cancelled */
  success: boolean
  /** 片头区间（秒） */
  intro?: { start: number; end: number }
  /** 片尾长度（最后多少秒） */
  outro?: number
  /** 成功取到音频指纹的集数 */
  analyzed?: number
  /** 用的指纹算法 */
  method?: 'chromaprint' | 'pcm'
  cancelled?: boolean
  error?: string
}

/** 能不能检测 */
export interface IntroDetectStatus {
  available: boolean
  /** 不可用的原因（给人看） */
  reason?: string
  method?: 'chromaprint' | 'pcm'
}

/** 进度：排队中 / 进行中（done/total 步）/ 结束 */
export interface IntroDetectProgress {
  key: string
  label: string
  phase: 'queued' | 'running' | 'finished'
  done: number
  total: number
}

/** 入参校验：key / label 字符串，files 为 2–60 个绝对路径字符串（路径是否真实存在由主进程再查） */
function parseRequest(value: unknown): [IntroDetectRequest] {
  const raw = record<Partial<IntroDetectRequest>>(value, 'request')
  const files = Array.isArray(raw.files) ? raw.files : null
  if (
    !files ||
    files.length < 2 ||
    files.length > INTRO_DETECT_MAX_FILES ||
    files.some(f => typeof f !== 'string' || !f)
  )
    throw new ContractError(
      `参数 request.files 应为 2–${INTRO_DETECT_MAX_FILES} 个路径`
    )
  return [
    {
      key: str(raw.key, 'request.key'),
      label: str(raw.label ?? '', 'request.label'),
      files: files as string[],
    },
  ]
}

/**
 * 自动检测片头片尾：同一季多集本地文件，比对开头 / 结尾音频指纹找出共同片段。
 * 后台低优先级、一次一季、可取消；结果由渲染层写进片头片尾标记（手动标记优先）。
 */
export const introDetect = defineDomain(
  'introDetect',
  {
    /** ffmpeg 是否可用、用哪种指纹 */
    status: call<IntroDetectStatus>(),
    /** 检测一季（排队，结束时返回结果；同一 key 已在排队 / 进行时复用那一次） */
    detect: call<[request: IntroDetectRequest], IntroDetectResult>(a =>
      parseRequest(a[0])
    ),
    /** 取消某一季（排队中的直接移除） */
    cancel: call<[key: string], boolean>(a => [str(a[0], 'key')]),
  },
  {
    /** 进度变化时广播 */
    progress: event<IntroDetectProgress>(),
  }
)
