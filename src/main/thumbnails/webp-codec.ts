/**
 * WebP 编解码（libwebp wasm，@jsquash/webp）：无原生依赖，Node / Electron 主进程线程里都能跑。
 * 编码出缩略图；解码只用于 nativeImage 解不了的 WebP 原图（豆瓣等站点的封面）。
 *
 * wasm 从包目录读出后手动编译，避免 emscripten 胶水代码在 Node 里走 fetch 加载。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

/** 编码函数：RGBA 像素 → WebP 字节。 */
export type WebpEncode = (
  rgba: Uint8Array,
  width: number,
  height: number,
  quality: number
) => Promise<Uint8Array>

type JsquashEncode = (
  image: { data: Uint8ClampedArray; width: number; height: number },
  options: { quality: number; method: number }
) => Promise<ArrayBuffer>

/** wasm 模块句柄（主进程 tsconfig 没有 DOM / WebAssembly 类型，按不透明值处理）。 */
type WasmModule = object
const wasmApi = (
  globalThis as unknown as {
    WebAssembly: { compile(bytes: Uint8Array): Promise<WasmModule> }
  }
).WebAssembly

let loading: Promise<WebpEncode> | undefined

/** 加载（只加载一次）编码器。 */
export function loadWebpEncoder(): Promise<WebpEncode> {
  loading ??= (async () => {
    const mod = (await import('@jsquash/webp/encode.js')) as unknown as {
      default: JsquashEncode
      init: (module: WasmModule) => Promise<unknown>
    }
    const require = createRequire(__filename)
    // 支持 SIMD 的运行时（Electron 37 / Node 22 都支持）编译得过 SIMD 版，
    // 与 @jsquash/webp 内部的 SIMD 探测结论一致；编译失败退回普通版
    const load = (file: string): Promise<WasmModule> =>
      wasmApi.compile(
        readFileSync(require.resolve(`@jsquash/webp/codec/enc/${file}`))
      )
    const wasm = await load('webp_enc_simd.wasm').catch(() =>
      load('webp_enc.wasm')
    )
    await mod.init(wasm)
    return async (rgba, width, height, quality) => {
      const data = new Uint8ClampedArray(
        rgba.buffer,
        rgba.byteOffset,
        rgba.byteLength
      )
      // method 2：速度与体积的折中（默认 4 慢约 3 倍，体积只小约 15%）
      const out = await mod.default(
        { data, width, height },
        { quality, method: 2 }
      )
      return new Uint8Array(out)
    }
  })()
  loading.catch(() => {
    loading = undefined
  })
  return loading
}

/** 解码函数：WebP 字节 → RGBA 像素。 */
export type WebpDecode = (
  bytes: Uint8Array
) => Promise<{ rgba: Uint8Array; width: number; height: number }>

let decoding: Promise<WebpDecode> | undefined

/** 加载（只加载一次）解码器。 */
export function loadWebpDecoder(): Promise<WebpDecode> {
  decoding ??= (async () => {
    const mod = (await import('@jsquash/webp/decode.js')) as unknown as {
      default: (
        buffer: ArrayBuffer
      ) => Promise<{ data: Uint8ClampedArray; width: number; height: number }>
      init: (module: WasmModule) => Promise<unknown>
    }
    const require = createRequire(__filename)
    await mod.init(
      await wasmApi.compile(
        readFileSync(require.resolve('@jsquash/webp/codec/dec/webp_dec.wasm'))
      )
    )
    return async bytes => {
      const copy = bytes.slice().buffer as ArrayBuffer
      const image = await mod.default(copy)
      return {
        rgba: new Uint8Array(
          image.data.buffer,
          image.data.byteOffset,
          image.data.byteLength
        ),
        width: image.width,
        height: image.height,
      }
    }
  })()
  decoding.catch(() => {
    decoding = undefined
  })
  return decoding
}
