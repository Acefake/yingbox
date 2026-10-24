/**
 * WebDAV / Alist 媒体库源：PROPFIND 响应解析、路径编码、增量判定（远程遍历 + 扫描写库）、
 * 播放代理的 Range 转发规则、源存储的密码加密。网络全部用假 fetch。
 */
import { describe, expect, it } from 'vitest'
import { CatalogStore } from '../src/main/library/catalog/catalog-store'
import { CatalogQuery } from '../src/main/library/catalog/query'
import { openLibraryDb } from '../src/main/library/db/database'
import { LibraryStore } from '../src/main/library/libraries/library-store'
import { StorageModes } from '../src/main/library/engine/storage-mode'
import { canReuseDir, dirStamp } from '../src/main/library/scanner/remote-rules'
import { scanLibrary } from '../src/main/library/scanner/scan-library'
import { ScanStore } from '../src/main/library/scanner/scan-store'
import { RACY_MTIME } from '../src/main/library/scanner/walk'
import { forwardRemote, parseProxyPath } from '../src/main/webdav/proxy'
import { WebDavSourceStore } from '../src/main/webdav/source-store'
import { normalizeLibraryQuery } from '../src/shared/library/ipc'
import {
  DavError,
  authHeader,
  createDavClient,
  davUrl,
} from '../src/shared/webdav/client'
import {
  hrefPath,
  parseMultistatus,
  splitListing,
} from '../src/shared/webdav/propfind'
import {
  downstreamHeaders,
  proxyStatus,
  upstreamHeaders,
} from '../src/shared/webdav/proxy-rules'
import {
  encodeRemotePath,
  parseRemoteMediaUrl,
  parseRemotePath,
  remoteMediaUrl,
  remotePath,
} from '../src/shared/webdav/remote-path'

// ———————————————————————— 假 WebDAV 服务端 ————————————————————————

interface FakeNode {
  dir: boolean
  size?: number
  mtime: number
  etag?: string
}

/** 内存里的远程目录树（键是解码后的绝对路径，含 basePath 之后的部分）+ 假 fetch。 */
function fakeServer(base = '/dav') {
  const nodes = new Map<string, FakeNode>([['/', { dir: true, mtime: 1 }]])
  const calls: Array<{ method: string; path: string; depth?: string }> = []
  const old = Date.UTC(2024, 0, 1)
  const put = (path: string, size = 100, mtime = old): void => {
    const parts = path.split('/').filter(Boolean)
    for (let i = 1; i < parts.length; i++) {
      const dir = `/${parts.slice(0, i).join('/')}`
      if (!nodes.has(dir)) nodes.set(dir, { dir: true, mtime: old })
    }
    nodes.set(path, { dir: false, size, mtime })
    touchParent(path, mtime)
  }
  const touchParent = (path: string, mtime: number): void => {
    const parent = path.slice(0, path.lastIndexOf('/')) || '/'
    const node = nodes.get(parent)!
    node.mtime = mtime
    node.etag = `e-${mtime}-${Math.random()}`
  }
  const entryXml = (path: string, node: FakeNode): string => {
    const href = `${base}${encodeRemotePath(path)}${node.dir && path !== '/' ? '/' : ''}`
    return `<D:response><D:href>${href}</D:href><D:propstat><D:prop>${
      node.dir
        ? '<D:resourcetype><D:collection/></D:resourcetype>'
        : `<D:resourcetype/><D:getcontentlength>${node.size}</D:getcontentlength>`
    }<D:getlastmodified>${new Date(node.mtime).toUTCString()}</D:getlastmodified>${
      node.etag ? `<D:getetag>"${node.etag}"</D:getetag>` : ''
    }</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`
  }
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const { pathname } = new URL(url)
    const decoded = hrefPath(pathname)
    const path = decoded === base ? '/' : decoded.slice(base.length)
    const headers = new Headers(init.headers)
    calls.push({
      method: String(init.method),
      path,
      depth: headers.get('depth') ?? undefined,
    })
    if (headers.get('authorization') !== authHeader(access))
      return new Response('nope', { status: 401 })
    const node = nodes.get(path)
    if (!node) return new Response(null, { status: 404 })
    const parts = [entryXml(path, node)]
    if (headers.get('depth') === '1') {
      for (const [p, n] of nodes) {
        const parent = p.slice(0, p.lastIndexOf('/')) || '/'
        if (p !== '/' && parent === path) parts.push(entryXml(p, n))
      }
    }
    return new Response(
      `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">${parts.join('')}</D:multistatus>`,
      { status: 207 }
    )
  }
  const access = {
    url: `http://nas.local:5244${base}`,
    username: 'admin',
    password: 'p@ss 密码',
  }
  return { nodes, calls, put, touchParent, fetch, access }
}

