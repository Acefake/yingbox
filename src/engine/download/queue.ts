/**
 * 下载队列：单工作者串行下载，状态持久化为 JSON（写临时文件再改名，原子写）。
 *
 * 取代 Go 的 download_queue.txt + work 标记 + Python downloaded.db。重启后进行中的任务
 * 回到队首，由 runner 从磁盘上的 .partial 断点续传。真正的下载由注入的 runner 完成，队列本身只管状态机，便于单测。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  AddResult,
  DownloadSnapshot,
  DownloadTask,
} from '../../shared/contract/download'

/** 番号规则：字母数字、- 与 _，最长 80（与原 Go validVideoID 一致）。 */
export function normalizeCode(raw: string): string | undefined {
  const code = raw.trim().toUpperCase()
  return /^[A-Z0-9_-]{1,80}$/.test(code) ? code : undefined
}

/** 一次下载的执行者：返回完成的文件与站点；出错抛异常；signal 中止时尽快退出。 */
export type DownloadRunner = (
  code: string,
  report: (progress: NonNullable<DownloadTask['progress']>) => void,
  signal: AbortSignal
) => Promise<{ file: string; site: string }>

/** 队列依赖。 */
export interface QueueDeps {
  /** 持久化文件路径 */
  file: string
  run: DownloadRunner
  /** 任务被移除（未完成的）时丢弃其续传临时文件；进行中的任务在下载停下后才调用 */
  discard?: (code: string) => Promise<void>
  /** 快照变化时调用（调用方负责节流） */
  onChange: (snapshot: DownloadSnapshot) => void
  now?: () => number
  /** 队列上限，默认 1000 */
  limit?: number
  /** 完成记录保留条数，默认 200 */
  keepDone?: number
}

/** 下载队列。 */
export class DownloadQueue {
  private tasks: DownloadTask[] = []
  private running = false
  private abort: AbortController | undefined
  private saving: Promise<void> = Promise.resolve()
  private readonly now: () => number

  constructor(private readonly deps: QueueDeps) {
    this.now = deps.now ?? Date.now
  }

  /** 读盘恢复；进行中的任务回到队首。 */
  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.deps.file, 'utf-8')) as {
        tasks?: DownloadTask[]
      }
      this.tasks = (raw.tasks ?? []).map(t =>
        t.status === 'active'
          ? { ...t, status: 'queued', progress: undefined }
          : t
      )
      this.tasks.sort(
        (a, b) => Number(b.status === 'queued') - Number(a.status === 'queued')
      )
    } catch {
      this.tasks = []
    }
    this.pump()
  }

  /** 当前快照。 */
  snapshot(): DownloadSnapshot {
    const by = (status: DownloadTask['status']): DownloadTask[] =>
      this.tasks.filter(t => t.status === status)
    return {
      active: by('active')[0],
      queued: by('queued'),
      completed: by('done').sort((a, b) => b.updatedAt - a.updatedAt),
      failed: by('failed'),
    }
  }

  /** 加入队列。 */
  add(raw: string): AddResult {
    const id = normalizeCode(raw)
    if (!id) return { added: false, reason: 'invalid' }
    const existing = this.tasks.find(t => t.id === id)
    if (existing?.status === 'done') return { added: false, reason: 'exists' }
    if (existing && existing.status !== 'failed')
      return { added: false, reason: 'queued' }
    if (
      this.tasks.filter(t => t.status === 'queued').length >=
      (this.deps.limit ?? 1000)
    )
      return { added: false, reason: 'full' }
    this.tasks = this.tasks.filter(t => t.id !== id)
    this.tasks.push({ id, status: 'queued', updatedAt: this.now() })
    this.changed()
    this.pump()
    return { added: true }
  }

  /** 失败任务重新排队。 */
  retry(raw: string): AddResult {
    return this.add(raw)
  }

  /** 移除任务；进行中的会被取消。 */
  remove(raw: string): void {
    const id = normalizeCode(raw)
    if (!id) return
    const task = this.tasks.find(t => t.id === id)
    if (!task) return
    if (task.status === 'active') this.abort?.abort()
    // 进行中的要等 runner 停下、文件句柄关掉再删（Windows 删不掉打开的文件），见 pump
    else if (task.status !== 'done') this.discard(id)
    this.tasks = this.tasks.filter(t => t.id !== id)
    this.changed()
  }

  private discard(id: string): void {
    this.deps
      .discard?.(id)
      .catch(error => console.error('[download] 清理临时文件失败', error))
  }

  /** 等待所有待写的持久化完成（测试与退出用）。 */
  flush(): Promise<void> {
    return this.saving
  }

  /** 停止当前下载（退出时）。 */
  stop(): void {
    this.abort?.abort()
  }

  private changed(): void {
    const snapshot = this.snapshot()
    const keep = this.deps.keepDone ?? 200
    const done = snapshot.completed.slice(keep).map(t => t.id)
    if (done.length) this.tasks = this.tasks.filter(t => !done.includes(t.id))
    const body = JSON.stringify({ tasks: this.tasks })
    const file = this.deps.file
    this.saving = this.saving
      .then(async () => {
        await mkdir(dirname(file), { recursive: true })
        const tmp = `${file}.${process.pid}.tmp`
        await writeFile(tmp, body, 'utf-8')
        await rename(tmp, file)
      })
      .catch(error => console.error('[download] 队列保存失败', error))
    this.deps.onChange(this.snapshot())
  }

  private update(id: string, patch: Partial<DownloadTask>): void {
    this.tasks = this.tasks.map(t =>
      t.id === id ? { ...t, ...patch, updatedAt: this.now() } : t
    )
    this.changed()
  }

  private pump(): void {
    if (this.running) return
    const next = this.tasks.find(t => t.status === 'queued')
    if (!next) return
    this.running = true
    const controller = new AbortController()
    this.abort = controller
    this.update(next.id, { status: 'active', error: undefined })
    this.deps
      .run(
        next.id,
        progress => this.update(next.id, { progress }),
        controller.signal
      )
      .then(
        ({ file, site }) =>
          this.update(next.id, {
            status: 'done',
            file,
            site,
            progress: undefined,
          }),
        (error: unknown) => {
          if (!controller.signal.aborted)
            this.update(next.id, {
              status: 'failed',
              error: error instanceof Error ? error.message : String(error),
            })
        }
      )
      .finally(() => {
        this.running = false
        this.abort = undefined
        if (!this.tasks.some(t => t.id === next.id)) this.discard(next.id)
        this.pump()
      })
  }
}
