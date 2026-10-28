/**
 * WebDAV / Alist 源的存储：`userData/webdav-sources.json`。
 *
 * 地址、用户名明文存；密码经 SecretCodec（Electron safeStorage：DPAPI / Keychain / libsecret）加密，
 * 文件里只有密文，明文只在主进程内存里出现、只交给媒体库引擎与播放代理。
 * 系统密钥存储不可用时（如 Linux 没有密钥环）拒绝保存密码，不退回明文。
 */
import { randomBytes } from 'node:crypto'
import type {
  WebDavSourceInfo,
  WebDavSourceInput,
} from '../../shared/contract/webdav'
import { type DavAccess, validDavUrl } from '../../shared/webdav/client'
import { SOURCE_ID_RE } from '../../shared/webdav/remote-path'
import type { SecretCodec } from '../settings/secrets'

/** 落盘的一条源。 */
interface StoredSource {
  id: string
  name: string
  url: string
  username: string
  /** 密码密文（base64）；没有密码为空串。 */
  password: string
}

/** 文件读写（测试注入内存实现）。 */
export interface SourceFileIo {
  read(): Promise<string | null>
  write(text: string): Promise<void>
}

/** 规范源地址：去首尾空白、去结尾斜杠。 */
export function normalizeSourceUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** 没填名字时用地址的主机名。 */
function defaultName(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return 'WebDAV'
  }
}

/** 解析文件内容：逐项校验，坏项丢掉。 */
function parseSources(text: string | null): StoredSource[] {
  if (!text) return []
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  const list = (raw as { sources?: unknown })?.sources
  if (!Array.isArray(list)) return []
  return list.flatMap((item): StoredSource[] => {
    const s = item as Partial<StoredSource>
    if (
      typeof s?.id !== 'string' ||
      !SOURCE_ID_RE.test(s.id) ||
      typeof s.url !== 'string' ||
      !validDavUrl(s.url)
    )
      return []
    return [
      {
        id: s.id,
        name:
          typeof s.name === 'string' && s.name ? s.name : defaultName(s.url),
        url: s.url,
        username: typeof s.username === 'string' ? s.username : '',
        password: typeof s.password === 'string' ? s.password : '',
      },
    ]
  })
}

const toInfo = (s: StoredSource): WebDavSourceInfo => ({
  id: s.id,
  name: s.name,
  url: s.url,
  username: s.username,
  hasPassword: Boolean(s.password),
})

function checkPasswordReuse(
  saved: StoredSource | undefined,
  input: WebDavSourceInput,
  url: string
): void {
  if (
    saved?.password &&
    !input.password &&
    (new URL(saved.url).origin !== new URL(url).origin ||
      saved.username !== input.username.trim())
  )
    throw new Error('连接地址或用户名已变更，请重新输入密码')
}

/** 源存储。 */
export class WebDavSourceStore {
  private sources: StoredSource[] | null = null
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly io: SourceFileIo,
    private readonly codec: SecretCodec
  ) {}

  /** 全部源（渲染层视图）。 */
  async list(): Promise<WebDavSourceInfo[]> {
    return (await this.load()).map(toInfo)
  }

  /** 某个源的连接信息（含明文密码）；不存在返回 null。 */
  async access(id: string): Promise<DavAccess | null> {
    const found = (await this.load()).find(s => s.id === id)
    return found ? this.toAccess(found) : null
  }

  /**
   * 表单值对应的连接信息（测试连接用）：没填密码且有 id 时用已保存的密码。
   * 地址不合法时抛错。
   */
  async accessFor(input: WebDavSourceInput): Promise<DavAccess> {
    const url = normalizeSourceUrl(input.url)
    if (!validDavUrl(url)) throw new Error('地址要以 http:// 或 https:// 开头')
    let password = input.password ?? ''
    if (!password && input.id) {
      const saved = (await this.load()).find(s => s.id === input.id)
      checkPasswordReuse(saved, input, url)
      if (saved) password = this.toAccess(saved).password
    }
    return { url, username: input.username.trim(), password }
  }

  /** 新建或修改源。 */
  async save(input: WebDavSourceInput): Promise<WebDavSourceInfo> {
    const sources = await this.load()
    const url = normalizeSourceUrl(input.url)
    if (!validDavUrl(url))
      throw new Error(
        '地址要以 http:// 或 https:// 开头，且不能带查询参数或账号'
      )
    const existing = input.id ? sources.find(s => s.id === input.id) : undefined
    if (input.id && !existing) throw new Error('这个源已经被删除')
    checkPasswordReuse(existing, input, url)
    let password = existing?.password ?? ''
    if (input.password) {
      if (!this.codec.available())
        throw new Error('系统密钥存储不可用，无法安全保存密码')
      password = this.codec.encrypt(input.password)
    }
    const next: StoredSource = {
      id: existing?.id ?? this.newId(sources),
      name: input.name.trim() || defaultName(url),
      url,
      username: input.username.trim(),
      password,
    }
    this.sources = existing
      ? sources.map(s => (s.id === next.id ? next : s))
      : [...sources, next]
    await this.persist()
    return toInfo(next)
  }

  /** 删除源；不存在时什么也不做。 */
  async remove(id: string): Promise<void> {
    const sources = await this.load()
    this.sources = sources.filter(s => s.id !== id)
    if (this.sources.length !== sources.length) await this.persist()
  }

  private toAccess(s: StoredSource): DavAccess {
    let password = ''
    if (s.password) {
      try {
        password = this.codec.decrypt(s.password)
      } catch {
        // 换了系统账户 / 密钥环：解不开就按没有密码处理，界面上重新填
        password = ''
      }
    }
    return { url: s.url, username: s.username, password }
  }

  private newId(sources: StoredSource[]): string {
    for (;;) {
      const id = randomBytes(4).toString('hex')
      if (!sources.some(s => s.id === id)) return id
    }
  }

  private async load(): Promise<StoredSource[]> {
    this.sources ??= parseSources(await this.io.read())
    return this.sources
  }

  /** 写盘串行，后一次写的总是最新内容。 */
  private persist(): Promise<void> {
    const text = JSON.stringify({ version: 1, sources: this.sources }, null, 2)
    this.writing = this.writing.catch(() => {}).then(() => this.io.write(text))
    return this.writing
  }
}
