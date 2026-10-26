/**
 * 推理强度与可选参数降级：短调用（chatJson、测试连接）按服务商写法请求低推理强度，长回答不带；
 * 模型 400 / 422 拒绝推理强度或温度时去掉重发一次，并记住该模型不认（之后不再多一次失败往返）。
 * 错误说明取自 OpenCode Go 的真实返回。网络全部用 mock fetch。
 */
import { describe, expect, it, vi } from 'vitest'

import { type FetchLike, buildChatBody } from '../src/main/ai/client'
import type { AiConfig } from '../src/main/ai/config'
import { AiError } from '../src/main/ai/errors'
import {
  type ParamMemory,
  createParamMemory,
  reasoningParams,
  rejectedParam,
} from '../src/main/ai/params'
import {
  type AiServiceSettings,
  QUICK_REASONING,
  createAiService,
} from '../src/main/ai/service'
import { createUsageStore } from '../src/main/ai/usage'
import type { AiProviderId } from '../src/shared/ai/types'

const INTENT = '{"action":"x"}'

const ok = (content = INTENT): Response =>
  new Response(
    JSON.stringify({
      model: 'm',
      choices: [
        { message: { role: 'assistant', content }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )

const fail = (status: number, message: string): Response =>
  new Response(
    JSON.stringify({ error: { type: 'invalid_request_error', message } }),
    { status, headers: { 'content-type': 'application/json' } }
  )

/** OpenCode Go 的真实错误说明 */
const KIMI_TEMPERATURE =
  'Upstream request failed: [invalid_request_error] invalid temperature: only 1 is allowed for this model'
const GLM_NO_NONE =
  "Upstream request failed: [400] GLM-5.3 is a thinking-only model; disabling thinking (reasoning_effort='none') is not supported."

const bodyOf = (
  fetch: ReturnType<typeof vi.fn>,
  i: number
): Record<string, unknown> =>
  JSON.parse(String((fetch.mock.calls[i][1] as RequestInit).body))

const service = (
  fetch: unknown,
  params: ParamMemory = createParamMemory(),
  provider: AiProviderId = 'opencode-go',
  model = ''
): ReturnType<typeof createAiService> =>
  createAiService({
    settings: {
      chat: () => ({ provider, baseUrl: '', model }),
      privateLocalOnly: () => true,
      speech: () => ({ engine: 'off', model: '', baseUrl: '' }),
      secret: () => 'k',
    } satisfies AiServiceSettings,
    fetch: fetch as FetchLike,
    usage: createUsageStore({ read: async () => null, write: async () => {} }),
    client: { retryDelayMs: 0, sleep: async () => {}, params },
  })

const config = (provider: AiProviderId, model: string): AiConfig => ({
  provider,
  baseUrl: 'https://example.test/v1',
  model,
  apiKey: 'k',
  local: false,
  jsonSchema: false,
})

describe('推理强度的服务商写法', () => {
  it('只对有依据的服务商发送，字段按各家文档', () => {
    expect(reasoningParams('opencode-go', 'glm-5.3-flash', 'low')).toEqual({
      reasoning_effort: 'low',
    })
    expect(reasoningParams('ollama', 'qwen3:8b', 'low')).toEqual({
      reasoning_effort: 'low',
    })
    expect(reasoningParams('openrouter', 'openai/gpt-4o-mini', 'low')).toEqual({
      reasoning: { effort: 'low' },
    })
    expect(reasoningParams('deepseek', 'deepseek-chat', 'low')).toEqual({
      reasoning_effort: 'low',
    })
    expect(reasoningParams('deepseek', 'deepseek-chat', 'none')).toEqual({
      thinking: { type: 'disabled' },
    })
    // OpenAI 只有推理模型认 reasoning_effort，gpt-4o-mini 发了会 400
    expect(reasoningParams('openai', 'gpt-4o-mini', 'low')).toEqual({})
    expect(reasoningParams('openai', 'o4-mini', 'low')).toEqual({
      reasoning_effort: 'low',
    })
    expect(reasoningParams('openai', 'gpt-5-mini', 'low')).toEqual({
      reasoning_effort: 'low',
    })
    // 自定义接口不知道是谁，不发
    expect(reasoningParams('custom', 'anything', 'low')).toEqual({})
    // 不要求就不发
    expect(reasoningParams('opencode-go', 'glm-5.3', undefined)).toEqual({})
  })

  it('请求体：带推理强度；omit 掉的参数不发', () => {
    const request = {
      messages: [{ role: 'user' as const, content: 'hi' }],
      temperature: 0.2,
    }
    const cfg = config('opencode-go', 'kimi-k2.7-code')
    expect(
      buildChatBody(cfg, request, { stream: false, reasoning: 'low' })
    ).toMatchObject({ temperature: 0.2, reasoning_effort: 'low' })
    const trimmed = buildChatBody(cfg, request, {
      stream: false,
      reasoning: 'low',
      omit: ['reasoning', 'temperature'],
    })
    expect(trimmed).not.toHaveProperty('temperature')
    expect(trimmed).not.toHaveProperty('reasoning_effort')
  })

  it('chatJson 与测试连接请求低推理强度；chat 的长回答用模型默认', async () => {
    const fetch = vi.fn(async () => ok())
    const ai = service(fetch)
    await ai.chatJson({ messages: [{ role: 'user', content: '找片' }] })
    await ai.testConnection()
    await ai.chat({ messages: [{ role: 'user', content: '讲讲剧情' }] })
    expect(QUICK_REASONING).toBe('low')
    expect(bodyOf(fetch, 0).reasoning_effort).toBe('low')
    expect(bodyOf(fetch, 1).reasoning_effort).toBe('low')
    expect(bodyOf(fetch, 2)).not.toHaveProperty('reasoning_effort')
  })
})

describe('模型不认的参数：去掉重发并记住', () => {
  it('温度只允许 1（Kimi K2.7 Code）：去掉 temperature 重发，同一模型之后直接不发', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(fail(400, KIMI_TEMPERATURE))
      .mockImplementation(async () => ok())
    const ai = service(
      fetch,
      createParamMemory(),
      'opencode-go',
      'kimi-k2.7-code'
    )
    const request = {
      messages: [{ role: 'user' as const, content: '找片' }],
      temperature: 0.2,
    }
    const first = await ai.chatJson(request)
    expect(first.data).toEqual({ action: 'x' })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(bodyOf(fetch, 0).temperature).toBe(0.2)
    expect(bodyOf(fetch, 1)).not.toHaveProperty('temperature')
    // 推理强度没被点名，照发
    expect(bodyOf(fetch, 1).reasoning_effort).toBe('low')

    await ai.chatJson(request)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(bodyOf(fetch, 2)).not.toHaveProperty('temperature')
  })

  it('推理强度被拒（400 点名 reasoning_effort）：去掉重发并记住；别的模型不受影响', async () => {
    const params = createParamMemory()
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(fail(400, GLM_NO_NONE))
      .mockImplementation(async () => ok())
    const glm = service(fetch, params, 'opencode-go', 'glm-5.3')
    await glm.chatJson({ messages: [{ role: 'user', content: 'a' }] })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(bodyOf(fetch, 1)).not.toHaveProperty('reasoning_effort')
    await glm.testConnection()
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(bodyOf(fetch, 2)).not.toHaveProperty('reasoning_effort')

    const flash = service(fetch, params, 'opencode-go', 'glm-5.3-flash')
    await flash.chatJson({ messages: [{ role: 'user', content: 'a' }] })
    expect(bodyOf(fetch, 3).reasoning_effort).toBe('low')
  })

  it('422 点名 thinking 也算；两个参数先后被拒各去一次', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(fail(422, 'Unsupported parameter: thinking'))
      .mockResolvedValueOnce(fail(400, 'temperature must be 1'))
      .mockImplementation(async () => ok())
    const ai = service(fetch)
    await ai.chatJson({
      messages: [{ role: 'user', content: 'a' }],
      temperature: 0,
    })
    expect(fetch).toHaveBeenCalledTimes(3)
    const last = bodyOf(fetch, 2)
    expect(last).not.toHaveProperty('reasoning_effort')
    expect(last).not.toHaveProperty('temperature')
  })

  it('无关的 400、或点名了没发的参数：不重发，原样报错', async () => {
    const unrelated = vi.fn(async () => fail(400, 'model not found'))
    await expect(
      service(unrelated).chatJson({
        messages: [{ role: 'user', content: 'a' }],
      })
    ).rejects.toMatchObject({ code: 'http', status: 400 })
    expect(unrelated).toHaveBeenCalledTimes(1)

    // 没传 temperature，服务商却说 temperature 不对：不是我们发的，不循环
    const notSent = vi.fn(async () => fail(400, KIMI_TEMPERATURE))
    const ai = service(notSent)
    await expect(
      ai.chat({ messages: [{ role: 'user', content: 'a' }] })
    ).rejects.toMatchObject({ code: 'http' })
    expect(notSent).toHaveBeenCalledTimes(1)
  })

  it('rejectedParam：只认 400 / 422 且点名已发送的参数', () => {
    const http = (status: number, message: string): AiError =>
      new AiError('http', message, { status })
    expect(
      rejectedParam(http(400, KIMI_TEMPERATURE), ['reasoning', 'temperature'])
    ).toBe('temperature')
    expect(rejectedParam(http(400, GLM_NO_NONE), ['reasoning'])).toBe(
      'reasoning'
    )
    expect(rejectedParam(http(400, GLM_NO_NONE), ['temperature'])).toBeNull()
    expect(
      rejectedParam(http(500, KIMI_TEMPERATURE), ['temperature'])
    ).toBeNull()
    expect(
      rejectedParam(new AiError('network', 'temperature'), ['temperature'])
    ).toBeNull()
  })
})
