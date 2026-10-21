/**
 * 宿主能力与服务配置：出网实现的选择、curl 输出解析（及真实 curl 往返）、配置解析、密钥文件、令牌比较、路由。
 */
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs'
import { type Server, createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createCurlFetch,
  curlArgs,
  parseCurlOutput,
} from '../../src/main/library/platform/fetch/curl-fetch'
import { parseFetchSpec } from '../../src/main/library/platform/fetch'
import { loadConfig } from '../../src/server/config'
import { createAuth, readCookie, sameOrigin } from '../../src/server/http/auth'
import { Router } from '../../src/server/http/router'
import { resolveStatic } from '../../src/server/http/static'
import { resolveWithinRoots } from '../../src/server/routes/roots'
import { FileSecretStore, ensureServerToken } from '../../src/server/secrets'

describe('出网实现', () => {
  it('解析配置串', () => {
    expect(parseFetchSpec(undefined)).toEqual({ kind: 'node' })
    expect(parseFetchSpec('node')).toEqual({ kind: 'node' })
    expect(parseFetchSpec('curl')).toEqual({ kind: 'curl' })
    expect(parseFetchSpec('curl:/opt/curl_chrome116')).toEqual({
      kind: 'curl',
      binary: '/opt/curl_chrome116',
    })
    expect(parseFetchSpec('module:./x.mjs')).toEqual({
      kind: 'module',
      path: './x.mjs',
    })
    expect(() => parseFetchSpec('electron')).toThrow(/不支持/)
  })

  it('curl 输出：跳过重定向与代理 CONNECT 头，取最终响应', () => {
    const out = Buffer.from(
      'HTTP/1.1 200 Connection established\r\n\r\n' +
        'HTTP/2 301\r\nlocation: /b\r\n\r\n' +
        'HTTP/2 200\r\ncontent-type: text/html\r\nset-cookie: a=1\r\n\r\n<html>HTTP/x</html>'
    )
    const parsed = parseCurlOutput(out)
    expect(parsed.status).toBe(200)
    expect(parsed.headers).toContainEqual(['content-type', 'text/html'])
    expect(parsed.body.toString()).toBe('<html>HTTP/x</html>')
    expect(() => parseCurlOutput(Buffer.from('garbage'))).toThrow()
  })

  it('curl 参数：头里的换行被丢弃，地址放在 -- 之后', () => {
    const args = curlArgs(
      'https://a.test/x',
      { A: 'b', Bad: 'x\r\nInjected: 1' },
      1000,
      15000
    )
    expect(args).toContain('A: b')
    expect(args.join(' ')).not.toContain('Injected')
    expect(args.slice(-2)).toEqual(['--', 'https://a.test/x'])
  })

  describe('真实 curl 往返', () => {
    let server: Server
    let base = ''
    const hasCurl = (() => {
      try {
        execFileSync('curl', ['--version'])
        return true
      } catch {
        return false
      }
    })()

    beforeAll(async () => {
      server = createServer((req, res) => {
        if (req.url === '/redirect') {
          res.writeHead(302, { location: '/page' })
          res.end()
          return
        }
        res.writeHead(req.url === '/page' ? 200 : 404, {
          'content-type': 'text/plain; charset=utf-8',
          'x-ua': String(req.headers['user-agent']),
        })
        res.end(req.url === '/page' ? '番号页面' : 'missing')
      })
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
    })
    afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

    it.runIf(hasCurl)('跟随重定向、带请求头、文本与状态码正确', async () => {
      const fetch = createCurlFetch()
      const res = await fetch(`${base}/redirect`, {
        headers: { 'User-Agent': 'yingbox-test' },
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('x-ua')).toBe('yingbox-test')
      expect(await res.text()).toBe('番号页面')
      expect((await fetch(`${base}/none`, {})).status).toBe(404)
    })

    it.runIf(hasCurl)('取消时结束子进程并拒绝', async () => {
      const controller = new AbortController()
      controller.abort(new Error('cancelled'))
      await expect(
        createCurlFetch()(`${base}/page`, { signal: controller.signal })
      ).rejects.toThrow()
    })

    it('可执行文件不存在时报错', async () => {
      await expect(
        createCurlFetch({ binary: '/nonexistent/curl' })(`${base}/page`, {})
      ).rejects.toThrow(/无法启动/)
    })
  })
})

describe('服务配置', () => {
  const defaults = {
    cwd: '/srv',
    home: '/home/u',
    bundleDir: '/nowhere/out/server',
  }

  it('默认只听 127.0.0.1，数据目录在主目录', () => {
    const config = loadConfig([], {}, defaults)
    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 31480,
      dataDir: '/home/u/.yingbox-server',
      mediaRoots: ['/home/u'],
      webDir: null,
      fetch: { kind: 'node' },
    })
  })

  it('参数优先于环境变量，可重复 --media-root', () => {
    const config = loadConfig(
      [
        '--port=8080',
        '--media-root',
        '/media/a',
        '--media-root',
        'b',
        '--web-dir',
        'off',
      ],
      {
        YINGBOX_PORT: '9000',
        YINGBOX_HOST: '0.0.0.0',
        YINGBOX_DATA_DIR: 'data',
        YINGBOX_FETCH: 'curl',
      },
      defaults
    )
    expect(config).toMatchObject({
      host: '0.0.0.0',
      port: 8080,
      dataDir: '/srv/data',
      mediaRoots: ['/media/a', '/srv/b'],
      webDir: null,
      fetch: { kind: 'curl' },
    })
    expect(() => loadConfig(['--port', 'abc'], {}, defaults)).toThrow(/端口/)
  })
})

