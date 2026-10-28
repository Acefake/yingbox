import { type Server, createServer } from 'node:http'
import { join } from 'node:path'
import { FileSecretStore } from '../../src/server/secrets'
import { afterEach, expect, it, vi } from 'vitest'
import { type Harness, startServer } from './server-harness'

let server: Harness | undefined
let upstream: Server | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
  await new Promise<void>(resolve =>
    upstream ? upstream.close(() => resolve()) : resolve()
  )
  upstream = undefined
})

function rpc(
  domain: string,
  method: string,
  args: unknown[] = []
): Promise<Response> {
  return server!.call(`/api/domains/${domain}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ args }),
  })
}

it('关闭网盘仍可访问直播与通知域，密钥只返回配置状态', async () => {
  server = await startServer({
    fetch: async () => new Response('{}'),
    env: { YINGBOX_ONLINE: 'off', YINGBOX_NETDISK: 'off' },
  })
  const call = (
    domain: string,
    method: string,
    args: unknown[] = []
  ): Promise<Response> =>
    server!.call(`/api/domains/${domain}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args }),
    })
  expect(await (await call('notifications', 'configured')).json()).toEqual({
    ok: true,
    value: { bark: false, telegram: false },
  })
  expect(
    await (
      await call('notifications', 'setSecret', ['bark', 'device-secret'])
    ).json()
  ).toEqual({ ok: true, value: null })
  expect(await (await call('notifications', 'configured')).json()).toEqual({
    ok: true,
    value: { bark: true, telegram: false },
  })
  const playlist = await (
    await call('iptv', 'readPlaylistFile', ['/etc/passwd'])
  ).json()
  expect(playlist.ok).toBe(true)
  expect(playlist.value.ok).toBe(false)
  const unauthorized = await server.call(
    '/api/domains/notifications/configured',
    { auth: false, method: 'POST', body: JSON.stringify({ args: [] }) }
  )
  expect(unauthorized.status).toBe(401)
})

it('NAS 直播读取列表、探测、XMLTV 与播放代理共用内网白名单', async () => {
  const timestamp = (ms: number): string =>
    `${new Date(ms).toISOString().replace(/\D/g, '').slice(0, 14)} +0000`
  const now = Date.now()
  let origin = ''
  upstream = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
    if (req.url === '/epg')
      res.end(
        `<tv><channel id="one"><display-name>频道一</display-name></channel><programme channel="one" start="${timestamp(now - 60000)}" stop="${timestamp(now + 60000)}"><title>测试节目</title></programme></tv>`
      )
    else
      res.end(
        `#EXTM3U\n#EXTINF:-1 tvg-id="one",频道一\n${origin}/channel.m3u8\n`
      )
  })
  await new Promise<void>(resolve => upstream!.listen(0, '127.0.0.1', resolve))
  const address = upstream.address()
  if (!address || typeof address === 'string') throw new Error('没有监听端口')
  origin = `http://127.0.0.1:${address.port}`
  server = await startServer({
    fetch: async () => new Response('{}'),
    env: { YINGBOX_ONLINE: 'off', YINGBOX_NETDISK: 'off' },
  })
  expect(
    (await (await rpc('iptv', 'fetchPlaylist', [origin])).json()).value.ok
  ).toBe(false)
  await server.close()
  server = await startServer({
    fetch: async () => new Response('{}'),
    env: {
      YINGBOX_ONLINE: 'off',
      YINGBOX_NETDISK: 'off',
      YINGBOX_STREAM_ALLOW_PRIVATE: '127.0.0.1',
    },
  })
  expect(
    (await (await rpc('iptv', 'fetchPlaylist', [origin])).json()).value.text
  ).toContain('频道一')
  expect(
    (await (await rpc('iptv', 'probeStream', [origin])).json()).value.kind
  ).toBe('hls')
  expect(
    (await (await rpc('iptv', 'loadEpg', [`${origin}/epg`, false])).json())
      .value.ok
  ).toBe(true)
  const programmes = (
    await (
      await rpc('iptv', 'epgProgrammes', [
        `${origin}/epg`,
        [{ key: 'one', tvgId: 'one', names: ['频道一'] }],
        now - 120000,
        now + 120000,
      ])
    ).json()
  ).value
  expect(programmes.data.one[0].title).toBe('测试节目')
  const proxy = await server.call(
    `/api/stream?src=${encodeURIComponent(`${origin}/channel.m3u8`)}`
  )
  expect(proxy.status).toBe(200)
  expect(await proxy.text()).toContain('/api/stream?')
})

it('Bark 密钥与配置持久化，测试推送和真实入库发送且不重复', async () => {
  const send = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => '{"code":200}',
  }))
  server = await startServer({
    fetch: async () => new Response('{}'),
    notifyFetch: send,
    env: { YINGBOX_ONLINE: 'off', YINGBOX_NETDISK: 'off' },
  })
  for (const [key, value] of Object.entries({
    'notify.bark.enabled': true,
    'notify.merge': false,
  })) {
    const res = await server.call('/api/server-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    })
    expect(res.status).toBe(200)
  }
  await rpc('notifications', 'setSecret', ['bark', 'test-device-secret'])
  expect(
    new FileSecretStore(join(server.work, 'data', 'secrets.json')).get(
      'notify.bark.key'
    )
  ).toBe('test-device-secret')
  expect(
    (await (await rpc('notifications', 'test', ['bark'])).json()).value.ok
  ).toBe(true)
  expect(send).toHaveBeenCalledTimes(1)
  server.write('movies/Dune (2021)/Dune.mkv', 32)
  await server.app.service.addLibrary({
    root: join(server.media, 'movies'),
    kind: 'movie',
    automation: { identify: false },
  })
  await server.app.service.queue.idle()
  server.app.service.intake.arrivals.sweep()
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
  server.app.service.intake.arrivals.sweep()
  expect(send).toHaveBeenCalledTimes(2)
  expect(send.mock.calls[1]).toBeDefined()
  expect(
    JSON.stringify(await (await server.call('/api/server-settings')).json())
  ).not.toContain('test-device-secret')
  expect(
    (
      await (
        await rpc('notifications', 'setSecret', ['bark', '\ninvalid'])
      ).json()
    ).ok
  ).toBe(false)
  expect(
    (await (await rpc('notifications', 'test', ['system'])).json()).value.ok
  ).toBe(false)
})
