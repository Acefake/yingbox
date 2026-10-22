/**
 * 按画面搜的推理后端：把运行时加载、模型下载、分词、编码器生命周期收在一起，模块只看 VisualBackend。
 *
 * 编码器（约 400 MB 内存）第一次用时才建，闲置 3 分钟释放；释放后下次再用重新加载（约 1 秒）。
 * 单测注入假的 VisualBackend，不碰原生模块和网络。
 */
import { readFile } from 'node:fs/promises'
import { ClipTokenizer } from './clip-tokenizer'
import {
  type ClipEncoder,
  type OrtModule,
  createClipEncoder,
  loadOrt,
} from './clip-encoder'
import {
  CLIP_MODEL,
  type DownloadFetch,
  clipModelPaths,
  clipModelReady,
  downloadClipModel,
} from './clip-model-files'

/** 闲置多久释放编码器。 */
const IDLE_MS = 3 * 60_000

/** 推理后端。 */
export interface VisualBackend {
  /** 模型标识（记在索引里，换模型就重建）。 */
  readonly model: string
  /** 推理运行时能否加载。 */
  available(): Promise<boolean>
  /** 模型文件是否齐全。 */
  modelReady(): Promise<boolean>
  /** 下载模型（已有的文件跳过）。 */
  download(onProgress: (f: number) => void, signal?: AbortSignal): Promise<void>
  /** 224×224 RGBA → 归一化向量。 */
  embedImages(images: Uint8Array[]): Promise<Float32Array[]>
  /** 文字 → 归一化向量。 */
  embedText(text: string): Promise<Float32Array>
}

/** 默认后端：onnxruntime-node + 下载到 modelsDir 的中文 CLIP。 */
export function createClipBackend(options: {
  modelsDir: string
  fetch: DownloadFetch
  loadRuntime?: () => Promise<OrtModule | null>
}): VisualBackend {
  const paths = clipModelPaths(options.modelsDir)
  let runtime: Promise<OrtModule | null> | undefined
  let encoder: Promise<ClipEncoder> | undefined
  let tokenizer: Promise<ClipTokenizer> | undefined
  let idle: ReturnType<typeof setTimeout> | undefined

  const ort = (): Promise<OrtModule | null> =>
    (runtime ??= (options.loadRuntime ?? loadOrt)())

  /** 拿编码器并重置闲置计时；加载失败清掉缓存，下次重试。 */
  async function useEncoder(): Promise<ClipEncoder> {
    clearTimeout(idle)
    encoder ??= (async () => {
      const mod = await ort()
      if (!mod) throw new Error('推理组件不可用')
      return createClipEncoder(mod, paths.model)
    })()
    encoder.catch(() => (encoder = undefined))
    const ready = await encoder
    idle = setTimeout(() => {
      const current = encoder
      encoder = undefined
      void current?.then(e => e.close()).catch(() => {})
    }, IDLE_MS)
    idle.unref?.()
    return ready
  }

  return {
    model: CLIP_MODEL.id,
    available: async () => (await ort()) !== null,
    modelReady: () => clipModelReady(paths),
    download: (onProgress, signal) =>
      downloadClipModel(options.fetch, paths, onProgress, signal),
    embedImages: async images => (await useEncoder()).embedImages(images),
    async embedText(text) {
      tokenizer ??= readFile(paths.tokenizer, 'utf8').then(
        ClipTokenizer.fromJson
      )
      tokenizer.catch(() => (tokenizer = undefined))
      const ids = (await tokenizer).encode(text)
      return (await useEncoder()).embedText(ids)
    },
  }
}
