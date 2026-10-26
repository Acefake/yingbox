/**
 * 115 登录 Cookie 的持久化罐子（服务端代替 Electron 分区的 Cookie 罐）：<dataDir>/pan115-cookies.json，权限 0600。
 *
 * - base 是网盘服务交来的那份登录 Cookie 串（会话里的 "UID=…; CID=…; SEID=…; KID=…"）；同一份再交来时不重写，
 *   保留 115 之后用 Set-Cookie 续上的值；换了一份（重新扫码 / 退出）才整罐替换；
 * - 只收 115.com 及其子域的 Set-Cookie（Domain 属性不能越出请求主机），按 Max-Age / Expires 过期删除；
 * - 发请求时按 RFC 6265 的域、路径、Secure 规则挑 Cookie；
 * - 每次变动立即原子落盘（临时文件 + 改名，再收紧一次权限）；文件损坏时当空罐。
 * 罐里的值等同登录凭据：不写日志，数据目录应只让服务用户可读。
 */
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'

import { is115Url, parseCookieHeader } from '../../main/pan115/transport'

/** 罐里的一条 Cookie */
export interface StoredCookie {
  name: string
  value: string
  /** 小写主机名，不带前导点 */
  domain: string
  /** true 时只发给 domain 本身，不发给子域 */
  hostOnly: boolean
  path: string
  secure: boolean
  /** 过期时间（毫秒时间戳）；缺省为不过期（服务端也落盘，重启后仍在） */
  expires?: number
}

/** 落盘格式 */
interface JarFile {
  version: 1
  base: string | null
  cookies: StoredCookie[]
}

/** 主机是否与 Cookie 的域匹配（RFC 6265 5.1.3） */
export function domainMatches(host: string, cookie: StoredCookie): boolean {
  if (host === cookie.domain) return true
  return !cookie.hostOnly && host.endsWith(`.${cookie.domain}`)
}

/** 请求路径是否落在 Cookie 路径下（RFC 6265 5.1.4） */
export function pathMatches(path: string, cookiePath: string): boolean {
  if (path === cookiePath) return true
  if (!path.startsWith(cookiePath)) return false
  return cookiePath.endsWith('/') || path.charAt(cookiePath.length) === '/'
}

/** 请求地址的默认 Cookie 路径（RFC 6265 5.1.4） */
function defaultPath(url: URL): string {
  const path = url.pathname
  if (!path.startsWith('/') || path.lastIndexOf('/') === 0) return '/'
  return path.slice(0, path.lastIndexOf('/'))
}

/**
 * 解析一条 Set-Cookie。返回 null 表示丢弃（格式不对，或 Domain 越出请求主机 / 不属于 115）；
 * 返回 expires <= now 的条目表示删除。
 */
export function parseSetCookie(
  header: string,
  requestUrl: string,
  now: number
): StoredCookie | null {
  const url = new URL(requestUrl)
  const host = url.hostname.toLowerCase()
  const [pair, ...attrs] = header.split(';')
  const eq = pair.indexOf('=')
  if (eq <= 0) return null
  const cookie: StoredCookie = {
    name: pair.slice(0, eq).trim(),
    value: pair.slice(eq + 1).trim(),
    domain: host,
    hostOnly: true,
    path: defaultPath(url),
    secure: false,
  }
  let maxAge: number | undefined
  let expires: number | undefined
  for (const attr of attrs) {
    const at = attr.indexOf('=')
    const key = (at < 0 ? attr : attr.slice(0, at)).trim().toLowerCase()
    const value = at < 0 ? '' : attr.slice(at + 1).trim()
    if (key === 'domain' && value) {
      const domain = value.replace(/^\./, '').toLowerCase()
      if (host !== domain && !host.endsWith(`.${domain}`)) return null
      cookie.domain = domain
      cookie.hostOnly = false
    } else if (key === 'path' && value.startsWith('/')) cookie.path = value
    else if (key === 'secure') cookie.secure = true
    else if (key === 'max-age' && /^-?\d+$/.test(value)) maxAge = Number(value)
    else if (key === 'expires') {
      const time = Date.parse(value)
      if (!Number.isNaN(time)) expires = time
    }
  }
  if (!is115Url(`https://${cookie.domain}/`)) return null
  if (maxAge !== undefined) cookie.expires = now + maxAge * 1000
  else if (expires !== undefined) cookie.expires = expires
  return cookie
}

