/**
 * 手动重定向 fetch（src/main/manual-redirect-fetch.ts）：Electron 37 的 net.fetch 遇到 redirect: 'manual'
 * 会抛 Redirect was cancelled，这里用假的 net.request 验证改走 ClientRequest 后的行为。
 * 真实 Electron 下的验证见 PR 说明（重定向、Referer / Range 转发、gzip 解码）。
 */
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

import { manualRedirectFetch } from '../src/main/manual-redirect-fetch'

/** 假 ClientRequest：记录选项与请求头，由测试触发事件 */
class FakeRequest extends EventEmitter {
  headers: Record<string, string> = {}
  aborted = false
  ended = false
  written = ''
  constructor(readonly options: Record<string, unknown>) {
    super()
  }
  setHeader(name: string, value: string): void {
    this.headers[name] = value
  }
  write(body: string): void {
    this.written += body
  }
  end(): void {
    this.ended = true
  }
  abort(): void {
    if (this.aborted) return
    this.aborted = true
    this.emit('abort')
  }
}

/** 假 IncomingMessage */
class FakeResponse extends EventEmitter {
  paused = false
  constructor(
    readonly statusCode: number,
    readonly headers: Record<string, string | string[]>,
    readonly statusMessage = 'OK'
  ) {
    super()
  }
  pause(): void {
    this.paused = true
  }
  resume(): void {
    this.paused = false
  }
}

function setup(): {
  fetch: ReturnType<typeof manualRedirectFetch>
  fallback: ReturnType<typeof vi.fn>
  last: () => FakeRequest
} {
  const requests: FakeRequest[] = []
  const fallback = vi.fn(async () => new Response('fallback'))
  const fetch = manualRedirectFetch(options => {
    const req = new FakeRequest(options as Record<string, unknown>)
    requests.push(req)
    return req as never
  }, fallback)
  return { fetch, fallback, last: () => requests[requests.length - 1] }
}

describe('手动重定向 fetch', () => {
  it('不是 manual 时交给 net.fetch', async () => {
    const { fetch, fallback } = setup()
    const res = await fetch('https://a/x', { redirect: 'follow' })
    expect(await res.text()).toBe('fallback')
    expect(fallback).toHaveBeenCalledTimes(1)
  })

  it('重定向：返回带 Location 的 3xx 空响应并取消原请求（不跟随）', async () => {
    const { fetch, last } = setup()
    const pending = fetch('http://a/api?id=1', { redirect: 'manual' })
    const req = last()
    expect(req.options).toMatchObject({
      url: 'http://a/api?id=1',
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      useSessionCookies: false,
    })
    req.emit('redirect', 302, 'GET', 'http://b/live/index.m3u8', {})
    const res = await pending
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://b/live/index.m3u8')
    expect(req.aborted).toBe(true)
  })

  it('请求头逐个设置；带 Referer 时引用策略设为 unsafe-url', async () => {
    const { fetch, last } = setup()
    void fetch('http://a/x', {
      redirect: 'manual',
      headers: {
        Referer: 'https://ref/',
        Range: 'bytes=0-',
        'User-Agent': 'UA',
      },
    })
    const req = last()
    expect(req.options.referrerPolicy).toBe('unsafe-url')
    expect(req.headers).toMatchObject({
      referer: 'https://ref/',
      range: 'bytes=0-',
      'user-agent': 'UA',
    })
    expect(req.ended).toBe(true)
    void fetch('http://a/y', { redirect: 'manual' })
    expect(last().options.referrerPolicy).toBeUndefined()
  })

  it('正常响应：状态码、多值响应头与流式响应体', async () => {
    const { fetch, last } = setup()
    const pending = fetch('http://a/x.m3u8', { redirect: 'manual' })
    const res206 = new FakeResponse(206, {
      'content-type': 'video/mp2t',
      'set-cookie': ['a=1', 'b=2'],
    })
    last().emit('response', res206)
    const res = await pending
    expect(res.status).toBe(206)
    expect(res.headers.get('content-type')).toBe('video/mp2t')
    res206.emit('data', Buffer.from('AB'))
    res206.emit('data', Buffer.from('C'))
    res206.emit('end')
    expect(await res.text()).toBe('ABC')
  })

  it('204 / 304 没有响应体', async () => {
    const { fetch, last } = setup()
    const pending = fetch('http://a/x', { redirect: 'manual' })
    last().emit('response', new FakeResponse(304, {}))
    expect((await pending).body).toBeNull()
  })

  it('取消响应体会中止请求', async () => {
    const { fetch, last } = setup()
    const pending = fetch('http://a/live.flv', { redirect: 'manual' })
    const req = last()
    req.emit('response', new FakeResponse(200, {}))
    const res = await pending
    await res.body!.cancel()
    expect(req.aborted).toBe(true)
  })

  it('网络错误与外部取消都以失败结束', async () => {
    const { fetch, last } = setup()
    const failing = fetch('http://a/x', { redirect: 'manual' })
    last().emit('error', new Error('net::ERR_CONNECTION_REFUSED'))
    await expect(failing).rejects.toThrow('ERR_CONNECTION_REFUSED')

    const controller = new AbortController()
    const aborted = fetch('http://a/x', {
      redirect: 'manual',
      signal: controller.signal,
    })
    const req = last()
    controller.abort()
    await expect(aborted).rejects.toBeTruthy()
    expect(req.aborted).toBe(true)

    const pre = new AbortController()
    pre.abort()
    await expect(
      fetch('http://a/x', { redirect: 'manual', signal: pre.signal })
    ).rejects.toBeTruthy()
  })

  it('响应体读到一半被外部取消：Electron 只发 close，读取方以失败结束而不是一直等', async () => {
    const { fetch, last } = setup()
    const controller = new AbortController()
    const pending = fetch('http://a/seg.ts', {
      redirect: 'manual',
      signal: controller.signal,
    })
    const req = last()
    const upstream = new FakeResponse(200, {})
    req.emit('response', upstream)
    const reader = (await pending).body!.getReader()
    upstream.emit('data', Buffer.from('AB'))
    expect((await reader.read()).value).toEqual(new Uint8Array([65, 66]))
    controller.abort()
    expect(req.aborted).toBe(true)
    // Electron 37：abort() → response.destroy()，只有 close
    upstream.emit('close')
    await expect(reader.read()).rejects.toThrow('连接中断')
  })

  it('正常结束后的 close、取消后的迟到事件都不会抛错', async () => {
    const { fetch, last } = setup()
    const first = fetch('http://a/x', { redirect: 'manual' })
    const done = new FakeResponse(200, {})
    last().emit('response', done)
    const res = await first
    done.emit('data', Buffer.from('A'))
    done.emit('end')
    expect(() => done.emit('close')).not.toThrow()
    expect(await res.text()).toBe('A')

    const second = fetch('http://a/y', { redirect: 'manual' })
    const late = new FakeResponse(200, {})
    last().emit('response', late)
    await (await second).body!.cancel()
    expect(() => {
      late.emit('data', Buffer.from('B'))
      late.emit('end')
      late.emit('close')
    }).not.toThrow()
  })

  it('POST 写入请求体', async () => {
    const { fetch, last } = setup()
    void fetch('http://a/x', {
      redirect: 'manual',
      method: 'POST',
      body: 'k=v',
    })
    expect(last().options.method).toBe('POST')
    expect(last().written).toBe('k=v')
  })
})
