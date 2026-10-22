/**
 * 直链下载（mp4 等单文件）：流式写 .partial，断点按 HTTP Range 续传。
 *
 * 续传条件：`.partial.json` 记着同一地址（去掉查询串）的下载，且有 .partial。请求带
 * `Range: bytes=<已有>-`，服务器给过 ETag / Last-Modified 时再带 `If-Range`（文件变了服务器会
 * 回 200 整份）。服务器回 206 且 Content-Range 起点、总长对得上才追加；回 200（不支持 Range
 * 或文件已变）就截断从头写；416 且已有字节等于总长视为已下完。
 */
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import type { NetClient } from '../../shared/net/client'
import { type HlsOptions, type HlsProgress, isCompleteFile } from './hls'
import { DIRECT_META_SUFFIX, openForResume, urlIdentity } from './resume'

/** 按扩展名认作直链的媒体文件。 */
const DIRECT_EXT = /\.(mp4|m4v|mkv|webm|mov)$/i

/** 地址是否直链媒体文件（否则按 HLS 处理）；返回小写扩展名。 */
export function directExtension(url: string): string | undefined {
  try {
    return new URL(url).pathname.match(DIRECT_EXT)?.[1].toLowerCase()
  } catch {
    return undefined
  }
}

/** 续传校验信息（`.partial.json`）。 */
interface DirectMeta {
  v: 1
  id: string
  etag?: string
  lastModified?: string
  total?: number
}

/** 无数据超过这么久视为卡死，断开后按 Range 重连。 */
const STALL_MS = 60_000

/** 解析 `bytes 100-199/1000`。 */
export function parseContentRange(
  value: string | null
): { start: number; total?: number } | undefined {
  const m = value?.match(/^bytes (\d+)-\d+\/(\d+|\*)$/)
  if (!m) return undefined
  return { start: Number(m[1]), total: m[2] === '*' ? undefined : Number(m[2]) }
}

/**
 * 下载直链到 `outBase.<扩展名>`。网络出错按 retries 重试，每次从已写字节续上；
 * 失败或取消保留 .partial 与 .partial.json 供下次续传。
 */
export async function downloadDirect(
  net: NetClient,
  url: string,
  outBase: string,
  options: Omit<HlsOptions, 'concurrency'> = {}
): Promise<{ file: string }> {
  const ext = directExtension(url) ?? 'mp4'
  const file = `${outBase}.${ext}`
  const partial = `${file}.partial`
  const metaFile = partial + DIRECT_META_SUFFIX
  if (await isCompleteFile(file, partial)) return { file }

  const id = urlIdentity(url)
  const saved = await readFile(metaFile, 'utf-8')
    .then(t => JSON.parse(t) as DirectMeta)
    .catch(() => undefined)
  let meta = saved?.id === id ? saved : undefined
  const retries = options.retries ?? 3
  for (let attempt = 0; ; attempt++) {
    try {
      const done = await fetchOnce(net, url, partial, meta, options, next => {
        meta = next
        return writeFile(metaFile, JSON.stringify(next))
      })
      if (done) break
    } catch (error) {
      if (options.signal?.aborted || attempt >= retries) throw error
      await new Promise(r => setTimeout(r, 500 * 2 ** attempt))
    }
  }
  await rename(partial, file)
  await rm(metaFile, { force: true })
  return { file }
}

/**
 * 一次请求：续上或从头写到底。返回 true 表示文件已完整；
 * 返回 false 表示需要立即从头再来一次（416 但长度对不上）。
 */
async function fetchOnce(
  net: NetClient,
  url: string,
  partial: string,
  meta: DirectMeta | undefined,
  options: Omit<HlsOptions, 'concurrency'>,
  saveMeta: (meta: DirectMeta) => Promise<void>
): Promise<boolean> {
  const have = meta
    ? await stat(partial).then(
        s => s.size,
        () => 0
      )
    : 0
  const headers: Record<string, string> = {}
  if (options.referer) headers.Referer = options.referer
  if (have > 0 && meta) {
    headers.Range = `bytes=${have}-`
    const validator = meta.etag?.startsWith('W/')
      ? meta.lastModified
      : (meta.etag ?? meta.lastModified)
    if (validator) headers['If-Range'] = validator
  }
  const stall = new AbortController()
  const signal = options.signal
    ? AbortSignal.any([options.signal, stall.signal])
    : stall.signal
  const { response } = await net.open(url, {
    headers,
    signal,
    timeoutMs: 24 * 3600_000, // 整体不设限，卡死由 STALL_MS 判断
  })
  if (response.status === 416) {
    await response.body?.cancel().catch(() => {})
    if (meta?.total !== undefined && have === meta.total) return true
    await rm(partial, { force: true })
    return false
  }
  let start = 0
  if (response.status === 206 && have > 0) {
    const range = parseContentRange(response.headers.get('content-range'))
    const totalOk = !meta?.total || !range?.total || range.total === meta.total
    if (range?.start === have && totalOk) start = have
    else {
      await response.body?.cancel().catch(() => {})
      await rm(partial, { force: true })
      return false
    }
  } else if (response.status !== 200) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`HTTP ${response.status}`)
  }
  let current = meta
  if (start === 0) {
    // 从头写：先记下这份响应的校验信息，之后的续传都以它为准
    const length = Number(response.headers.get('content-length') || 0)
    current = {
      v: 1,
      id: urlIdentity(url),
      etag: response.headers.get('etag') ?? undefined,
      lastModified: response.headers.get('last-modified') ?? undefined,
      total: response.status === 200 && length > 0 ? length : undefined,
    }
    await saveMeta(current)
  }
  await streamTo(
    response,
    partial,
    start,
    current?.total,
    stall,
    options.onProgress
  )
  return true
}

/** 把响应体写到 partial 的 start 处；长时间无数据则中止（交给外层重试续传）。 */
async function streamTo(
  response: Response,
  partial: string,
  start: number,
  total: number | undefined,
  stall: AbortController,
  onProgress?: (p: HlsProgress) => void
): Promise<void> {
  const handle = await openForResume(partial)
  let position = start
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => stall.abort(new Error('下载卡住')), STALL_MS)
  }
  try {
    await handle.truncate(start)
    if (!response.body) throw new Error('响应没有内容')
    const reader = response.body.getReader()
    arm()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      arm()
      await handle.write(value, 0, value.byteLength, position)
      position += value.byteLength
      onProgress?.({ done: position, total, bytes: position })
    }
    if (total !== undefined && position !== total)
      throw new Error(`下载不完整：${position}/${total}`)
  } finally {
    clearTimeout(timer)
    await handle.close()
  }
}
