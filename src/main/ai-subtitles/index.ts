/**
 * 主进程 AI 字幕模块入口：组装任务队列（ffmpeg + Whisper + 大模型翻译）并注册 aiSubtitles 域 IPC。
 *
 * - 只处理本地文件（local:// 地址）；在线流不支持。
 * - ffmpeg / ffprobe 与 lada 共用探测（环境变量 → 用户覆盖 → PATH → 常见位置）。
 * - 识别：设置 ai.speech.engine = local-whisper（whisper-cli + ggml 模型）或 cloud（/audio/transcriptions）。
 * - 翻译：aiService().chatJson / chat，私密任务带 private。
 * - 其他主进程模块（前情提要等）用 {@link findAiSubtitle} / {@link readAiSubtitleCues} 读已生成的字幕。
 */
import { app, net } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseSrt } from '../../shared/ai-subtitles/srt'
import type {
  AiSubtitleCue,
  AiSubtitleJob,
  AiSubtitleMode,
  AiSubtitleRecord,
} from '../../shared/ai-subtitles/types'
import { aiSubtitles } from '../../shared/contract/ai-subtitles'
import { aiService } from '../ai'
import { assertPrivacy, assertUsable } from '../ai/config'
import { atomicWrite } from '../file-operations'
import { localUrlToFilePath } from '../local-media'
import { registerPlugin } from '../plugins/host'
import { ffprobeFor, ladaPaths } from '../plugins/lada/tools'
import { emit, implement } from '../rpc'
import { settingsStore } from '../settings'
import {
  cacheSubtitlePath,
  parseRecords,
  recordFor,
  siblingSubtitlePath,
  upsertRecord,
} from './output'
import { type PipelineDeps, runPipeline } from './pipeline'
import { SpawnError, runProcess } from './process-runner'
import { createAiSubtitleQueue } from './queue'
import { createCloudRecognizer, createLocalRecognizer } from './recognize'
import { extractArgs, ffprobeDurationArgs, parseDuration } from './speech-rules'

const root = (): string => join(app.getPath('userData'), 'ai-subtitles')
const indexFile = (): string => join(root(), 'index.json')

/** index.json 的读写串行，避免并发覆盖 */
let recordsChain: Promise<unknown> = Promise.resolve()

async function loadRecords(): Promise<AiSubtitleRecord[]> {
  const text = await fs.readFile(indexFile(), 'utf8').catch(() => null)
  return parseRecords(text)
}

function saveRecord(record: AiSubtitleRecord): Promise<void> {
  const next = recordsChain.then(async () => {
    const records = upsertRecord(await loadRecords(), record)
    await fs.mkdir(root(), { recursive: true })
    await atomicWrite(indexFile(), JSON.stringify(records, null, 2))
  })
  recordsChain = next.catch(() => {})
  return next
}

/** 这个视频已生成的 AI 字幕（文件已不在时为 null） */
export async function findAiSubtitle(
  videoPath: string
): Promise<AiSubtitleRecord | null> {
  const record = recordFor(await loadRecords(), videoPath)
  return record && existsSync(record.path) ? record : null
}

/**
 * 读这个视频的 AI 字幕（双语字幕每条为「中文\n原文」）；没有时为 null。
 * 前情提要按播放进度截断时用 shared/ai-subtitles/srt 的 cuesBefore。
 */
export async function readAiSubtitleCues(
  videoPath: string
): Promise<AiSubtitleCue[] | null> {
  const record = await findAiSubtitle(videoPath)
  if (!record) return null
  return parseSrt(await fs.readFile(record.path, 'utf8'))
}

/** 当前 ffmpeg；找不到时抛出可读的错误 */
function ffmpegPath(): string {
  const ffmpeg = ladaPaths().ffmpeg
  if (!ffmpeg)
    throw new Error(
      '找不到 ffmpeg：请安装 ffmpeg 并加入 PATH，或在 lada 设置里指定路径'
    )
  return ffmpeg
}

/** 读视频时长：ffprobe，失败再从 ffmpeg -i 的日志里取 */
async function probeDuration(
  videoPath: string,
  signal: AbortSignal
): Promise<number> {
  const ffmpeg = ffmpegPath()
  try {
    const probe = await runProcess(
      ffprobeFor(ffmpeg),
      ffprobeDurationArgs(videoPath),
      { signal }
    )
    const value = parseDuration(probe.tail.join('\n'))
    if (probe.code === 0 && value) return value
  } catch (error) {
    if (!(error instanceof SpawnError)) throw error
  }
  // ffmpeg -i 没有输出文件会以非 0 退出，只取日志里的 Duration 行
  let duration = 0
  await runProcess(ffmpeg, ['-hide_banner', '-i', videoPath], {
    signal,
    onLine: line => {
      if (!duration && line.includes('Duration:'))
        duration = parseDuration(line) ?? 0
    },
  })
  return duration
}

