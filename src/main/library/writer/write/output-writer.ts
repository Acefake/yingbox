/**
 * 把计划好的一个 sidecar 写到磁盘：NFO 合并 / 覆盖、图片从原图缓存复制；内容未变跳过，
 * 写完（或确认磁盘内容已是我们要的）就更新 writer_outputs。
 *
 * 图片与 NFO 同样遵守写出模式：合并模式下不覆盖用户自己放的图片——
 * 文件不是我们写的，或我们写完之后被替换过（大小 / mtime 与记录不符），就保留原图。
 */
import { readFile, stat } from 'node:fs/promises'
import type { WriterSettings } from '../../../../shared/library/ipc'
import { composeNfo } from '../nfo/nfo-merge'
import { readIfExists, sha1, writeIfChanged } from '../fs/file-ops'
import type { WriterStore } from '../writer-store'
import type { PlannedOutput } from './output-plan'

/** 单个输出的结果。 */
export type OutputResult =
  | { status: 'written' }
  | { status: 'skipped'; reason: 'unchanged' | 'locked' | 'kept' }
  | { status: 'failed'; error: string }

/** 拿原图文件的接口（ImageCache.ensureFile）。 */
export interface ImageSource {
  ensureFile(url: string, signal?: AbortSignal): Promise<string | null>
}

/** 依赖。 */
export interface OutputWriterDeps {
  store: WriterStore
  images: ImageSource | undefined
  now?: () => number
}

const utf8 = new TextDecoder('utf-8', { fatal: true })
const gb18030 = new TextDecoder('gb18030')

/** 解码已有 NFO：先按 UTF-8，失败按 GB18030（国内旧工具常见）。 */
function decode(bytes: Buffer): string {
  try {
    return utf8.decode(bytes)
  } catch {
    return gb18030.decode(bytes)
  }
}

async function statOrNull(
  path: string
): Promise<{ size: number; mtime: number } | null> {
  try {
    const s = await stat(path)
    return { size: s.size, mtime: s.mtimeMs }
  } catch {
    return null
  }
}

/** sidecar 写出器。 */
export class OutputWriter {
  private readonly now: () => number

  constructor(private readonly deps: OutputWriterDeps) {
    this.now = deps.now ?? Date.now
  }

  /** 写一个输出；不抛出，失败以 failed 返回。 */
  async write(
    output: PlannedOutput,
    mode: WriterSettings['nfo']['mode'],
    signal?: AbortSignal
  ): Promise<OutputResult> {
    try {
      return output.kind === 'nfo'
        ? await this.writeNfo(output, mode)
        : await this.writeImage(output, mode, signal)
    } catch (error) {
      if (signal?.aborted) throw error
      return { status: 'failed', error: (error as Error).message }
    }
  }

  private async writeNfo(
    output: Extract<PlannedOutput, { kind: 'nfo' }>,
    mode: WriterSettings['nfo']['mode']
  ): Promise<OutputResult> {
    const existing = await readIfExists(output.path)
    const last = this.deps.store.output(output.path)
    const outcome = composeNfo(
      output.roots,
      existing ? decode(existing) : null,
      mode,
      last?.fields ?? null
    )
    if (outcome.kind === 'locked')
      return { status: 'skipped', reason: 'locked' }
    const result = await writeIfChanged(output.path, outcome.content, existing)
    this.deps.store.putOutput(
      output.path,
      output.itemId,
      'nfo',
      {
        hash: result.hash,
        size: result.size,
        mtime: result.mtime,
        fields: outcome.snapshot,
      },
      this.now()
    )
    return result.changed
      ? { status: 'written' }
      : { status: 'skipped', reason: 'unchanged' }
  }

  private async writeImage(
    output: Extract<PlannedOutput, { kind: 'image' }>,
    mode: WriterSettings['nfo']['mode'],
    signal?: AbortSignal
  ): Promise<OutputResult> {
    const source = this.deps.images
      ? await this.deps.images.ensureFile(output.url, signal)
      : null
    if (!source) return { status: 'failed', error: '图片下载失败' }
    const bytes = await readFile(source)
    const hash = sha1(bytes)
    const record = this.deps.store.output(output.path)
    const current = await statOrNull(output.path)
    const untouched =
      !!record &&
      !!current &&
      record.size === current.size &&
      record.mtime === current.mtime
    if (untouched && record!.hash === hash) {
      return { status: 'skipped', reason: 'unchanged' }
    }
    let existing: Buffer | null | undefined
    if (current && !untouched) {
      existing = await readIfExists(output.path)
      if (existing && sha1(existing) !== hash && mode === 'merge') {
        return { status: 'skipped', reason: 'kept' }
      }
    }
    const result = await writeIfChanged(output.path, bytes, existing)
    this.deps.store.putOutput(
      output.path,
      output.itemId,
      'image',
      { hash, size: result.size, mtime: result.mtime, fields: null },
      this.now()
    )
    return result.changed
      ? { status: 'written' }
      : { status: 'skipped', reason: 'unchanged' }
  }
}
