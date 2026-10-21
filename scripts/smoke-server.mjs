#!/usr/bin/env node
/**
 * 片库服务冒烟（pnpm smoke:server，先 pnpm build:server）：起一个真实的服务进程，经 HTTP 走一遍
 * 登录 → 建库 → 扫描 fixture 目录 → 番号识别（离线回放录制页面）→ 查询列表 → 取海报缩略图 → 视频 Range。
 *
 * 用临时数据目录与临时媒体目录，跑完删除；任何一步失败以退出码 1 结束。
 * 加 --online 改用真实网络（Node fetch），用来看站点在当前网络下是否可达（被 Cloudflare 拦下属正常）。
 */
import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SERVER = join(ROOT, 'out/server/server.js')
const online = process.argv.includes('--online')
const TOKEN = 'smoke-token-0123456789'

if (!existsSync(SERVER)) {
  console.error('找不到 out/server/server.js，请先运行 pnpm build:server')
  process.exit(1)
}

/** 找一个空闲端口。 */
const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })

const work = mkdtempSync(join(tmpdir(), 'yingbox-smoke-'))
const media = join(work, 'media')
const write = (path, bytes) => {
  mkdirSync(dirname(join(media, path)), { recursive: true })
  writeFileSync(join(media, path), bytes)
}
write('SSIS-497/SSIS-497-C.mp4', Buffer.alloc(2 * 1024 * 1024, 1))
write('FC2-PPV-3662771.mp4', Buffer.alloc(64 * 1024, 2))
write('random video.mp4', Buffer.alloc(1024, 3))