/** 按设置组装识别器 */
function recognizer(job: AiSubtitleJob): PipelineDeps['recognize'] {
  const store = settingsStore()
  const speech = aiService().speechConfig()
  if (speech.engine === 'local-whisper')
    return createLocalRecognizer({
      bin: store.get('ai.speech.whisperBin') || 'whisper-cli',
      model:
        store.get('ai.speech.whisperModelPath') ||
        join(
          app.getPath('userData'),
          'ai',
          'whisper',
          `ggml-${speech.model}.bin`
        ),
      threads: Math.max(1, availableParallelism() - 1),
      run: runProcess,
      readText: path => fs.readFile(path, 'utf8'),
      exists: existsSync,
      remove: path => fs.rm(path, { force: true }),
    })
  if (speech.engine === 'cloud')
    return createCloudRecognizer({
      config: speech,
      isPrivate: job.private,
      privateLocalOnly: store.get('ai.privateLocalOnly'),
      fetch: (url, init) => net.fetch(url, { ...init, credentials: 'omit' }),
      readFile: path => fs.readFile(path),
    })
  throw new Error('语音识别已关闭：请在「设置 → AI → 语音识别」里选择识别方式')
}

/** 写 SRT：视频旁边可写就写旁边，否则写字幕缓存 */
async function writeSubtitle(
  videoPath: string,
  mode: AiSubtitleMode,
  language: string,
  srt: string
): Promise<string> {
  const previous = recordFor(await loadRecords(), videoPath)
  const sibling = siblingSubtitlePath(
    videoPath,
    mode,
    language,
    path => existsSync(path) && path !== previous?.path
  )
  let path = sibling
  try {
    await atomicWrite(sibling, srt)
  } catch {
    path = cacheSubtitlePath(join(root(), 'cache'), videoPath, mode)
    await fs.mkdir(dirname(path), { recursive: true })
    await atomicWrite(path, srt)
  }
  await saveRecord({ videoPath, path, mode, language, updatedAt: Date.now() })
  return path
}

/** 一个任务的流程依赖 */
function pipelineDeps(job: AiSubtitleJob, signal: AbortSignal): PipelineDeps {
  const service = aiService()
  const base = {
    private: job.private,
    temperature: 0.3,
    timeoutMs: 180_000,
  }
  return {
    probeDuration,
    makeTempDir: () => fs.mkdtemp(join(tmpdir(), 'yingbox-aisub-')),
    removeTempDir: dir => fs.rm(dir, { recursive: true, force: true }),
    extract: async (videoPath, chunk, wav, abort) => {
      const result = await runProcess(
        ffmpegPath(),
        extractArgs(videoPath, chunk, wav),
        { signal: abort }
      )
      if (result.code !== 0 || !existsSync(wav))
        throw new Error(
          `ffmpeg 抽取音频失败：${result.tail.slice(-2).join(' / ') || result.code}`
        )
    },
    recognize: recognizer(job),
    checkTranslate: () => {
      const config = service.config()
      assertUsable(config)
      assertPrivacy(
        config,
        job.private,
        settingsStore().get('ai.privateLocalOnly')
      )
    },
    translate: {
      json: async (messages, schema) =>
        (
          await service.chatJson(
            { ...base, messages, schema, schemaName: 'subtitles' },
            { signal }
          )
        ).data,
      text: async messages =>
        (await service.chat({ ...base, messages }, { signal })).content,
    },
    write: writeSubtitle,
    warn: message => console.warn('[ai-subtitles]', message),
  }
}

/** 注册 aiSubtitles 域（registerAi 之后调用一次） */
export function registerAiSubtitles(): void {
  const queue = createAiSubtitleQueue({
    emit: job => emit(aiSubtitles, 'changed', job),
    run: async (job, { signal, onProgress }) => {
      const result = await runPipeline(
        {
          videoPath: job.videoPath,
          mode: job.mode,
          title: job.title,
          language: job.language || undefined,
        },
        pipelineDeps(job, signal),
        { signal, onProgress }
      )
      return { outputPath: result.outputPath, language: result.language }
    },
  })

  registerPlugin({
    id: 'ai-subtitles',
    stop: async () => {
      queue.cancelAll()
      await queue.idle()
    },
    health: () => ({
      running: queue
        .list()
        .some(
          job => job.phase === 'recognizing' || job.phase === 'translating'
        ),
    }),
  })

  implement(aiSubtitles, {
    start: async (_, localUrl, options) => {
      const videoPath = localUrlToFilePath(localUrl)
      if (!videoPath)
        throw new Error('AI 字幕只支持本地视频文件，在线播放暂不支持')
      if (!existsSync(videoPath)) throw new Error('视频文件不存在')
      return queue.add(localUrl, videoPath, options)
    },
    cancel: (_, jobId) => queue.cancel(jobId),
    list: () => queue.list(),
    find: async (_, localUrl) => {
      const videoPath = localUrlToFilePath(localUrl)
      return videoPath ? findAiSubtitle(videoPath) : null
    },
  })
}
