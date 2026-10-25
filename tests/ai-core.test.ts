import { describe, expect, it, vi } from 'vitest'
import {
  buildChatBody,
  buildHeaders,
  chatCompletion,
} from '../src/main/ai/client'
import {
  type AiConfig,
  assertPrivacy,
  assertUsable,
  resolveAiConfig,
  resolveSpeechConfig,
} from '../src/main/ai/config'
import { AiError } from '../src/main/ai/errors'
import { parseJsonLoose } from '../src/main/ai/json'
import { type AiServiceSettings, createAiService } from '../src/main/ai/service'
import { createSseParser } from '../src/main/ai/sse'
import {
  type UsageStore,
  addUsage,
  createUsageStore,
  monthKey,
  parseUsageFile,
} from '../src/main/ai/usage'
import {
  formatMonthUsage,
  formatTokens,
} from '../src/renderer/src/features/ai/format'
import {
  AI_PROVIDERS,
  aiKeySecret,
  isLocalEndpoint,
} from '../src/shared/ai/providers'
import { parseAiErrorMessage } from '../src/shared/ai/types'
import { parseChatRequest, parseJsonRequest } from '../src/shared/contract/ai'

/**
 * AI 基础层：预设与配置解析、请求构造、流式 / 非流式、重试与取消、私密拒绝、用量累计、JSON 容错。
 * 网络全部用 mock fetch。
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

const jsonResponse = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

const completion = (
  content: string,
  usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
): Response =>
  jsonResponse({
    model: 'deepseek-chat',
    choices: [
      { message: { role: 'assistant', content }, finish_reason: 'stop' },
    ],
    usage,
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

const noSleep = async (_ms: number, _signal: AbortSignal): Promise<void> => {}

describe('服务商预设与配置', () => {
  it('六个预设，Ollama 不需要 Key 也没有密钥项', () => {
    expect(AI_PROVIDERS.map(p => p.id)).toEqual([
      'openai',
      'deepseek',
      'openrouter',
      'opencode-go',
      'ollama',
      'custom',
    ])
    expect(aiKeySecret('ollama')).toBeNull()
    expect(aiKeySecret('deepseek')).toBe('ai.apiKey.deepseek')
  })

  it('空的地址 / 模型回落预设，Key 取对应服务商的密钥', () => {
    const getSecret = vi.fn(() => ' sk-1 ')
    const c = resolveAiConfig(
      { provider: 'openrouter', baseUrl: '', model: '' },
      getSecret
    )
    expect(c).toMatchObject({
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-4o-mini',
      apiKey: 'sk-1',
      local: false,
      jsonSchema: true,
    })
    expect(getSecret).toHaveBeenCalledWith('ai.apiKey.openrouter')
  })

  it('OpenCode Go：Chat Completions 接口、便宜的 chat 模型、独立密钥、JSON 模式', () => {
    const getSecret = vi.fn(() => 'oc-key')
    const c = resolveAiConfig(
      { provider: 'opencode-go', baseUrl: '', model: '' },
      getSecret
    )
    expect(c).toMatchObject({
      provider: 'opencode-go',
      baseUrl: 'https://opencode.ai/inference/go/openai/v1',
      model: 'glm-5.3-flash',
      apiKey: 'oc-key',
      local: false,
      jsonSchema: false,
    })
    expect(getSecret).toHaveBeenCalledWith('ai.apiKey.opencode-go')
    expect(aiKeySecret('opencode-go')).toBe('ai.apiKey.opencode-go')
    const preset = AI_PROVIDERS.find(p => p.id === 'opencode-go')
    expect(preset).toMatchObject({ label: 'OpenCode Go', needsKey: true })
    expect(preset?.modelHint).toContain('Chat Completions')
  })

  it('自定义地址去掉结尾斜杠；指向局域网算本地', () => {
    const c = resolveAiConfig(
      {
        provider: 'custom',
        baseUrl: 'http://192.168.1.20:1234/v1/',
        model: 'qwen',
      },
      () => ''
    )
    expect(c.baseUrl).toBe('http://192.168.1.20:1234/v1')
    expect(c.local).toBe(true)
    expect(() => assertUsable(c)).not.toThrow()
  })

  it('本地判定', () => {
    expect(isLocalEndpoint('http://127.0.0.1:11434/v1')).toBe(true)
    expect(isLocalEndpoint('http://localhost:8080')).toBe(true)
    expect(isLocalEndpoint('http://[::1]:8080')).toBe(true)
    expect(isLocalEndpoint('http://nas.local/v1')).toBe(true)
    expect(isLocalEndpoint('http://172.20.0.2/v1')).toBe(true)
    expect(isLocalEndpoint('https://api.openai.com/v1')).toBe(false)
    expect(isLocalEndpoint('http://172.32.0.1')).toBe(false)
    expect(isLocalEndpoint('not a url')).toBe(false)
  })

  it('缺 Key / 缺模型 / 云端 http 时拒绝', () => {
    const code = (fn: () => void): string | undefined => {
      try {
        fn()
      } catch (e) {
        return (e as AiError).code
      }
      return undefined
    }
    expect(code(() => assertUsable(config({ apiKey: '' })))).toBe(
      'not_configured'
    )
    expect(code(() => assertUsable(config({ model: '' })))).toBe(
      'not_configured'
    )
    expect(
      code(() => assertUsable(config({ baseUrl: 'http://api.example.com/v1' })))
    ).toBe('not_configured')
    expect(
      code(() => assertUsable(config({ provider: 'custom', baseUrl: '' })))
    ).toBe('not_configured')
    expect(code(() => assertUsable(config()))).toBeUndefined()
  })

  it('语音识别：云端留空沿用对话接口与 Key，本地不带 Key', () => {
    const chat = config()
    expect(
      resolveSpeechConfig(
        { engine: 'cloud', model: 'whisper-1', baseUrl: '' },
        chat
      )
    ).toEqual({
      engine: 'cloud',
      model: 'whisper-1',
      baseUrl: chat.baseUrl,
      apiKey: 'sk-test',
    })
    expect(
      resolveSpeechConfig(
        { engine: 'local-whisper', model: 'large-v3-turbo', baseUrl: 'x' },
        chat
      ).apiKey
    ).toBe('')
  })
})

describe('私密内容', () => {
  it('开关打开 + 非本地服务商 → private_blocked；本地或开关关闭放行', () => {
    expect(() => assertPrivacy(config(), true, true)).toThrowError(
      /\[ai:private_blocked\]/
    )
    expect(() =>
      assertPrivacy(config({ local: true }), true, true)
    ).not.toThrow()
    expect(() => assertPrivacy(config(), true, false)).not.toThrow()
    expect(() => assertPrivacy(config(), false, true)).not.toThrow()
  })
})

describe('请求构造', () => {
  const request = {
    messages: [{ role: 'user' as const, content: '你好' }],
    temperature: 0.2,
    maxTokens: 50,
  }

  it('非流式：模型、消息、温度、max_tokens，Bearer 头', () => {
    expect(buildChatBody(config(), request, { stream: false })).toEqual({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: '你好' }],
      temperature: 0.2,
      max_tokens: 50,
    })
    expect(buildHeaders(config(), false).Authorization).toBe('Bearer sk-test')
    expect(
      buildHeaders(config({ apiKey: '' }), false).Authorization
    ).toBeUndefined()
    expect(
      buildHeaders(config({ provider: 'openrouter' }), false)['X-Title']
    ).toBe('yingbox')
  })

  it('OpenCode Go：Bearer 鉴权、自报 User-Agent，请求发到 /chat/completions', async () => {
    const oc = config({
      provider: 'opencode-go',
      baseUrl: 'https://opencode.ai/inference/go/openai/v1',
      model: 'glm-5.3-flash',
      apiKey: 'oc-key',
    })
    const headers = buildHeaders(oc, false)
    expect(headers.Authorization).toBe('Bearer oc-key')
    expect(headers['User-Agent']).toBe('yingbox')
    expect(buildHeaders(config(), false)['User-Agent']).toBeUndefined()
    // 官方要求每段对话带稳定的 x-opencode-session，缺了直接 400
    const session = headers['x-opencode-session']
    expect(session).toMatch(/^yingbox-/)
    expect(buildHeaders(oc, true)['x-opencode-session']).toBe(session)
    expect(buildHeaders(oc, false, 'qa-42')['x-opencode-session']).toBe(
      'yingbox-qa-42'
    )
    expect(buildHeaders(config(), false)['x-opencode-session']).toBeUndefined()

    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      completion('好')
    )
    const result = await chatCompletion(
      oc,
      { messages: [{ role: 'user', content: 'q' }] },
      { fetch }
    )
    expect(fetch.mock.calls[0][0]).toBe(
      'https://opencode.ai/inference/go/openai/v1/chat/completions'
    )
    expect(JSON.parse(String(fetch.mock.calls[0][1]!.body)).model).toBe(
      'glm-5.3-flash'
    )
    expect(result).toMatchObject({ content: '好', provider: 'opencode-go' })
  })

  it('流式要求返回 usage；请求里的 model 覆盖设置', () => {
    const body = buildChatBody(
      config(),
      { ...request, model: 'deepseek-reasoner' },
      { stream: true }
    )
    expect(body).toMatchObject({
      model: 'deepseek-reasoner',
      stream: true,
      stream_options: { include_usage: true },
    })
  })

  it('JSON：支持 schema 的服务商用 json_schema，否则 json_object + 系统提示', () => {
    const schema = { type: 'object', properties: { title: { type: 'string' } } }
    const openai = buildChatBody(
      config({ provider: 'openai', jsonSchema: true }),
      request,
      {
        stream: false,
        json: { schema, schemaName: 'pick' },
      }
    )
    expect(openai.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'pick', schema, strict: true },
    })
    const deepseek = buildChatBody(config(), request, {
      stream: false,
      json: { schema },
    })
    expect(deepseek.response_format).toEqual({ type: 'json_object' })
    const messages = deepseek.messages as Array<{
      role: string
      content: string
    }>
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('JSON')
    expect(request.messages).toHaveLength(1)
  })
})

describe('客户端：发送、重试、超时、取消、流式', () => {
  it('非流式：POST 到 /chat/completions，返回内容与 usage', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      completion('答')
    )
    const result = await chatCompletion(
      config(),
      { messages: [{ role: 'user', content: 'q' }] },
      { fetch }
    )
    expect(fetch.mock.calls[0][0]).toBe(
      'https://api.deepseek.com/v1/chat/completions'
    )
    expect(result).toMatchObject({
      content: '答',
      provider: 'deepseek',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })
  })

  it('429 / 5xx 重试，401 不重试', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'busy' } }, 503))
      .mockResolvedValueOnce(jsonResponse({}, 429, { 'retry-after': '1' }))
      .mockResolvedValueOnce(completion('ok'))
    const sleep = vi.fn(noSleep)
    const result = await chatCompletion(
      config(),
      { messages: [{ role: 'user', content: 'q' }] },
      { fetch, sleep }
    )
    expect(result.content).toBe('ok')
    expect(sleep.mock.calls.map(c => c[0])).toEqual([800, 1000])

    const unauthorized = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ error: { message: 'bad key' } }, 401)
    )
    await expect(
      chatCompletion(
        config(),
        { messages: [{ role: 'user', content: 'q' }] },
        { fetch: unauthorized, sleep }
      )
    ).rejects.toMatchObject({ code: 'http', status: 401 })
    expect(unauthorized).toHaveBeenCalledTimes(1)
  })

  it('超时报 timeout；外部取消报 cancelled', async () => {
    const hang = (_url: string, init: RequestInit): Promise<Response> =>
      new Promise((_, reject) =>
        init.signal?.addEventListener('abort', () =>
          reject(new Error('aborted'))
        )
      )
    await expect(
      chatCompletion(
        config(),
        { messages: [{ role: 'user', content: 'q' }], timeoutMs: 20 },
        { fetch: hang, retries: 0 }
      )
    ).rejects.toMatchObject({ code: 'timeout' })

    const controller = new AbortController()
    const pending = chatCompletion(
      config(),
      { messages: [{ role: 'user', content: 'q' }] },
      { fetch: hang, signal: controller.signal }
    )
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('流式：增量回调、拼出全文、取最后一块的 usage', async () => {
    const chunk = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n\n`
    const parts = [
      ': keep-alive\n\n',
      chunk({
        model: 'deepseek-chat',
        choices: [{ delta: { content: '你' } }],
      }),
      chunk({
        choices: [{ delta: { content: '好' }, finish_reason: 'stop' }],
      }).slice(0, 10),
      chunk({
        choices: [{ delta: { content: '好' }, finish_reason: 'stop' }],
      }).slice(10),
      chunk({
        choices: [],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }),
      'data: [DONE]\n\n',
    ]
    const deltas: string[] = []
    const result = await chatCompletion(
      config(),
      { messages: [{ role: 'user', content: 'q' }] },
      { fetch: async () => sseResponse(parts), onDelta: d => deltas.push(d) }
    )
    expect(deltas).toEqual(['你', '好'])
    expect(result).toMatchObject({
      content: '你好',
      finishReason: 'stop',
      usage: { totalTokens: 5 },
    })
  })

  it('SSE 解析器：CRLF、多行 data、[DONE]', () => {
    const chunks: unknown[] = []
    const onDone = vi.fn()
    const parser = createSseParser({ onChunk: c => chunks.push(c), onDone })
    parser.push('data: {"model":"a"}\r\n\r\ndata: [DO')
    parser.push('NE]\n\n')
    parser.end()
    expect(chunks).toEqual([{ model: 'a' }])
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})

describe('JSON 容错解析', () => {
  it.each([
    ['{"a":1}', { a: 1 }],
    ['```json\n{"a":1}\n```', { a: 1 }],
    ['好的，结果如下：{"a":{"b":"}"}} 希望有帮助', { a: { b: '}' } }],
    ['<think>想一想 {x}</think>[1,2,]', [1, 2]],
    ['{"a":[1,2,],}', { a: [1, 2] }],
  ])('%s', (text, expected) => {
    expect(parseJsonLoose(text)).toEqual(expected)
  })

  it('解析不了返回 undefined', () => {
    expect(parseJsonLoose('没有 JSON')).toBeUndefined()
    expect(parseJsonLoose('{"a":')).toBeUndefined()
  })
})

describe('用量累计', () => {
  it('按本地月份累计，usage 为空只加请求数，只保留 12 个月', () => {
    expect(monthKey(new Date(2026, 9, 24))).toBe('2026-10')
    let file = parseUsageFile(null)
    file = addUsage(file, '2026-10', {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    })
    file = addUsage(file, '2026-10', null)
    expect(file.months['2026-10']).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      requests: 2,
    })
    for (let m = 1; m <= 12; m++)
      file = addUsage(file, `2025-${String(m).padStart(2, '0')}`, null)
    expect(Object.keys(file.months)).toHaveLength(12)
    expect(file.months['2025-01']).toBeUndefined()
    expect(file.months['2026-10']).toBeDefined()
  })

  it('读盘容错、并发记录不丢、落盘', async () => {
    let disk: string | null =
      '{"months":{"2026-10":{"totalTokens":100,"requests":1},"bad":{}}}'
    const store = createUsageStore(
      { read: async () => disk, write: async t => void (disk = t) },
      () => new Date(2026, 9, 1)
    )
    await Promise.all([
      store.record({ promptTokens: 1, completionTokens: 1, totalTokens: 2 }),
      store.record({ promptTokens: 1, completionTokens: 1, totalTokens: 2 }),
    ])
    const summary = await store.summary()
    expect(summary.current).toMatchObject({
      month: '2026-10',
      totalTokens: 104,
      requests: 3,
    })
    await new Promise(r => setTimeout(r, 0))
    expect(JSON.parse(disk!).months['2026-10'].requests).toBe(3)
  })

  it('用量文案', () => {
    expect(formatTokens(1234)).toBe('1,234')
    expect(formatTokens(180_000)).toBe('约 18 万')
    expect(formatTokens(12_345)).toBe('约 1.2 万')
    expect(
      formatMonthUsage({
        month: '2026-10',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        requests: 0,
      })
    ).toBe('本月还没有调用')
    expect(
      formatMonthUsage({
        month: '2026-10',
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 180_000,
        requests: 3,
      })
    ).toBe('约 18 万 tokens · 3 次请求')
  })
})

describe('服务', () => {
  const settings = (
    over: Partial<ReturnType<AiServiceSettings['chat']>> = {},
    privateOnly = true
  ): AiServiceSettings => ({
    chat: () => ({ provider: 'deepseek', baseUrl: '', model: '', ...over }),
    privateLocalOnly: () => privateOnly,
    speech: () => ({ engine: 'off', model: 'large-v3-turbo', baseUrl: '' }),
    secret: () => 'sk-test',
  })
  const memoryUsage = (): UsageStore =>
    createUsageStore({ read: async () => null, write: async () => {} })

  it('private 请求遇到云端服务商：不发请求直接拒绝', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      completion('x')
    )
    const service = createAiService({
      settings: settings(),
      fetch,
      usage: memoryUsage(),
    })
    await expect(
      service.chat({
        messages: [{ role: 'user', content: '私密' }],
        private: true,
      })
    ).rejects.toMatchObject({ code: 'private_blocked' })
    expect(fetch).not.toHaveBeenCalled()

    const local = createAiService({
      settings: settings({ provider: 'ollama' }),
      fetch,
      usage: memoryUsage(),
    })
    await expect(
      local.chat({
        messages: [{ role: 'user', content: '私密' }],
        private: true,
      })
    ).resolves.toMatchObject({
      provider: 'ollama',
    })
    expect(fetch.mock.calls[0][0]).toBe(
      'http://127.0.0.1:11434/v1/chat/completions'
    )
  })

  it('成功调用累计用量并通知；chatJson 容错解析并校验', async () => {
    const onUsage = vi.fn()
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      completion('```json\n{"titles":["A"]}\n```')
    )
    const service = createAiService({
      settings: settings(),
      fetch,
      usage: memoryUsage(),
      onUsage,
    })
    const result = await service.chatJson<{ titles: string[] }>(
      { messages: [{ role: 'user', content: '推荐' }] },
      {
        validate: (d): d is { titles: string[] } =>
          Array.isArray((d as { titles?: unknown }).titles),
      }
    )
    expect(result.data.titles).toEqual(['A'])
    expect(onUsage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        current: expect.objectContaining({ totalTokens: 15, requests: 1 }),
      })
    )
    const init = fetch.mock.calls[0][1]!
    const sent = JSON.parse(String(init.body))
    expect(sent.response_format).toEqual({ type: 'json_object' })

    fetch.mockImplementation(async () => completion('抱歉，我做不到'))
    await expect(
      service.chatJson({ messages: [{ role: 'user', content: 'x' }] })
    ).rejects.toMatchObject({
      code: 'bad_json',
    })
  })

  it('测试连接：失败不抛错，带错误码与说明', async () => {
    const service = createAiService({
      settings: { ...settings(), secret: () => '' },
      fetch: vi.fn(),
      usage: memoryUsage(),
    })
    const result = await service.testConnection()
    expect(result).toMatchObject({
      ok: false,
      code: 'not_configured',
      provider: 'deepseek',
    })
    expect(result.message).toContain('API Key')
  })
})

describe('IPC 边界', () => {
  it('校验请求、去掉未知字段；流式必须带 requestId', () => {
    expect(
      parseChatRequest({
        messages: [{ role: 'user', content: 'hi', extra: 1 }],
        private: true,
        foo: 1,
      })
    ).toEqual({ messages: [{ role: 'user', content: 'hi' }], private: true })
    expect(
      parseChatRequest({
        messages: [{ role: 'user', content: 'hi' }],
        sessionId: ' qa-1 ',
      }).sessionId
    ).toBe('qa-1')
    expect(
      parseChatRequest({
        messages: [{ role: 'user', content: 'hi' }],
        sessionId: 3,
      }).sessionId
    ).toBeUndefined()
    expect(() => parseChatRequest({ messages: [] })).toThrow()
    expect(() =>
      parseChatRequest({ messages: [{ role: 'tool', content: 'x' }] })
    ).toThrow()
    expect(() =>
      parseChatRequest({
        messages: [{ role: 'user', content: 'x' }],
        temperature: 5,
      })
    ).toThrow()
    expect(() =>
      parseChatRequest({
        messages: [{ role: 'user', content: 'x' }],
        stream: true,
      })
    ).toThrow()
    expect(
      parseJsonRequest({
        messages: [{ role: 'user', content: 'x' }],
        schema: { type: 'object' },
        schemaName: 'pick',
        stream: true,
      })
    ).toEqual({
      messages: [{ role: 'user', content: 'x' }],
      schema: { type: 'object' },
      schemaName: 'pick',
    })
  })

  it('错误码经 message 前缀跨 IPC 还原', () => {
    const err = new AiError('private_blocked', '不行')
    const wrapped = `Error invoking remote method 'ai:chat': Error: ${err.message}`
    expect(parseAiErrorMessage(wrapped)).toEqual({
      code: 'private_blocked',
      message: '不行',
    })
    expect(parseAiErrorMessage('random')).toBeNull()
  })
})