/** 远程媒体库 + 内存数据库。 */
function remoteEnv(server: ReturnType<typeof fakeServer>) {
  const db = openLibraryDb(':memory:')
  const library = new LibraryStore(db).add(
    { root: remotePath('ab12cd34', '/电影'), kind: 'movie' },
    1
  )
  const scanStore = new ScanStore(db)
  const catalog = new CatalogStore(db)
  /** 用给定的 fetch / 凭据扫一次（缺省用假服务端和正确的凭据）。 */
  const scanWith = (
    options: {
      full?: boolean
      fetch?: typeof server.fetch
      password?: string
    } = {}
  ) =>
    scanLibrary(
      {
        db,
        scanStore,
        catalog,
        fingerprint: async () => undefined,
        remote: async () =>
          createDavClient(
            {
              ...server.access,
              password: options.password ?? server.access.password,
            },
            options.fetch ?? server.fetch
          ),
      },
      library,
      { full: options.full, racyWindowMs: 0 }
    )
  return {
    db,
    library,
    query: new CatalogQuery(db),
    scanWith,
    scan: (full = false) => scanWith({ full }),
  }
}

// ———————————————————————— PROPFIND 解析 ————————————————————————

describe('PROPFIND 响应解析', () => {
  it('Alist 风格：绝对地址 href、编码中文、目录带斜杠、自己排在第一项', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<D:multistatus xmlns:D="DAV:">
<D:response><D:href>http://192.168.1.5:5244/dav/%E7%94%B5%E5%BD%B1/</D:href>
<D:propstat><D:prop><D:resourcetype><D:collection xmlns:D="DAV:"/></D:resourcetype>
<D:getlastmodified>Mon, 01 Jan 2024 00:00:00 GMT</D:getlastmodified></D:prop>
<D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
<D:response><D:href>/dav/%E7%94%B5%E5%BD%B1/A%20%26%20B%20%282001%29.mkv</D:href>
<D:propstat><D:prop><D:resourcetype></D:resourcetype><D:getcontentlength>1234</D:getcontentlength>
<D:getetag>W/"abc"</D:getetag></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
</D:multistatus>`
    const entries = parseMultistatus(xml, '/dav')
    expect(entries).toEqual([
      {
        path: '/电影',
        name: '电影',
        isDir: true,
        size: 0,
        lastModified: Date.UTC(2024, 0, 1),
        etag: null,
      },
      {
        path: '/电影/A & B (2001).mkv',
        name: 'A & B (2001).mkv',
        isDir: false,
        size: 1234,
        lastModified: null,
        etag: 'abc',
      },
    ])
    const { self, children } = splitListing(entries, '/电影/')
    expect(self?.name).toBe('电影')
    expect(children.map(c => c.name)).toEqual(['A & B (2001).mkv'])
  })

  it('Apache 风格：lp1 前缀、404 的 propstat 不参与、实体转义；不在源路径下的项丢掉', () => {
    const xml = `<D:multistatus xmlns:D="DAV:" xmlns:lp1="DAV:">
<D:response><D:href>/other/x.mkv</D:href></D:response>
<D:response><D:href>/dav/Tom &amp; Jerry.mp4</D:href>
<D:propstat><D:prop><lp1:resourcetype/><lp1:getcontentlength>42</lp1:getcontentlength>
<lp1:getlastmodified>Tue, 02 Jan 2024 00:00:00 GMT</lp1:getlastmodified></D:prop>
<D:status>HTTP/1.1 200 OK</D:status></D:propstat>
<D:propstat><D:prop><D:getetag/><D:getcontentlength>999</D:getcontentlength></D:prop>
<D:status>HTTP/1.1 404 Not Found</D:status></D:propstat></D:response>
</D:multistatus>`
    const [entry, ...rest] = parseMultistatus(xml, '/dav')
    expect(rest).toEqual([])
    expect(entry).toMatchObject({
      path: '/Tom & Jerry.mp4',
      isDir: false,
      size: 42,
      etag: null,
    })
  })

  it('无前缀命名空间、源地址就是根目录', () => {
    const xml = `<multistatus xmlns="DAV:"><response><href>/Movies/</href>
<propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat>
</response></multistatus>`
    expect(parseMultistatus(xml, '/')).toMatchObject([
      { path: '/Movies', isDir: true },
    ])
  })
})

// ———————————————————————— 路径编码 ————————————————————————

describe('远程路径与编码', () => {
  it('库里的路径保存原文，播放地址按段编码，来回不丢字符', () => {
    const path = remotePath('ab12cd34', '/电影/A B #1 100%/x.mkv')
    expect(path).toBe('yingbox-dav://ab12cd34/电影/A B #1 100%/x.mkv')
    const url = remoteMediaUrl(path)!
    expect(url).toBe(
      'yingbox-dav://ab12cd34/%E7%94%B5%E5%BD%B1/A%20B%20%231%20100%25/x.mkv'
    )
    expect(parseRemoteMediaUrl(url)).toEqual({
      sourceId: 'ab12cd34',
      path: '/电影/A B #1 100%/x.mkv',
    })
  })

  it('根目录、重复斜杠、非法源 id、.. 段', () => {
    expect(remotePath('ab12', '/')).toBe('yingbox-dav://ab12')
    expect(parseRemotePath('yingbox-dav://ab12')).toEqual({
      sourceId: 'ab12',
      path: '/',
    })
    expect(parseRemotePath('yingbox-dav://ab12//a//b/')).toEqual({
      sourceId: 'ab12',
      path: '/a/b',
    })
    expect(parseRemotePath('yingbox-dav://AB_12/x')).toBeNull()
    expect(parseRemotePath('D:/Movies')).toBeNull()
    // 地址里的 .. 在源的根目录内解析，跳不出源
    expect(parseRemoteMediaUrl('yingbox-dav://ab12/a/%2E%2E/b')?.path).toBe(
      '/b'
    )
    expect(parseRemoteMediaUrl('yingbox-dav://ab12/../../etc')?.path).toBe(
      '/etc'
    )
  })

  it('请求地址拼在源地址后面，目录带结尾斜杠', () => {
    expect(davUrl('http://nas:5244/dav/', '/电影 1', true)).toBe(
      'http://nas:5244/dav/%E7%94%B5%E5%BD%B1%201/'
    )
    expect(davUrl('http://nas:5244/dav', '/', true)).toBe(
      'http://nas:5244/dav/'
    )
    expect(davUrl('http://nas/dav', '/a.mkv')).toBe('http://nas/dav/a.mkv')
  })

  it('远程库按网盘处理（不监听、不读视频内容），不管存储设置', async () => {
    const modes = new StorageModes(async () => undefined)
    const lib = {
      root: 'yingbox-dav://ab12/电影',
      automation: { storage: 'local' as const },
    }
    expect(modes.known(lib)).toBe(true)
    await expect(modes.isCloud(lib)).resolves.toBe(true)
  })
})

// ———————————————————————— 增量判定 ————————————————————————

describe('增量判定', () => {
  it('版本戳：etag 优先，只有时间时刚改过的不可信，没有时间的总要重读', () => {
    const now = Date.UTC(2024, 5, 1)
    expect(dirStamp({ etag: 'a', lastModified: null }, now)).toBeGreaterThan(0)
    expect(dirStamp({ etag: 'a', lastModified: null }, now)).not.toBe(
      dirStamp({ etag: 'b', lastModified: null }, now)
    )
    const old = Date.UTC(2024, 0, 1)
    expect(dirStamp({ etag: null, lastModified: old }, now)).toBe(old)
    expect(dirStamp({ etag: null, lastModified: now + 1 }, now)).toBe(
      RACY_MTIME
    )
    expect(dirStamp({ etag: null, lastModified: 0 }, now)).toBe(RACY_MTIME)
    expect(dirStamp(undefined, now)).toBe(RACY_MTIME)
    expect(canReuseDir(old, old, false)).toBe(true)
    expect(canReuseDir(old, old, true)).toBe(false)
    expect(canReuseDir(RACY_MTIME, RACY_MTIME, false)).toBe(false)
    expect(canReuseDir(undefined, old, false)).toBe(false)
  })

  it('冷扫入库并解析片名；无变化重扫不再列任何目录', async () => {
    const server = fakeServer()
    server.put('/电影/Inception (2010)/Inception (2010).mkv', 10)
    server.put('/电影/流浪地球 2019/流浪地球.2019.1080p.mkv', 20)
    server.put('/电影/流浪地球 2019/notes.txt', 1)
    const env = remoteEnv(server)

    const first = await env.scan()
    expect(first.added).toBe(2)
    const { items } = env.query.list(normalizeLibraryQuery({}))
    expect(items.map(i => [i.title, i.year]).sort()).toEqual([
      ['Inception', 2010],
      ['流浪地球', 2019],
    ])
    const paths = env.db
      .prepare("SELECT path FROM files WHERE kind = 'video' ORDER BY path")
      .all()
      .map(r => String(r.path))
    expect(paths[0]).toBe(
      'yingbox-dav://ab12cd34/电影/Inception (2010)/Inception (2010).mkv'
    )

    server.calls.length = 0
    const again = await env.scan()
    expect(again.added + again.changed + again.removed).toBe(0)
    expect(server.calls.filter(c => c.depth === '1')).toEqual([
      // 根目录总是列一次（拿子目录的版本戳）
      { method: 'PROPFIND', path: '/电影', depth: '1' },
    ])
    expect(again.stats.dirsReused).toBe(2)
  })

  it('只改了一个子目录：只列那个目录；删掉的文件、目录记删除', async () => {
    const server = fakeServer()
    server.put('/电影/A (2001)/A (2001).mkv')
    server.put('/电影/B (2002)/B (2002).mkv')
    server.put('/电影/C (2003)/C (2003).mkv')
    const env = remoteEnv(server)
    await env.scan()

    server.put('/电影/A (2001)/A (2001).cd2.mkv', 5, Date.UTC(2024, 2, 1))
    server.nodes.delete('/电影/C (2003)/C (2003).mkv')
    server.nodes.delete('/电影/C (2003)')
    server.touchParent('/电影/C (2003)', Date.UTC(2024, 2, 2))
    server.calls.length = 0

    const summary = await env.scan()
    expect(summary.added).toBe(1)
    expect(summary.removed).toBe(1)
    expect(
      server.calls
        .filter(c => c.depth === '1')
        .map(c => c.path)
        .sort()
    ).toEqual(['/电影', '/电影/A (2001)'])
  })

  it('全量扫描无视版本戳；根目录连不上抛错（不当成全删了），子目录失败只告警', async () => {
    const server = fakeServer()
    server.put('/电影/A (2001)/A (2001).mkv')
    const env = remoteEnv(server)
    await env.scan()

    server.calls.length = 0
    await env.scan(true)
    expect(server.calls.filter(c => c.depth === '1')).toHaveLength(2)

    // 子目录 A 出错，根目录正常
    const brokenFetch = async (url: string, init: RequestInit) =>
      new URL(url).pathname.includes('A%20')
        ? new Response(null, { status: 500 })
        : server.fetch(url, init)
    server.put('/电影/A (2001)/new.mkv', 1, Date.UTC(2024, 3, 1))
    const partial = await env.scanWith({ fetch: brokenFetch })
    expect(partial.removed).toBe(0)
    expect(partial.warnings.join()).toContain('服务器返回 500')

    await expect(env.scanWith({ password: 'wrong' })).rejects.toMatchObject({
      code: 'auth',
    })
  })
})

// ———————————————————————— 客户端与播放代理 ————————————————————————

describe('WebDAV 客户端', () => {
  it('发 PROPFIND + Depth + Basic 认证；200 普通网页、401、404 分类报错', async () => {
    const seen: Headers[] = []
    let status = 207
    const client = createDavClient(
      { url: 'http://nas/dav', username: 'u', password: 'p' },
      async (_url, init) => {
        seen.push(new Headers(init.headers))
        return new Response('<multistatus xmlns="DAV:"/>', { status })
      }
    )
    await expect(client.propfind('/', 1)).resolves.toEqual([])
    expect(seen[0].get('depth')).toBe('1')
    expect(seen[0].get('authorization')).toBe(`Basic ${btoa('u:p')}`)
    status = 200
    await expect(client.propfind('/', 0)).rejects.toMatchObject({
      code: 'protocol',
    })
    status = 401
    await expect(client.propfind('/', 0)).rejects.toBeInstanceOf(DavError)
    status = 404
    await expect(client.propfind('/', 0)).rejects.toMatchObject({
      code: 'not-found',
    })
  })
})

describe('播放代理的 Range 转发', () => {
  it('请求头只带合法的 Range / If-Range 和认证', () => {
    const get = (h: Record<string, string>) => (n: string) => h[n]
    expect(
      upstreamHeaders(
        get({ range: 'bytes=100-', 'if-range': '"e1"', cookie: 'x' }),
        'Basic aaa'
      )
    ).toEqual({
      Range: 'bytes=100-',
      'If-Range': '"e1"',
      Authorization: 'Basic aaa',
    })
    expect(upstreamHeaders(get({ range: 'items=1-2' }), undefined)).toEqual({})
  })

  it('状态：200 / 206 / 416 原样，认证失败与 5xx 回 502；响应头去掉认证质询并补视频类型', () => {
    expect([200, 206, 304, 416, 404, 401, 500].map(proxyStatus)).toEqual([
      200, 206, 304, 416, 404, 502, 502,
    ])
    const upstream = new Headers({
      'content-type': 'application/octet-stream',
      'content-range': 'bytes 0-9/100',
      'www-authenticate': 'Basic realm="x"',
      'set-cookie': 'a=b',
    })
    expect(downstreamHeaders(n => upstream.get(n), 'video/x-matroska')).toEqual(
      {
        'Cache-Control': 'no-cache',
        'content-type': 'video/x-matroska',
        'content-range': 'bytes 0-9/100',
      }
    )
  })

  it('forwardRemote：加凭据转发 Range，206 流式回给播放器；HEAD 不带正文；源不存在 404', async () => {
    const seen: Array<{ url: string; headers: Headers; method?: string }> = []
    const fetch = async (url: string, init: RequestInit) => {
      seen.push({
        url,
        headers: new Headers(init.headers),
        method: init.method,
      })
      return new Response('0123456789', {
        status: 206,
        headers: {
          'content-type': 'application/octet-stream',
          'content-range': 'bytes 0-9/100',
          'content-length': '10',
        },
      })
    }
    const lookup = async (id: string) =>
      id === 'ab12'
        ? { url: 'http://nas/dav', username: 'u', password: 'p' }
        : null
    const target = { sourceId: 'ab12', path: '/电影/a b.mkv' }
    const res = await forwardRemote(
      { method: 'GET', header: n => (n === 'range' ? 'bytes=0-9' : null) },
      target,
      lookup,
      fetch
    )
    expect(res.status).toBe(206)
    expect(await res.text()).toBe('0123456789')
    expect(res.headers.get('content-type')).toBe('video/x-matroska')
    expect(seen[0].url).toBe('http://nas/dav/%E7%94%B5%E5%BD%B1/a%20b.mkv')
    expect(seen[0].headers.get('range')).toBe('bytes=0-9')
    expect(seen[0].headers.get('authorization')).toBe(`Basic ${btoa('u:p')}`)

    const head = await forwardRemote(
      { method: 'HEAD', header: () => null },
      target,
      lookup,
      fetch
    )
    expect(head.body).toBeNull()
    const missing = await forwardRemote(
      { method: 'GET', header: () => null },
      { sourceId: 'zz', path: '/x' },
      lookup,
      fetch
    )
    expect(missing.status).toBe(404)
    const post = await forwardRemote(
      { method: 'POST', header: () => null },
      target,
      lookup,
      fetch
    )
    expect(post.status).toBe(405)
  })

  it('mpv 代理地址：令牌不对或源 id 非法都拒绝', () => {
    expect(parseProxyPath('/tok/ab12/%E7%94%B5%E5%BD%B1/a.mkv', 'tok')).toEqual(
      {
        sourceId: 'ab12',
        path: '/电影/a.mkv',
      }
    )
    expect(parseProxyPath('/bad/ab12/a.mkv', 'tok')).toBeNull()
    expect(parseProxyPath('/tok/AB!/a.mkv', 'tok')).toBeNull()
  })
})

// ———————————————————————— 源存储 ————————————————————————

describe('源存储', () => {
  const codec = {
    available: () => true,
    encrypt: (plain: string) => `enc:${Buffer.from(plain).toString('base64')}`,
    decrypt: (cipher: string) =>
      Buffer.from(cipher.slice(4), 'base64').toString(),
  }

  it('密码只存密文、视图里没有；留空保存保留原密码；测试连接可用已存密码', async () => {
    let file: string | null = null
    const store = new WebDavSourceStore(
      { read: async () => file, write: async text => void (file = text) },
      codec
    )
    const saved = await store.save({
      name: '',
      url: 'http://nas.local:5244/dav/',
      username: 'admin',
      password: 'secret',
    })
    expect(saved).toMatchObject({
      name: 'nas.local',
      url: 'http://nas.local:5244/dav',
      hasPassword: true,
    })
    expect(file).not.toContain('secret')
    expect(JSON.stringify(await store.list())).not.toContain('secret')

    await store.save({
      id: saved.id,
      name: 'NAS',
      url: saved.url,
      username: 'admin',
    })
    expect((await store.access(saved.id))?.password).toBe('secret')
    const probe = await store.accessFor({
      id: saved.id,
      name: '',
      url: saved.url,
      username: 'admin',
    })
    expect(probe.password).toBe('secret')

    await expect(
      store.save({ name: '', url: 'http://u:p@nas/dav', username: '' })
    ).rejects.toThrow()
    const reopened = new WebDavSourceStore(
      { read: async () => file, write: async () => {} },
      codec
    )
    expect((await reopened.list()).map(s => s.name)).toEqual(['NAS'])
  })

  it('系统密钥存储不可用时拒绝保存密码', async () => {
    const store = new WebDavSourceStore(
      { read: async () => null, write: async () => {} },
      { ...codec, available: () => false }
    )
    await expect(
      store.save({
        name: '',
        url: 'http://nas/dav',
        username: 'a',
        password: 'b',
      })
    ).rejects.toThrow('密钥存储不可用')
  })
})
