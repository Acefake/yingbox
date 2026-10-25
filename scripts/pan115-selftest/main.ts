/**
 * 115 分区传输层自检（在真 Electron 主进程里跑，由 run.mjs 打包并启动）。
 *
 * 起一个本地回显服务器，用 host-resolver-rules 把 webapi.115.com / example.org 指到 127.0.0.1，
 * 再经 createSessionTransport（正式代码）发请求，看服务器实际收到的 Cookie / Referer / User-Agent：
 * - 115 域：四项 Cookie 都在、Referer 为 https://115.com/、UA 为桌面 Chrome；POST 体与 Content-Type 保留；
 * - 别的域名：不带 115 的 Cookie 与 Referer；
 * - useCookie(null) 之后：115 域不再带 Cookie。
 * 另外记录旧做法（默认会话 net.fetch + 手写头 + credentials: 'omit'）实际发出的头，供对照。
 * 结果以一行 JSON（前缀 PAN115_SELFTEST）打印；全部通过退出码 0。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { app, net, session } from 'electron'

import { USER_AGENT } from '../../src/main/pan115/http'
import { createSessionTransport } from '../../src/main/pan115/session-transport'

const COOKIE = 'UID=u-1_A1; CID=c-2; SEID=s-3; KID=k-4'

app.commandLine.appendSwitch(
  'host-resolver-rules',
  'MAP webapi.115.com 127.0.0.1, MAP passportapi.115.com 127.0.0.1, MAP example.org 127.0.0.1'
)

interface Echo {
  method: string
  headers: Record<string, string | string[] | undefined>
  body: string
}

function startEcho(): Promise<number> {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => (body += chunk))
    req.on('end', () => {
      const echo: Echo = {
        method: req.method ?? '',
        headers: req.headers,
        body,
      }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(echo))
    })
  })
  return new Promise(resolve =>
    server.listen(0, '127.0.0.1', () =>
      resolve((server.address() as AddressInfo).port)
    )
  )
}

async function main(): Promise<boolean> {
  const port = await startEcho()
  const target = session.fromPartition(`pan115-selftest-${Date.now()}`)
  await target.setProxy({ mode: 'direct' })
  await session.defaultSession.setProxy({ mode: 'direct' })
  const transport = createSessionTransport(target, 'http://115.com')
  const echo = async (
    fetch: (url: string, init?: RequestInit) => Promise<Response>,
    url: string,
    init?: RequestInit
  ): Promise<Echo> => (await (await fetch(url, init)).json()) as Echo

  const pick = (e: Echo): Record<string, unknown> => ({
    cookie: e.headers.cookie ?? null,
    referer: e.headers.referer ?? null,
    'user-agent': e.headers['user-agent'] ?? null,
  })

  await transport.useCookie(COOKIE)
  const get = await echo(
    transport.fetch,
    `http://webapi.115.com:${port}/files?cid=0`
  )
  const post = await echo(
    transport.fetch,
    `http://passportapi.115.com:${port}/app/1.0/alipaymini/1.0/login/qrcode/`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'app=alipaymini&account=u',
    }
  )
  const other = await echo(transport.fetch, `http://example.org:${port}/`)
  await transport.useCookie(null)
  const cleared = await echo(
    transport.fetch,
    `http://webapi.115.com:${port}/files`
  )

  // 旧做法：默认会话 net.fetch + 手写 Cookie / Referer / UA（没有 referrerPolicy）
  const legacy = await echo(
    (url, init) => net.fetch(url, { ...init, credentials: 'omit' }),
    `http://webapi.115.com:${port}/legacy`,
    {
      headers: {
        Cookie: COOKIE,
        Referer: 'https://115.com/',
        'User-Agent': USER_AGENT,
      },
    }
  ).then(pick, (error: Error) => ({ error: error.message }))

  const cookie = (e: Echo): string => String(e.headers.cookie ?? '')
  const hasAll = (e: Echo): boolean =>
    ['UID=u-1_A1', 'CID=c-2', 'SEID=s-3', 'KID=k-4'].every(pair =>
      cookie(e).split(/;\s*/).includes(pair)
    )
  const checks = {
    '115 GET 带全部 Cookie': hasAll(get),
    '115 GET Referer=https://115.com/':
      get.headers.referer === 'https://115.com/',
    '115 GET UA=桌面 Chrome': get.headers['user-agent'] === USER_AGENT,
    '115 POST 带 Cookie': hasAll(post),
    '115 POST Referer/UA':
      post.headers.referer === 'https://115.com/' &&
      post.headers['user-agent'] === USER_AGENT,
    '115 POST 体与 Content-Type 保留':
      post.method === 'POST' &&
      post.body === 'app=alipaymini&account=u' &&
      String(post.headers['content-type']).startsWith(
        'application/x-www-form-urlencoded'
      ),
    '别的域名不带 115 Cookie': !cookie(other).includes('SEID'),
    '别的域名不带 115 Referer': other.headers.referer !== 'https://115.com/',
    '清空后 115 不带 Cookie': !cookie(cleared).includes('SEID'),
  }
  const ok = Object.values(checks).every(Boolean)
  console.log(
    `PAN115_SELFTEST ${JSON.stringify({
      ok,
      electron: process.versions.electron,
      checks,
      received: {
        get: pick(get),
        post: pick(post),
        other: pick(other),
        cleared: pick(cleared),
      },
      legacyNetFetchManualHeaders: legacy,
    })}`
  )
  return ok
}

app.whenReady().then(() =>
  main().then(
    ok => app.exit(ok ? 0 : 1),
    error => {
      console.log(
        `PAN115_SELFTEST ${JSON.stringify({
          ok: false,
          error: String(error?.stack ?? error),
        })}`
      )
      app.exit(1)
    }
  )
)