const port = await freePort()
const base = `http://127.0.0.1:${port}`
const webDir = join(ROOT, 'dist-web')
const child = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', SERVER],
  {
    env: {
      ...process.env,
      YINGBOX_PORT: String(port),
      YINGBOX_DATA_DIR: join(work, 'data'),
      YINGBOX_MEDIA_ROOTS: media,
      YINGBOX_SERVER_TOKEN: TOKEN,
      // 夹具文件刚写出，mtime 很新：不做写入稳定判定，建库后立即入库
      YINGBOX_SETTLE_SECONDS: '0',
      YINGBOX_WEB_DIR: existsSync(join(webDir, 'index.html')) ? webDir : 'off',
      ...(online
        ? {}
        : {
            YINGBOX_FETCH: `module:${join(ROOT, 'scripts/smoke/fixture-fetch.mjs')}`,
          }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
)
let logs = ''
child.stdout.on('data', d => (logs += d))
child.stderr.on('data', d => (logs += d))

const results = []
let failed = false
const step = async (name, run) => {
  const started = Date.now()
  try {
    const detail = await run()
    results.push(
      `✔ ${name}（${Date.now() - started} ms）${detail ? `：${detail}` : ''}`
    )
  } catch (error) {
    failed = true
    results.push(`✘ ${name}：${error.message}`)
    throw error
  }
}
const expect = (ok, message) => {
  if (!ok) throw new Error(message)
}
let cookie = ''
const api = (path, init = {}) =>
  fetch(base + path, {
    ...init,
    headers: { ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
  })
const rpc = async (method, params) => {
  const res = await api('/api/library/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, params }),
  })
  const body = await res.json()
  if (!body.ok)
    throw new Error(`${method} → ${body.error.code}: ${body.error.message}`)
  return body.result
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

try {
  await step('服务启动（GET /api/health）', async () => {
    for (let i = 0; i < 100; i++) {
      const res = await fetch(base + '/api/health').catch(() => null)
      if (res?.ok) return JSON.stringify(await res.json())
      await sleep(100)
    }
    throw new Error('10 秒内没有响应')
  })
  await step('未登录访问被拒（401）', async () => {
    const res = await api('/api/info')
    expect(res.status === 401, `期望 401，实际 ${res.status}`)
  })
  await step('登录（POST /api/session → HttpOnly Cookie）', async () => {
    const res = await api('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    })
    expect(res.status === 204, `期望 204，实际 ${res.status}`)
    cookie = res.headers.getSetCookie()[0].split(';')[0]
    return res.headers.getSetCookie()[0].replace(TOKEN, '***')
  })
  await step('目录浏览（GET /api/fs/dirs）', async () => {
    const res = await api(`/api/fs/dirs?path=${encodeURIComponent(media)}`)
    const body = await res.json()
    expect(res.ok, JSON.stringify(body))
    return body.dirs.map(d => d.name).join(', ')
  })

  const events = []
  const controller = new AbortController()
  await step('订阅事件（SSE /api/library/events）', async () => {
    const res = await api('/api/library/events', { signal: controller.signal })
    expect(
      res.ok && /event-stream/.test(res.headers.get('content-type')),
      '不是 SSE'
    )
    void (async () => {
      const decoder = new TextDecoder()
      let buffer = ''
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true })
        let index
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, index)
          buffer = buffer.slice(index + 2)
          const data = block.split('\n').find(l => l.startsWith('data: '))
          if (data) events.push(JSON.parse(data.slice(6)))
        }
      }
    })().catch(() => {})
  })

  let lib
  await step('建库（addLibrary，source: jav）', async () => {
    lib = await rpc('addLibrary', { root: media, kind: 'movie', source: 'jav' })
    return `#${lib.id} ${lib.root}`
  })

  let items = []
  await step(
    '扫描 + 番号识别（轮询 query，直到两个番号条目识别完成、海报已缓存）',
    async () => {
      const done = it =>
        it.matchState === 'auto' && /^yingbox-media:/.test(it.poster ?? '')
      for (let i = 0; i < 300; i++) {
        items = (await rpc('query', { libraryId: lib.id, sort: 'title' })).items
        if (items.filter(done).length >= 2) break
        await sleep(100)
      }
      expect(
        items.filter(done).length >= 2,
        `识别未完成：${JSON.stringify(items.map(it => [it.title, it.matchState]))}`
      )
      return items
        .map(it => `${it.title.slice(0, 20)}…[${it.matchState}]`)
        .join(' | ')
    }
  )

  await step('事件推送收到', async () => {
    const types = [...new Set(events.map(e => e.type))]
    expect(
      types.includes('libraries-changed') && types.includes('items-changed'),
      `只收到 ${types.join(',')}`
    )
    return `${events.length} 条：${types.join(', ')}`
  })

  const ssis = items.find(it => /^SSIS-497/.test(it.title))
  await step('条目详情（getItem）', async () => {
    expect(ssis, '没有识别出 SSIS-497')
    const node = await rpc('getItem', { itemId: ssis.id })
    expect(node.files.length >= 1, '没有文件')
    ssis.node = node
    return `${node.files.length} 个文件，poster=${node.poster}`
  })

  await step(
    '取海报缩略图（/media/image/<key>?w=300，wasm 缩放 + WebP）',
    async () => {
      const key = /yingbox-media:\/\/image\/([0-9a-f]{32})/.exec(
        ssis.poster ?? ''
      )?.[1]
      expect(key, `海报不是缓存地址：${ssis.poster}`)
      const res = await api(`/media/image/${key}?w=300`)
      const bytes = new Uint8Array(await res.arrayBuffer())
      expect(res.ok, `HTTP ${res.status}`)
      const type = res.headers.get('content-type')
      expect(/image\/(webp|jpeg)/.test(type), `类型 ${type}`)
      const original = await api(`/media/image/${key}`)
      expect(original.ok, `原图 HTTP ${original.status}`)
      return `${type}，${bytes.length} 字节（原图 ${(await original.arrayBuffer()).byteLength} 字节）`
    }
  )

  await step('远程图片代理（/media/thumb，仅 http(s)）', async () => {
    const bad = await api(
      `/media/thumb?w=300&src=${encodeURIComponent('file:///etc/passwd')}`
    )
    expect(bad.status === 400, `file:// 应被拒，实际 ${bad.status}`)
    return 'file:// → 400'
  })

  await step('视频 Range 流（/media/files/<id>）', async () => {
    const file = ssis.node.files.find(f => f.kind === 'video')
    const res = await api(`/media/files/${file.id}`, {
      headers: { range: 'bytes=0-1023' },
    })
    const bytes = await res.arrayBuffer()
    expect(
      res.status === 206 && bytes.byteLength === 1024,
      `HTTP ${res.status}，${bytes.byteLength} 字节`
    )
    return `206 ${res.headers.get('content-range')}`
  })

  if (!online)
    await step('建库限制在媒体根目录内', async () => {
      const res = await api('/api/library/rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          method: 'addLibrary',
          params: { root: tmpdir(), kind: 'movie' },
        }),
      })
      const body = await res.json()
      expect(
        !body.ok && body.error.code === 'invalid-params',
        JSON.stringify(body)
      )
      return body.error.message
    })

  if (existsSync(join(webDir, 'index.html')))
    await step('托管网页端（GET /）', async () => {
      const res = await fetch(base + '/')
      const html = await res.text()
      expect(res.ok && html.includes('<div id="app"'), `HTTP ${res.status}`)
      return 'index.html'
    })
  controller.abort()
} catch {
  /* 失败已记录 */
} finally {
  child.kill('SIGTERM')
  await new Promise(resolve => child.once('exit', resolve))
  rmSync(work, { recursive: true, force: true })
}

console.log(results.join('\n'))
if (failed) {
  console.log('\n服务日志：\n' + logs)
  process.exit(1)
}
