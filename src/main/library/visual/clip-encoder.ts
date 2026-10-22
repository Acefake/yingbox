/**
 * 中文 CLIP 推理（onnxruntime-node）：图片 → 512 维向量、文字 → 512 维向量，都已归一化，点积即余弦相似度。
 *
 * - 运行时按需加载：onnxruntime-node 是原生模块，缺了（如某些 NAS 架构）只是按画面搜不可用，不影响片库；
 *   不用 onnxruntime-web：同一模型在 Node 里的 wasm 后端实测慢 6 倍左右；
 * - 模型是图文合一的 ONNX：只算图片时喂一个最短的占位文本，只算文字时喂一张全零图，
 *   占位那一侧开销很小（文字侧）或可接受（一次查询多算一张图，约 0.1 秒）；
 * - 推理在 onnxruntime 自己的线程池里跑，不占引擎事件循环；线程数限制为一半核数，给界面和其他任务留余量。
 */
import { availableParallelism } from 'node:os'

/** 向量维度。 */
export const CLIP_DIM = 512
/** 输入图片边长。 */
export const CLIP_IMAGE_SIZE = 224

const MEAN = [0.48145466, 0.4578275, 0.40821073] as const
const STD = [0.26862954, 0.26130258, 0.27577711] as const
const PIXELS = CLIP_IMAGE_SIZE * CLIP_IMAGE_SIZE

/** 224×224 RGBA → 归一化的 CHW float32（模型输入），写进 out。 */
export function normalizePixels(
  rgba: Uint8Array,
  out: Float32Array = new Float32Array(3 * PIXELS)
): Float32Array {
  if (rgba.length !== PIXELS * 4) throw new Error('像素尺寸不对')
  for (let c = 0; c < 3; c++) {
    const mean = MEAN[c]!
    const std = STD[c]!
    const base = c * PIXELS
    for (let i = 0; i < PIXELS; i++) {
      out[base + i] = (rgba[i * 4 + c]! / 255 - mean) / std
    }
  }
  return out
}

/** 图文编码器。 */
export interface ClipEncoder {
  /** 一批 224×224 RGBA → 每张一个归一化向量。 */
  embedImages(images: Uint8Array[]): Promise<Float32Array[]>
  /** 一句话的 token id → 归一化向量。 */
  embedText(ids: number[]): Promise<Float32Array>
  close(): Promise<void>
}

/** onnxruntime-node 里用到的部分。 */
interface OrtTensor {
  data: unknown
  dims: readonly number[]
}
type OrtSession = {
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>
  release(): Promise<void>
}
export interface OrtModule {
  Tensor: new (type: string, data: unknown, dims: number[]) => OrtTensor
  InferenceSession: {
    create(path: string, options: Record<string, unknown>): Promise<OrtSession>
  }
}

/** 加载推理运行时；装不上（缺原生模块、架构不支持）返回 null。 */
export async function loadOrt(): Promise<OrtModule | null> {
  try {
    return (await import('onnxruntime-node')) as unknown as OrtModule
  } catch {
    return null
  }
}

/** 拆出每行的向量并归一化（防模型输出没归一化）。 */
function rows(tensor: OrtTensor | undefined, count: number): Float32Array[] {
  if (!tensor) throw new Error('模型输出缺少向量')
  const data = tensor.data as Float32Array
  return Array.from({ length: count }, (_, i) => {
    const v = data.slice(i * CLIP_DIM, (i + 1) * CLIP_DIM)
    let norm = 0
    for (const x of v) norm += x * x
    norm = Math.sqrt(norm) || 1
    for (let j = 0; j < v.length; j++) v[j] = v[j]! / norm
    return v
  })
}

/** 用模型文件构造编码器。 */
export async function createClipEncoder(
  ort: OrtModule,
  modelPath: string
): Promise<ClipEncoder> {
  const threads = Math.max(1, Math.floor(availableParallelism() / 2))
  const session = await ort.InferenceSession.create(modelPath, {
    intraOpNumThreads: threads,
    interOpNumThreads: 1,
    graphOptimizationLevel: 'all',
  })
  const ints = (list: number[]): OrtTensor =>
    new ort.Tensor('int64', BigInt64Array.from(list.map(BigInt)), [
      1,
      list.length,
    ])
  const ones = (n: number): OrtTensor =>
    ints(Array.from({ length: n }, () => 1))
  // 占位文本 [CLS] [SEP] 与占位图（全零）
  const stubText = { input_ids: ints([101, 102]), attention_mask: ones(2) }
  const stubImage = new ort.Tensor('float32', new Float32Array(3 * PIXELS), [
    1,
    3,
    CLIP_IMAGE_SIZE,
    CLIP_IMAGE_SIZE,
  ])

  return {
    async embedImages(images) {
      if (!images.length) return []
      const size = 3 * PIXELS
      const batch = new Float32Array(images.length * size)
      images.forEach((rgba, i) =>
        normalizePixels(rgba, batch.subarray(i * size, (i + 1) * size))
      )
      const out = await session.run({
        ...stubText,
        pixel_values: new ort.Tensor('float32', batch, [
          images.length,
          3,
          CLIP_IMAGE_SIZE,
          CLIP_IMAGE_SIZE,
        ]),
      })
      return rows(out.image_embeds, images.length)
    },
    async embedText(tokens) {
      const out = await session.run({
        input_ids: ints(tokens),
        attention_mask: ones(tokens.length),
        pixel_values: stubImage,
      })
      return rows(out.text_embeds, 1)[0]!
    },
    close: () => session.release(),
  }
}
