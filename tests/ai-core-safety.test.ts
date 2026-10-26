import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { chatCompletion } from '../src/main/ai/client'
import {
  type AiConfig,
  assertPrivacy,
  assertUsable,
  resolveAiConfig,
} from '../src/main/ai/config'
import { parseJsonLoose, removeTrailingCommas } from '../src/main/ai/json'
import { createAiService } from '../src/main/ai/service'
import { createUsageStore } from '../src/main/ai/usage'
import {
  effectiveAiBaseUrl,
  isLocalAiProvider,
} from '../src/shared/ai/providers'

/**
 * AI 基础层的安全边界：本地性按实际接口地址判定、流内 error 事件按失败处理、
 * JSON 尾逗号修复不改字符串内容。网络全部用 mock fetch。
 * test-affected: repo-wide（读取设置页源码做断言）
 */

const config = (over: Partial<AiConfig> = {}): AiConfig => ({
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  apiKey: 'sk-test',
  local: false,
  jsonSchema: false,
  ...over,
})

const sseResponse = (parts: string[]): Response =>
  new Response(
    new ReadableStream({
      start(controller) {
        const enc = new TextEncoder()
        for (const p of parts) controller.enqueue(enc.encode(p))
        controller.close()
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
  )

const chunk = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n\n`

describe('本地性按实际接口地址判定', () => {
  it('Ollama 留空用预设地址，算本地', () => {
    expect(effectiveAiBaseUrl('ollama', '')).toBe('http://127.0.0.1:11434/v1')
    const c = resolveAiConfig(
      { provider: 'ollama', baseUrl: '', model: '' },
      () => ''
    )
    expect(c.local).toBe(true)
    expect(() => assertPrivacy(c, true, true)).not.toThrow()
  })

  it('Ollama 填公网地址：不算本地，明文 http 不可用，私密内容被拒', () => {
    const c = resolveAiConfig(
      { provider: 'ollama', baseUrl: 'http://public.example/v1', model: 'q' },
      () => ''
    )
    expect(c.local).toBe(false)
    expect(() => assertUsable(c)).toThrow(/https/)
    const https = resolveAiConfig(
      { provider: 'ollama', baseUrl: 'https://public.example/v1', model: 'q' },
      () => ''
    )
    expect(https.local).toBe(false)
    expect(() => assertPrivacy(https, true, true)).toThrow(/私密/)
  })

  it('Ollama 指向局域网 / .local 仍算本地', () => {
    expect(isLocalAiProvider('ollama', 'http://192.168.1.5:11434/v1')).toBe(
      true
    )
    expect(isLocalAiProvider('ollama', 'http://nas.local:11434/v1')).toBe(true)
    expect(isLocalAiProvider('ollama', 'http://8.8.8.8:11434/v1')).toBe(false)
  })

  it('私密请求 + 公网 Ollama：服务层不发请求直接拒绝', async () => {
    const fetch = vi.fn()
    const service = createAiService({
      settings: {
        chat: () => ({
          provider: 'ollama',
          baseUrl: 'https://ollama.example.com/v1',
          model: 'q',
        }),
        privateLocalOnly: () => true,
        speech: () => ({ engine: 'off', model: '', baseUrl: '' }),
        secret: () => '',
      },
      fetch,
      usage: createUsageStore({
        read: async () => null,
        write: async () => {},
      }),
    })
    await expect(
      service.chat({
        messages: [{ role: 'user', content: 'x' }],
        private: true,
      })
    ).rejects.toMatchObject({ code: 'private_blocked' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('设置页提示与主进程共用 isLocalAiProvider，不按服务商名称放行', () => {
    const source = readFileSync(
      'src/renderer/src/features/settings/sections/AiSettings.vue',
      'utf8'
    )
    expect(source).toContain('isLocalAiProvider(provider.value, baseUrl.value)')
    expect(source).not.toMatch(/provider\.value === 'ollama' \|\|/)
  })
})

describe('流式响应里的 error 事件', () => {
  it('只有 error 事件：抛 AiError，带服务商说明与状态码', async () => {
    const parts = [
      chunk({ error: { message: 'upstream failed', code: 500 } }),
      'data: [DONE]\n\n',
    ]
    await expect(
      chatCompletion(
        config(),
        { messages: [{ role: 'user', content: 'q' }] },
        { fetch: async () => sseResponse(parts), onDelta: () => {}, retries: 0 }
      )
    ).rejects.toMatchObject({
      code: 'http',
      status: 500,
      message: expect.stringContaining('upstream failed'),
    })
  })

  it('增量之后出错：抛错，不把部分内容当完整回答，也不重试', async () => {
    const fetch = vi.fn(async () =>
      sseResponse([
        chunk({ choices: [{ delta: { content: '半句' } }] }),
        chunk({ error: { message: 'overloaded', code: 503 } }),
      ])
    )
    const deltas: string[] = []
    await expect(
      chatCompletion(
        config(),
        { messages: [{ role: 'user', content: 'q' }] },
        { fetch, onDelta: d => deltas.push(d), sleep: async () => {} }
      )
    ).rejects.toMatchObject({ code: 'http', status: 503 })
    expect(deltas).toEqual(['半句'])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('字符串形式的 error、无状态码：bad_response', async () => {
    await expect(
      chatCompletion(
        config(),
        { messages: [{ role: 'user', content: 'q' }] },
        {
          fetch: async () => sseResponse([chunk({ error: 'quota exceeded' })]),
          onDelta: () => {},
        }
      )
    ).rejects.toMatchObject({
      code: 'bad_response',
      message: expect.stringContaining('quota exceeded'),
    })
  })

  it('服务层：流内错误不累计成功用量', async () => {
    const onUsage = vi.fn()
    const usage = createUsageStore({
      read: async () => null,
      write: async () => {},
    })
    const service = createAiService({
      settings: {
        chat: () => ({ provider: 'deepseek', baseUrl: '', model: '' }),
        privateLocalOnly: () => true,
        speech: () => ({ engine: 'off', model: '', baseUrl: '' }),
        secret: () => 'sk-test',
      },
      fetch: async () =>
        sseResponse([chunk({ error: { message: 'bad', code: 400 } })]),
      usage,
      onUsage,
    })
    await expect(
      service.chat(
        { messages: [{ role: 'user', content: 'q' }] },
        { onDelta: () => {} }
      )
    ).rejects.toMatchObject({ code: 'http', status: 400 })
    expect(onUsage).not.toHaveBeenCalled()
    expect((await usage.summary()).current.requests).toBe(0)
  })

  it('error 为 null 的普通分片照常处理', async () => {
    const result = await chatCompletion(
      config(),
      { messages: [{ role: 'user', content: 'q' }] },
      {
        fetch: async () =>
          sseResponse([
            chunk({ error: null, choices: [{ delta: { content: '好' } }] }),
            'data: [DONE]\n\n',
          ]),
        onDelta: () => {},
      }
    )
    expect(result.content).toBe('好')
  })
})

describe('JSON 尾逗号修复只动字符串外', () => {
  it('字符串里的 ,} / ,] 原样保留', () => {
    expect(parseJsonLoose('{"text":"literal ,}",}')).toEqual({
      text: 'literal ,}',
    })
    expect(parseJsonLoose('["a ,]", "b",]')).toEqual(['a ,]', 'b'])
  })

  it('转义引号与反斜杠不打乱字符串状态', () => {
    expect(parseJsonLoose('{"a":"x\\",}","b":"c\\\\",}')).toEqual({
      a: 'x",}',
      b: 'c\\',
    })
  })

  it('嵌套、换行空白里的尾逗号都去掉', () => {
    expect(removeTrailingCommas('{"a":[1,2 ,\n],\n "b":{"c":1,},\n}')).toBe(
      '{"a":[1,2 \n],\n "b":{"c":1}\n}'
    )
  })
})

describe('流式响应中途断开', () => {
  const ask = { messages: [{ role: 'user' as const, content: 'q' }] }
  const delta = (content: string): string =>
    chunk({ choices: [{ delta: { content } }] })

  it('两样都不发但正常关闭、收到过正文：兼容为完成（服务商不发收尾标记）', async () => {
    const fetch = vi.fn(async () => sseResponse([delta('前半'), delta('句')]))
    const seen: string[] = []
    const result = await chatCompletion(config(), ask, {
      fetch,
      onDelta: d => seen.push(d),
      retries: 2,
      sleep: async () => {},
    })
    expect(result.content).toBe('前半句')
    expect(result.finishReason).toBe('')
    expect(seen).toEqual(['前半', '句'])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('最后一个事件是半截 JSON：抛 network、标记不可重试，不重试', async () => {
    const fetch = vi.fn(async () =>
      sseResponse([delta('前半'), 'data: {"choices":[{"delta":{"con'])
    )
    const seen: string[] = []
    const error = await chatCompletion(config(), ask, {
      fetch,
      onDelta: d => seen.push(d),
      retries: 2,
      sleep: async () => {},
    }).catch(e => e)
    expect(error).toMatchObject({
      code: 'network',
      retryable: false,
      message: expect.stringContaining('中途断开'),
    })
    expect(seen).toEqual(['前半'])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('只有思考增量、没有正文就断开：按网络错误重试，不把思考当回答', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          chunk({ choices: [{ delta: { reasoning_content: '想' } }] }),
        ])
      )
      .mockResolvedValueOnce(
        sseResponse([
          chunk({
            choices: [{ delta: { content: '好' }, finish_reason: 'stop' }],
          }),
        ])
      )
    const result = await chatCompletion(config(), ask, {
      fetch,
      onDelta: () => {},
      retries: 1,
      sleep: async () => {},
    })
    expect(result.content).toBe('好')
    expect(result.reasoning).toBe('')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('finish_reason 为 length：正常截断，算完成', async () => {
    const result = await chatCompletion(config(), ask, {
      fetch: async () =>
        sseResponse([
          chunk({
            choices: [{ delta: { content: '截' }, finish_reason: 'length' }],
          }),
        ]),
      onDelta: () => {},
      retries: 0,
    })
    expect(result.content).toBe('截')
    expect(result.finishReason).toBe('length')
  })

  it('还没推出增量就断开：按网络错误重试', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(sseResponse([': ping\n\n']))
      .mockResolvedValueOnce(
        sseResponse([
          chunk({
            choices: [{ delta: { content: '好' }, finish_reason: 'stop' }],
          }),
        ])
      )
    const result = await chatCompletion(config(), ask, {
      fetch,
      onDelta: () => {},
      retries: 1,
      sleep: async () => {},
    })
    expect(result.content).toBe('好')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('有 finish_reason 但没发 [DONE]、或只发 [DONE]：照常算完成', async () => {
    const finished = await chatCompletion(config(), ask, {
      fetch: async () =>
        sseResponse([
          chunk({
            choices: [{ delta: { content: '完' }, finish_reason: 'stop' }],
          }),
        ]),
      onDelta: () => {},
      retries: 0,
    })
    expect(finished.content).toBe('完')
    const doneOnly = await chatCompletion(config(), ask, {
      fetch: async () => sseResponse([delta('完'), 'data: [DONE]\n\n']),
      onDelta: () => {},
      retries: 0,
    })
    expect(doneOnly.content).toBe('完')
  })
})
