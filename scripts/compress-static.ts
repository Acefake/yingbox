/**
 * 构建结束后给网页产物补 .br / .gz。
 * 独立服务按 Accept-Encoding 直接发这些文件，不再在请求里现压。
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { promisify } from 'node:util'
import { brotliCompress, constants, gzip } from 'node:zlib'

const brotli = promisify(brotliCompress)
const gzipFile = promisify(gzip)

/** 文本和 wasm 值得压；图片、字体本身已经压过。 */
const COMPRESSIBLE = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.map',
  '.mjs',
  '.svg',
  '.txt',
  '.wasm',
  '.webmanifest',
  '.xml',
])

export interface CompressResult {
  br: number
  gz: number
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(full)))
    else if (entry.isFile()) files.push(full)
  }
  return files
}

/** 遍历目录，只在压缩后更小的时候写出同名 .br / .gz。 */
export async function compressStaticDir(dir: string): Promise<CompressResult> {
  const result: CompressResult = { br: 0, gz: 0 }
  for (const file of await walk(dir)) {
    if (!COMPRESSIBLE.has(extname(file).toLowerCase())) continue
    const data = await readFile(file)
    const gz = await gzipFile(data, { level: 9 })
    const br = await brotli(data, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    })
    if (gz.length < data.length) {
      await writeFile(`${file}.gz`, gz)
      result.gz += 1
    }
    if (br.length < data.length) {
      await writeFile(`${file}.br`, br)
      result.br += 1
    }
  }
  return result
}
