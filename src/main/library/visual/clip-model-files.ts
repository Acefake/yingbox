/**
 * 中文 CLIP 模型文件：放在 <片库数据目录>/models/<模型名>/，第一次用按画面搜时下载（约 190 MB）。
 *
 * - 来源依次试 huggingface.co 与国内镜像 hf-mirror.com，哪个通用哪个；
 * - 先写 .part，大小对得上再改名，半截文件不会被当成模型；
 * - 模型是 OFA-Sys/chinese-clip-vit-base-patch16 的 ONNX 量化版（Xenova 转换），图文共用一个模型文件。
 */
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** 模型描述。 */
export const CLIP_MODEL = {
  /** 本地目录名，也记在向量表里：换模型后旧向量作废。 */
  id: 'chinese-clip-vit-base-patch16-q8',
  repo: 'Xenova/chinese-clip-vit-base-patch16',
  files: {
    model: { path: 'onnx/model_quantized.onnx', bytes: 190_842_404 },
    tokenizer: { path: 'tokenizer.json', bytes: 0 },
  },
} as const

/** 下载源，按顺序尝试。 */
export const MODEL_HOSTS = ['https://huggingface.co', 'https://hf-mirror.com']

/** 下载用的 fetch 子集：要能拿到流式 body（标准 fetch / Electron net.fetch 都满足）。 */
export type DownloadFetch = (
  url: string,
  init: { signal?: AbortSignal; headers?: Record<string, string> }
) => Promise<{
  status: number
  body: ReadableStream<Uint8Array> | null
}>

/** 模型文件的本地路径。 */
export interface ClipModelPaths {
  dir: string
  model: string
  tokenizer: string
}

/** <modelsDir>/<模型名>/ 下的文件。 */
export function clipModelPaths(modelsDir: string): ClipModelPaths {
  const dir = join(modelsDir, CLIP_MODEL.id)
  return {
    dir,
    model: join(dir, 'model.onnx'),
    tokenizer: join(dir, 'tokenizer.json'),
  }
}

async function sizeOf(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size
  } catch {
    return null
  }
}

/** 模型是否已完整下载。 */
export async function clipModelReady(paths: ClipModelPaths): Promise<boolean> {
  const model = await sizeOf(paths.model)
  const tokenizer = await sizeOf(paths.tokenizer)
  return model === CLIP_MODEL.files.model.bytes && (tokenizer ?? 0) > 0
}

/** 下载一个文件到 target；expected 为 0 时不校验大小。onBytes 报告本文件已下载字节数。 */
async function downloadFile(
  fetch: DownloadFetch,
  path: string,
  target: string,
  expected: number,
  onBytes: (bytes: number) => void,
  signal?: AbortSignal
): Promise<void> {
  const existing = await sizeOf(target)
  if (existing !== null && (expected ? existing === expected : existing > 0))
    return onBytes(existing)
  await mkdir(dirname(target), { recursive: true })
  const part = `${target}.part`
  const errors: string[] = []
  for (const host of MODEL_HOSTS) {
    signal?.throwIfAborted()
    const url = `${host}/${CLIP_MODEL.repo}/resolve/main/${path}`
    try {
      const res = await fetch(url, { signal })
      if (res.status !== 200 || !res.body) throw new Error(`HTTP ${res.status}`)
      let received = 0
      const stream = Readable.fromWeb(
        res.body as Parameters<typeof Readable.fromWeb>[0]
      )
      stream.on('data', (chunk: Uint8Array) => {
        received += chunk.byteLength
        onBytes(received)
      })
      await pipeline(stream, createWriteStream(part), { signal })
      if (expected && received !== expected)
        throw new Error(`大小不对（${received} / ${expected}）`)
      await rename(part, target)
      return
    } catch (error) {
      await rm(part, { force: true })
      if (signal?.aborted) throw error
      errors.push(`${host}：${(error as Error).message}`)
    }
  }
  throw new Error(`模型下载失败：${errors.join('；')}`)
}

/** 下载缺的模型文件。onProgress 报告总进度（0–1）。 */
export async function downloadClipModel(
  fetch: DownloadFetch,
  paths: ClipModelPaths,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal
): Promise<void> {
  const { model, tokenizer } = CLIP_MODEL.files
  const noop = (): void => {}
  await downloadFile(fetch, tokenizer.path, paths.tokenizer, 0, noop, signal)
  await downloadFile(
    fetch,
    model.path,
    paths.model,
    model.bytes,
    bytes => onProgress(Math.min(1, bytes / model.bytes)),
    signal
  )
}
