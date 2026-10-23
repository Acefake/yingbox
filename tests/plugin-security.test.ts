import { describe, expect, it, vi } from 'vitest'
import { runPlugin } from '../src/engine/online/plugin-runtime'
import { runCatSpider } from '../src/engine/online/catspider'
import { createNetClient } from '../src/shared/net/client'

const run = (
  code: string,
  globals: Record<string, unknown> = {},
  timeout = 500
): Promise<unknown> => runPlugin(code, globals, 'search', undefined, timeout)

describe('插件解释器边界', () => {
  it('没有 Node、模块加载器、原生网络入口；动态 Function 仍留在解释器中', async () => {
    expect(
      await run(`function search() {
      return [typeof process, typeof require, typeof fetch, typeof Buffer,
        Function('return typeof process')(), (async function(){}).constructor('return typeof process')().then(v => v) instanceof Promise];
    }`)
    ).toEqual([
      'undefined',
      'undefined',
      'undefined',
      'undefined',
      'undefined',
      true,
    ])
  })

  it.each([
    `return $fetch.constructor('return process')()`,
    `return $fetch.get.constructor('return process')()`,
    `return createCheerio().load('<p>x</p>').constructor('return process')()`,
    `return Buffer.from('x').constructor.constructor('return process')()`,
    `return Buffer.from('x').subarray.call({length: 8192}, 0, 8192)`,
    `return Buffer.from('x').__defineGetter__('length', () => 8192)`,
    `return Buffer.from('x').buffer`,
  ])('宿主函数与返回对象不能用原型链取得宿主权限：%s', async source => {
    const net = createNetClient({
      lookup: async () => [{ address: '93.184.216.34' }],
      fetch: vi.fn(async () => new Response('x')),
    })
    const result = await runCatSpider(
      {
        net,
        browserFetch: async () => '',
        loadPlugin: async () => `function search() { ${source} }`,
      },
      'test',
      'search',
      {}
    )
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('原型'),
    })
  })

  it('同步死循环、Promise 微任务死循环和永不完成的 Promise 都受总期限约束', async () => {
    for (const body of [
      'while(true) {}',
      'return new Promise(() => {})',
      'return (async () => { while(true) await Promise.resolve() })()',
    ]) {
      await expect(
        run(`function search() { ${body} }`, {}, 30)
      ).rejects.toThrow()
    }
    expect(await run('function search() { return 42 }')).toBe(42)
  })

  it('解释器堆限制和宿主缓冲区额度都生效', async () => {
    await expect(
      run('function search() { return new ArrayBuffer(256 * 1024 * 1024) }')
    ).rejects.toThrow()
    const net = createNetClient({ lookup: async () => [], fetch: vi.fn() })
    expect(
      await runCatSpider(
        {
          net,
          browserFetch: async () => '',
          loadPlugin: async () => `function search() {
      const arrays = []; for (let i = 0; i < 9; i++) arrays.push(Buffer.alloc(4 * 1024 * 1024));
      return arrays.length;
    }`,
        },
        'test',
        'search',
        {}
      )
    ).toMatchObject({
      success: false,
      error: expect.stringContaining('缓冲区'),
    })
  })

  it('拒绝的网络请求不会绕道浏览器代抓，动作完成后取消未完成的直连', async () => {
    const browserFetch = vi.fn(async () => 'private')
    const fetch = vi.fn(async () => new Response('unexpected'))
    const net = createNetClient({
      lookup: async () => [{ address: '93.184.216.34' }],
      fetch,
    })
    expect(
      await runCatSpider(
        {
          net,
          browserFetch,
          loadPlugin: async () =>
            `async function search() { return await $fetch.get('http://127.0.0.1/private') }`,
        },
        'test',
        'search',
        {}
      )
    ).toMatchObject({ success: false })
    expect(browserFetch).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    let signal: AbortSignal | undefined
    const pendingNet = createNetClient({
      lookup: async () => [{ address: '93.184.216.34' }],
      fetch: async (_url, init) => {
        signal = init.signal ?? undefined
        return new Promise((_resolve, reject) =>
          init.signal?.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true }
          )
        )
      },
    })
    await runCatSpider(
      {
        net: pendingNet,
        browserFetch,
        loadPlugin: async () =>
          `async function search() { $fetch.get('https://public.test/a'); await new Promise(r => setTimeout(r, 10)); return 1 }`,
      },
      'test',
      'search',
      {}
    )
    expect(signal?.aborted).toBe(true)
    expect(browserFetch).not.toHaveBeenCalled()
  })

  it('cheerio 回调保留元素 this 与返回值', async () => {
    const net = createNetClient({ lookup: async () => [], fetch: vi.fn() })
    expect(
      await runCatSpider(
        {
          net,
          browserFetch: async () => '',
          loadPlugin: async () => `function search() {
      const $ = createCheerio().load('<li>A</li><li>B</li>');
      return $('li').map(function(i) { return $(this).text() + i }).get();
    }`,
        },
        'test',
        'search',
        {}
      )
    ).toEqual(['A0', 'B1'])
  })

  it('异步宿主错误和顶层脚本错误被收敛，调用结束后清除定时器', async () => {
    await expect(
      run('async function search() { await host() }', {
        host: async () => {
          throw new Error('拒绝请求')
        },
      })
    ).rejects.toThrow('拒绝请求')
    await expect(run('throw new Error("初始化失败")')).rejects.toThrow(
      '初始化失败'
    )
    const host = vi.fn()
    await run('function search() { setTimeout(host, 50); return 1 }', { host })
    await new Promise(resolve => setTimeout(resolve, 70))
    expect(host).not.toHaveBeenCalled()
  })

  it('每次调用独立，宿主仅开放可控接口；CryptoJS、Buffer 与异步计时器兼容', async () => {
    const net = createNetClient({ lookup: async () => [], fetch: vi.fn() })
    const code = `async function search() {
      await new Promise(r => setTimeout(r, 1));
      return { hash: createCryptoJS().MD5('hello').toString(), b64: Buffer.from('hello').toString('base64'),
        other: typeof process, network: typeof fetch, fs: typeof require, fromURL: typeof createCheerio().fromURL };
    }`
    expect(
      await runCatSpider(
        { net, browserFetch: async () => '', loadPlugin: async () => code },
        'test',
        'search',
        {}
      )
    ).toEqual({
      hash: '5d41402abc4b2a76b9719d911017c592',
      b64: 'aGVsbG8=',
      other: 'undefined',
      network: 'undefined',
      fs: 'undefined',
      fromURL: 'undefined',
    })
    await run('globalThis.leaked = 1; function search() { return 1 }')
    expect(await run('function search() { return typeof leaked }')).toBe(
      'undefined'
    )
  })
})
