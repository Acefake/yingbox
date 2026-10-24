/**
 * 两种识别器：本地 whisper.cpp（whisper-cli，不内置二进制，用户指定或在 PATH 里找）
 * 与云端 OpenAI 兼容 /audio/transcriptions（ai-core 的 speechConfig 与 Key）。
 * 进程、fetch、读文件都由调用方注入，测试可全部替换。
 */
import { isLocalEndpoint } from '../../shared/ai/providers'
import type { AiSpeechConfig } from '../ai/config'
import { AiError, httpError } from '../ai/errors'
import type { PipelineDeps } from './pipeline'
import { type ProcessRun, SpawnError } from './process-runner'
import {
  parseCloudTranscription,
  parseWhisperJson,
  parseWhisperProgress,
  whisperArgs,
} from './speech-rules'

type Recognize = PipelineDeps['recognize']

/** 本地 whisper.cpp 的依赖 */
export interface LocalWhisperDeps {
  /** whisper-cli 路径（或 PATH 上的命令名） */
  bin: string
  /** ggml 模型文件 */
  model: string
  threads?: number
  run: ProcessRun
  readText(path: string): Promise<string>
  exists(path: string): boolean
  remove(path: string): Promise<void>
}

/** 本地 whisper.cpp 识别器 */
export function createLocalRecognizer(deps: LocalWhisperDeps): Recognize {
  return async (wav, _chunk, options) => {
    if (!deps.model || !deps.exists(deps.model))
      throw new Error(
        '找不到 Whisper 模型文件：请在「设置 → AI → 语音识别」里指定 ggml 模型文件'
      )
    const outBase = wav.replace(/\.wav$/i, '')
    let result
    try {
      result = await deps.run(
        deps.bin,
        whisperArgs({
          model: deps.model,
          wav,
          outBase,
          language: options.language,
          threads: deps.threads,
        }),
        {
          signal: options.signal,
          onLine: line => {
            const percent = parseWhisperProgress(line)
            if (percent !== null) options.onProgress(percent)
          },
        }
      )
    } catch (error) {
      if (error instanceof SpawnError)
        throw new Error(
          '找不到 whisper-cli：请在「设置 → AI → 语音识别」里指定 whisper.cpp 可执行文件，或把 whisper-cli 加进 PATH'
        )
      throw error
    }
    if (result.code !== 0)
      throw new Error(
        `whisper-cli 退出码 ${result.code}：${result.tail.slice(-3).join(' / ')}`
      )
    const json = `${outBase}.json`
    try {
      return parseWhisperJson(await deps.readText(json))
    } finally {
      await deps.remove(json).catch(() => {})
    }
  }
}

/** 云端转写的依赖 */
export interface CloudSpeechDeps {
  config: AiSpeechConfig
  /** 来自私密板块 */
  isPrivate: boolean
  /** 设置「私密板块只用本地模型」 */
  privateLocalOnly: boolean
  fetch: (url: string, init: RequestInit) => Promise<Response>
  readFile(path: string): Promise<Uint8Array>
  /** 单段超时（毫秒） */
  timeoutMs?: number
}

/** 云端转写前的检查：地址、Key、私密 */
export function assertCloudSpeech(
  config: AiSpeechConfig,
  isPrivate: boolean,
  privateLocalOnly: boolean
): void {
  if (!config.baseUrl)
    throw new AiError('not_configured', '还没有填写转写接口地址')
  if (!config.model.trim())
    throw new AiError('not_configured', '还没有填写云端转写模型')
  const local = isLocalEndpoint(config.baseUrl)
  if (!local && !config.baseUrl.startsWith('https:'))
    throw new AiError('not_configured', '非本地的转写接口需要 https 地址')
  if (!local && !config.apiKey)
    throw new AiError('not_configured', '还没有填写 API Key')
  if (isPrivate && privateLocalOnly && !local)
    throw new AiError(
      'private_blocked',
      '私密板块的内容只发给本地模型，当前转写接口不是本地的'
    )
}

/** 云端转写识别器（verbose_json，按段给时间轴） */
export function createCloudRecognizer(deps: CloudSpeechDeps): Recognize {
  return async (wav, chunk, options) => {
    const { config } = deps
    assertCloudSpeech(config, deps.isPrivate, deps.privateLocalOnly)
    const audio = await deps.readFile(wav)
    const form = new FormData()
    form.append(
      'file',
      new Blob([audio as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }),
      'audio.wav'
    )
    form.append('model', config.model)
    form.append('response_format', 'verbose_json')
    form.append('timestamp_granularities[]', 'segment')
    if (options.language) form.append('language', options.language)

    const timeout = AbortSignal.timeout(deps.timeoutMs ?? 10 * 60_000)
    const signal = AbortSignal.any([options.signal, timeout])
    options.onProgress(10)
    let response: Response
    try {
      response = await deps.fetch(`${config.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: config.apiKey
          ? { Authorization: `Bearer ${config.apiKey}` }
          : {},
        body: form,
        signal,
      })
    } catch (error) {
      if (options.signal.aborted) throw error
      if (timeout.aborted) throw new AiError('timeout', '转写接口超时')
      throw new AiError('network', `转写接口连不上：${String(error)}`)
    }
    const text = await response.text()
    if (!response.ok)
      throw httpError(
        response.status,
        text,
        response.headers.get('retry-after')
      )
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      throw new AiError('bad_response', '转写接口返回的不是 JSON')
    }
    options.onProgress(100)
    return parseCloudTranscription(data, chunk.duration)
  }
}
