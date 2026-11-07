import { randomUUID } from 'node:crypto'
import { posix, win32 } from 'node:path'
import type {
  StorageMount,
  StorageMountInput,
} from '../../shared/contract/storage'

/** 持久化文件接口，写入者应保证原子替换。 */
export interface MountFileIo {
  read(): Promise<string | null>
  write(text: string): Promise<void>
}

/** Windows 限定普通 UNC 共享；其他系统接受已挂载目录的绝对路径。 */
export function normalizeMountPath(path: string, platform: string): string {
  const input = path.trim()
  if (input.includes('\0') || input.length > 4096)
    throw new Error('共享路径无效')
  if (platform === 'win32') {
    if (
      !/^\\\\(?![?.]\\)[^\\/:?*"<>|]+\\(?!\.{1,2}(?:\\|$))[^\\/:?*"<>|]+(?:\\|$)/.test(
        input
      )
    ) {
      throw new Error('请填写网络共享路径，例如 \\\\NAS\\Movies')
    }
    return win32.normalize(input).replace(/\\+$/, '')
  }
  if (!posix.isAbsolute(input) || input === '/')
    throw new Error('请选择已挂载的共享目录')
  return posix.normalize(input).replace(/\/+$/, '')
}

/** 共享目录记录；变更串行写盘，验证和写入失败不影响原文件。 */
export class MountStore {
  private pending: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly io: MountFileIo,
    private readonly readable: (path: string) => Promise<void>,
    private readonly platform: string
  ) {}

  /** 读取持久化连接，损坏的文件报错而不覆盖。 */
  async list(): Promise<StorageMount[]> {
    const text = await this.io.read()
    if (!text) return []
    const data: unknown = JSON.parse(text)
    if (
      !Array.isArray(data) ||
      !data.every(
        item =>
          item &&
          typeof item.id === 'string' &&
          typeof item.name === 'string' &&
          typeof item.path === 'string'
      )
    )
      throw new Error('存储配置损坏，请检查 storage-mounts.json')
    return data.map(item => ({
      id: item.id,
      name: item.name,
      path: normalizeMountPath(item.path, this.platform),
    }))
  }

  /** 检查路径后保存；同路径共享更新已有连接，不重复添加。 */
  save(input: StorageMountInput): Promise<StorageMount> {
    return this.change(async () => {
      const path = normalizeMountPath(input.path, this.platform)
      await this.readable(path)
      const entries = await this.list()
      const existing = input.id
        ? entries.find(item => item.id === input.id)
        : entries.find(item => this.key(item.path) === this.key(path))
      if (input.id && !existing) throw new Error('这个存储已经被移除')
      if (
        entries.some(
          item =>
            item.id !== existing?.id && this.key(item.path) === this.key(path)
        )
      )
        throw new Error('这个共享已经添加')
      const next = {
        id: existing?.id ?? randomUUID(),
        name:
          input.name.trim() ||
          (this.platform === 'win32' ? win32 : posix).basename(path),
        path,
      }
      await this.io.write(
        JSON.stringify(
          existing
            ? entries.map(item => (item.id === next.id ? next : item))
            : [...entries, next],
          null,
          2
        )
      )
      return next
    })
  }

  /** 仅删除连接配置，不删除共享文件。 */
  remove(id: string): Promise<void> {
    return this.change(async () => {
      const entries = await this.list()
      await this.io.write(
        JSON.stringify(
          entries.filter(item => item.id !== id),
          null,
          2
        )
      )
    })
  }

  /** 只检查已保存目录，不能借此访问任意渲染层路径。 */
  async check(id: string): Promise<void> {
    const entry = (await this.list()).find(item => item.id === id)
    if (!entry) throw new Error('这个存储已经被移除')
    await this.readable(entry.path)
  }

  private key(path: string): string {
    return this.platform === 'win32' ? path.toLowerCase() : path
  }

  private change<T>(action: () => Promise<T>): Promise<T> {
    const next = this.pending.then(action, action)
    this.pending = next.catch(() => {})
    return next
  }
}