/** 持久化的 Cookie 罐 */
export class CookieJar {
  private base: string | null = null
  private cookies: StoredCookie[] = []

  private constructor(
    private readonly file: string,
    private readonly now: () => number
  ) {}

  /** 从文件打开（不存在或损坏时为空罐） */
  static open(file: string, now: () => number = Date.now): CookieJar {
    const jar = new CookieJar(file, now)
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as Partial<JarFile>
      if (data && data.version === 1 && Array.isArray(data.cookies)) {
        jar.base = typeof data.base === 'string' ? data.base : null
        jar.cookies = data.cookies.filter(
          c => c && typeof c.name === 'string' && typeof c.value === 'string'
        )
      }
    } catch {
      /* 当空罐 */
    }
    return jar
  }

  /** 当前登录 Cookie 串（null = 未登录 / 已清空） */
  baseCookie(): string | null {
    return this.base
  }

  /**
   * 换成一份登录 Cookie（null 为清空）：写成 .115.com 域、路径 /、Secure、不过期。
   * @param origin 写 Cookie 用的地址（测试可传 http 源）
   */
  replace(cookie: string | null, origin = 'https://115.com'): void {
    const url = new URL(origin)
    this.base = cookie
    this.cookies = cookie
      ? parseCookieHeader(cookie).map(({ name, value }) => ({
          name,
          value,
          domain: url.hostname.toLowerCase(),
          hostOnly: false,
          path: '/',
          secure: url.protocol === 'https:',
        }))
      : []
    this.save()
  }

  /** 发往 url 的 Cookie 头（没有匹配时为空串） */
  header(requestUrl: string): string {
    const url = new URL(requestUrl)
    const host = url.hostname.toLowerCase()
    const now = this.now()
    return this.cookies
      .filter(
        c =>
          (c.expires === undefined || c.expires > now) &&
          domainMatches(host, c) &&
          pathMatches(url.pathname || '/', c.path) &&
          (!c.secure || url.protocol === 'https:')
      )
      .sort((a, b) => b.path.length - a.path.length)
      .map(c => `${c.name}=${c.value}`)
      .join('; ')
  }

  /** 收下响应里的 Set-Cookie（同名同域同路径的覆盖，过期的删除）；有变动才落盘 */
  store(requestUrl: string, setCookies: readonly string[]): void {
    if (!setCookies.length || !this.base) return
    const now = this.now()
    let changed = false
    for (const header of setCookies) {
      const cookie = parseSetCookie(header, requestUrl, now)
      if (!cookie) continue
      const before = this.cookies.length
      this.cookies = this.cookies.filter(
        c =>
          !(
            c.name === cookie.name &&
            c.domain === cookie.domain &&
            c.path === cookie.path
          )
      )
      const expired = cookie.expires !== undefined && cookie.expires <= now
      if (!expired) this.cookies.push(cookie)
      changed ||= !expired || this.cookies.length !== before
    }
    if (changed) this.save()
  }

  /** 原子落盘，权限 0600 */
  private save(): void {
    const data: JarFile = { version: 1, base: this.base, cookies: this.cookies }
    mkdirSync(dirname(this.file), { recursive: true })
    const temp = `${this.file}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(data), { mode: 0o600 })
    renameSync(temp, this.file)
    try {
      chmodSync(this.file, 0o600)
    } catch {
      /* Windows 上 chmod 只影响只读位 */
    }
  }
}
