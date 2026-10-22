/**
 * 纯 wasm 的解码与缩放（@jsquash/jpeg、@jsquash/png、@jsquash/resize）：独立服务没有 nativeImage，
 * 缩略图管线用它们代替，没有原生依赖，x64 / arm64 的 NAS、Docker 镜像都能直接跑。
 * WebP 的编解码仍在 webp-codec.ts。只在编解码线程（webp-worker.ts）里调用，不占服务的事件循环。
 *
 * 和 webp-codec 一样：wasm 从包目录读出后手动编译，避免 emscripten / wasm-bindgen 胶水在 Node 里走 fetch。
 * @jsquash/resize 的入口依赖浏览器的 ImageData，这里直接调它的 wasm 绑定。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { loadWebpDecoder } from './webp-codec'

/** 解码后的 RGBA 像素。 */
export interface RgbaImage {
  rgba: Uint8Array
  width: number
  height: number
}

/** wasm 模块句柄（主进程 tsconfig 没有 WebAssembly 类型，按不透明值处理）。 */
type WasmModule = object
const wasmApi = (
  globalThis as unknown as {
    WebAssembly: { compile(bytes: Uint8Array): Promise<WasmModule> }
  }
).WebAssembly

/** 宽高上限：防止恶意图片头声明超大尺寸把内存撑爆（8K 海报足够）。 */
const MAX_PIXELS = 8192 * 8192

const compile = (file: string): Promise<WasmModule> =>
  wasmApi.compile(readFileSync(createRequire(__filename).resolve(file)))

/** 只加载一次；失败时清掉缓存，下次重试。 */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined
  return () => {
    pending ??= load()
    pending.catch(() => {
      pending = undefined
    })
    return pending
  }
}

type DecodedLike = { data: Uint8ClampedArray; width: number; height: number }

const toRgba = (image: DecodedLike): RgbaImage => ({
  rgba: new Uint8Array(
    image.data.buffer,
    image.data.byteOffset,
    image.data.byteLength
  ),
  width: image.width,
  height: image.height,
})

const jpegDecoder = once(async () => {
  const mod = (await import('@jsquash/jpeg/decode.js')) as unknown as {
    default: (buffer: ArrayBuffer) => Promise<DecodedLike>
    init: (module: WasmModule) => Promise<unknown>
  }
  await mod.init(await compile('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'))
  return mod.default
})

const pngDecoder = once(async () => {
  const mod = (await import('@jsquash/png/decode.js')) as unknown as {
    default: (buffer: ArrayBuffer) => Promise<DecodedLike>
    init: (module: WasmModule) => Promise<unknown>
  }
  await mod.init(await compile('@jsquash/png/codec/pkg/squoosh_png_bg.wasm'))
  return mod.default
})

const jpegEncoder = once(async () => {
  const mod = (await import('@jsquash/jpeg/encode.js')) as unknown as {
    default: (
      image: DecodedLike,
      options: { quality: number }
    ) => Promise<ArrayBuffer>
    init: (module: WasmModule) => Promise<unknown>
  }
  await mod.init(await compile('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm'))
  return mod.default
})

type WasmResize = (
  input: Uint8Array,
  inputWidth: number,
  inputHeight: number,
  outputWidth: number,
  outputHeight: number,
  method: number,
  premultiply: boolean,
  colorSpaceConversion: boolean
) => Uint8ClampedArray

const resizer = once(async () => {
  const mod =
    (await import('@jsquash/resize/lib/resize/pkg/squoosh_resize.js')) as unknown as {
      default: (module: WasmModule) => Promise<unknown>
      resize: WasmResize
    }
  await mod.default(
    await compile('@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm')
  )
  return mod.resize
})

/** 按文件头认格式。 */
export function sniffImage(bytes: Uint8Array): 'jpeg' | 'png' | 'webp' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) return 'png'
  const tag = (from: number): string =>
    String.fromCharCode(...bytes.subarray(from, from + 4))
  if (bytes.length >= 12 && tag(0) === 'RIFF' && tag(8) === 'WEBP')
    return 'webp'
  return null
}

/** 解码 JPEG / PNG / WebP；不认识的格式抛错。 */
export async function decodeImage(bytes: Uint8Array): Promise<RgbaImage> {
  const format = sniffImage(bytes)
  const buffer = bytes.slice().buffer as ArrayBuffer
  let image: RgbaImage
  if (format === 'jpeg') image = toRgba(await (await jpegDecoder())(buffer))
  else if (format === 'png') image = toRgba(await (await pngDecoder())(buffer))
  else if (format === 'webp') image = await (await loadWebpDecoder())(bytes)
  else throw new Error('不支持的图片格式')
  if (!image.width || !image.height || image.width * image.height > MAX_PIXELS)
    throw new Error('图片尺寸无效')
  return image
}

/** 按宽度等比缩小（原图更窄时原样返回，不放大）。三角滤波：缩略图里与 Lanczos 肉眼难分，快一倍多。 */
export async function resizeToWidth(
  image: RgbaImage,
  width: number
): Promise<RgbaImage> {
  if (image.width <= width) return image
  const height = Math.max(1, Math.round((image.height * width) / image.width))
  const out = (await resizer())(
    image.rgba,
    image.width,
    image.height,
    width,
    height,
    0,
    true,
    false
  )
  return {
    rgba: new Uint8Array(out.buffer, out.byteOffset, out.byteLength),
    width,
    height,
  }
}

/** 缩放到固定宽高（不保持比例；CLIP 输入就是这样拉伸的）。Catmull-Rom 滤波，接近 PIL 的双三次。 */
export async function resizeExact(
  image: RgbaImage,
  width: number,
  height: number
): Promise<RgbaImage> {
  const out = (await resizer())(
    image.rgba,
    image.width,
    image.height,
    width,
    height,
    1,
    true,
    false
  )
  return {
    rgba: new Uint8Array(out.buffer, out.byteOffset, out.byteLength),
    width,
    height,
  }
}

/** RGBA → JPEG（WebP 编码不可用时的兜底）。 */
export async function encodeJpeg(
  image: RgbaImage,
  quality: number
): Promise<Uint8Array> {
  const data = new Uint8ClampedArray(
    image.rgba.buffer,
    image.rgba.byteOffset,
    image.rgba.byteLength
  )
  const out = await (
    await jpegEncoder()
  )({ data, width: image.width, height: image.height }, { quality })
  return new Uint8Array(out)
}
