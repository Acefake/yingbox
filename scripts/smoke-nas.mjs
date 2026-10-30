/** 构建后的 NAS 服务冒烟检查；使用隔离配置，不读取账号、不访问外网。 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

const work = await mkdtemp(join(tmpdir(), 'yingbox-nas-smoke-'))
const media = join(work, 'media')
await mkdir(media)
const token = randomBytes(24).toString('hex')
const environment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !key.startsWith('YINGBOX_') && !key.startsWith('VITE_TMDB')
  )
)
const child = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', resolve('out/nas/server.js')],
  {
    env: {
      ...environment,
      YINGBOX_HOST: '127.0.0.1',
      YINGBOX_PORT: '0',
      YINGBOX_DATA_DIR: join(work, 'config'),
      YINGBOX_CACHE_DIR: join(work, 'cache'),
      YINGBOX_MEDIA_ROOTS: media,
      YINGBOX_WEB_DIR: resolve('dist-nas'),
      YINGBOX_SERVER_TOKEN: token,
      YINGBOX_AUTOGRAB: 'off',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }
)
let output = ''
child.stderr.on('data', data => {
  output += data
})
try {
  const base = await new Promise((resolveBase, reject) => {
    const timer = setTimeout(() => reject(new Error('NAS 启动超时')), 30_000)
    child.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', code => {
      clearTimeout(timer)
      reject(new Error(`NAS 提前退出（${code}）`))
    })
    child.stdout.on('data', data => {
      output += data
      const match = output.match(/片库服务已启动：(http:\/\/127\.0\.0\.1:\d+)/)
      if (match) {
        clearTimeout(timer)
        resolveBase(match[1])
      }
    })
  })
  const call = (path, body, auth = true) =>
    fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(auth ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    })
  assert.equal((await call('/')).status, 200)
  assert.deepEqual(await (await call('/api/health')).json(), {
    ok: true,
    authorized: true,
  })
  assert.equal(
    (await call('/api/library/rpc', { method: 'listLibraries' }, false)).status,
    401
  )
  assert.deepEqual(
    await (await call('/api/library/rpc', { method: 'listLibraries' })).json(),
    { ok: true, result: [] }
  )
  for (const [domain, method] of [
    ['pan115', 'account'],
    ['autograb', 'overview'],
    ['autograbMovies', 'overview'],
    ['autograbUpgrade', 'overview'],
    ['offline', 'tasks'],
    ['discover', 'status'],
  ]) {
    const reply = await (
      await call(`/api/domains/${domain}/${method}`, { args: [] })
    ).json()
    assert.equal(
      reply.ok,
      true,
      `${domain}.${method}: ${JSON.stringify(reply)}`
    )
  }
  assert.equal(
    (await call('/api/engine/rpc', { channel: 'online:tmdb', args: [] }))
      .status,
    404
  )
  assert.equal(
    (await call('/api/stream?src=https://example.com/video.mp4')).status,
    404
  )
  const iptv = await (await call('/api/domains/iptv/list', { args: [] })).json()
  assert.equal(iptv.ok, false)
  assert.equal(
    (await call('/api/metadata/tmdb', { args: ['/search/movie'] }, false))
      .status,
    401
  )
  assert.equal(
    await (
      await call('/api/metadata/tmdb', { args: ['/search/movie'] })
    ).json(),
    null
  )
  await assert.rejects(access(resolve('out/nas/engine.js')))
  console.log(
    'NAS 冒烟检查通过：网页、鉴权、片库、全部网盘域和元数据可用；在线引擎与直播缺席'
  )
} catch (error) {
  console.error(output.replaceAll(token, '[redacted]'))
  throw error
} finally {
  if (child.exitCode === null) {
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    await exited
    clearTimeout(timer)
  }
  await rm(work, { recursive: true, force: true })
}