describe('密钥与鉴权', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'yingbox-secrets-'))
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('生成的令牌落盘为 0600，环境变量覆盖但不写回', () => {
    const file = join(dir, 'secrets.json')
    const store = new FileSecretStore(file, {})
    const first = ensureServerToken(store)
    expect(first.generated).toBe(true)
    expect(first.token.length).toBeGreaterThanOrEqual(40)
    if (process.platform !== 'win32')
      expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(ensureServerToken(new FileSecretStore(file, {}))).toEqual({
      token: first.token,
      generated: false,
    })
    const fromEnv = new FileSecretStore(file, {
      YINGBOX_SERVER_TOKEN: 'env-token',
    })
    expect(ensureServerToken(fromEnv).token).toBe('env-token')
    expect(JSON.parse(readFileSync(file, 'utf8'))['server.token']).toBe(
      first.token
    )
    store.set('scrape.tmdbToken', 'x')
    store.set('scrape.tmdbToken', null)
    expect(
      new FileSecretStore(file, {}).get('scrape.tmdbToken')
    ).toBeUndefined()
  })

  it('令牌比较、Cookie 解析、同源检查', () => {
    const auth = createAuth('secret')
    expect(auth.matches('secret')).toBe(true)
    expect(auth.matches('secre')).toBe(false)
    expect(auth.matches(undefined)).toBe(false)
    expect(readCookie('a=1; yingbox_token=secret', 'yingbox_token')).toBe(
      'secret'
    )
    const req = (headers: Record<string, string>, method = 'POST'): Request =>
      new Request('http://h/api', { method, headers })
    expect(auth.check(req({ cookie: 'yingbox_token=secret' }, 'GET'))).toBe(
      true
    )
    expect(auth.check(req({ authorization: 'Bearer secret' }, 'GET'))).toBe(
      true
    )
    expect(
      sameOrigin(req({ host: 'nas:31480', origin: 'http://nas:31480' }))
    ).toBe(true)
    expect(sameOrigin(req({ host: 'nas:31480', origin: 'http://evil' }))).toBe(
      false
    )
    expect(sameOrigin(req({ host: 'nas:31480' }))).toBe(true)
  })

  it('媒体根目录：跟随符号链接后判断', async () => {
    const root = join(dir, 'root')
    mkdirSync(join(root, 'movies'), { recursive: true })
    mkdirSync(join(dir, 'outside'))
    symlinkSync(join(dir, 'outside'), join(root, 'escape'))
    expect(await resolveWithinRoots(join(root, 'movies'), [root])).toBe(
      join(root, 'movies')
    )
    expect(await resolveWithinRoots(join(root, 'escape'), [root])).toBeNull()
    expect(await resolveWithinRoots('relative', [root])).toBeNull()
    await expect(
      resolveWithinRoots(join(root, 'nope'), [root])
    ).rejects.toThrow()
  })
})

describe('路由与静态文件', () => {
  it('路径参数、HEAD 命中 GET、方法不对', () => {
    const router = new Router().add(
      'GET',
      '/media/image/:key',
      () => new Response()
    )
    expect(router.match('GET', '/media/image/abc')).toMatchObject({
      params: { key: 'abc' },
    })
    expect(router.match('HEAD', '/media/image/abc')).not.toBeNull()
    expect(router.match('POST', '/media/image/abc')).toBe('method-not-allowed')
    expect(router.match('GET', '/media/image')).toBeNull()
  })

  it('静态路径不能穿越出网页目录', () => {
    expect(resolveStatic('/web', '/assets/a.js')).toBe('/web/assets/a.js')
    expect(resolveStatic('/web', '/../etc/passwd')).toBeNull()
    expect(resolveStatic('/web', '/%2e%2e/%2e%2e/etc/passwd')).toBeNull()
    expect(resolveStatic('/web', '/assets/../index.html')).toBe(
      '/web/index.html'
    )
    expect(resolveStatic('/web', '/a%00b')).toBeNull()
  })
})
