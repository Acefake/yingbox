/**
 * 各服务商 / 模型的真实返回形态：思考把额度用光（GLM、DeepSeek 经 OpenCode Go 实测的形状）、
 * content 为 null / 空串 / 分段数组、tool_calls、代码块、think 标签、前后说明文字、
 * 不支持 response_format 的 400、流式里的 reasoning 增量；以及助手意图的宽松校验与错误文案。
 * 网络全部用 mock fetch。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type FetchLike,
  JSON_MIN_TOKENS,
  REASONING_HEADROOM_TOKENS,
  chatCompletion,
} from '../src/main/ai/client'
import type { AiConfig } from '../src/main/ai/config'
import { parseJsonLoose, parseLastJson } from '../src/main/ai/json'
import { contentText, messageParts } from '../src/main/ai/response'
import {
  type AiServiceSettings,
  JSON_REPAIR_HINT,
  createAiService,
} from '../src/main/ai/service'
import { createUsageStore } from '../src/main/ai/usage'
import { AiCallError } from '../src/renderer/src/features/ai/api'
import {
  intentObject,
  parseIntent,
  rawSlots,
} from '../src/renderer/src/features/assistant/skills/skill-prompt'
import type { AssistantSkill } from '../src/renderer/src/features/assistant/skills/skill-types'
import { errorText } from '../src/renderer/src/features/assistant/use-assistant'

const config: AiConfig = {
  provider: 'opencode-go',
  baseUrl: 'https://opencode.ai/inference/go/openai/v1',
  model: 'glm-5.3-flash',
  apiKey: 'k',
  local: false,
  jsonSchema: false,
}

const usage = { prompt_tokens: 100, completion_tokens: 300, total_tokens: 400 }

/** 一条非流式返回 */
const reply = (
  message: Record<string, unknown>,
  finish = 'stop',
  status = 200
): Response =>
  new Response(
    JSON.stringify({
      model: 'glm-5.3-flash',
      choices: [
        { message: { role: 'assistant', ...message }, finish_reason: finish },
      ],
      usage,
    }),
    { status, headers: { 'content-type': 'application/json' } }
  )

/** 思考把 max_tokens 用光：GLM 给 content null，DeepSeek 给空串 */
const spent = (content: null | ''): Response =>
  reply(
    { content, reasoning_content: '用户想找诺兰的电影，这是库外发现……' },
    'length'
  )

const INTENT =
  '{"action":"discover.discover","reply":"好","text":"","target":"movie","command":"","value":null,"on":null}'

const sse = (events: unknown[]): Response =>
  new Response(
    new ReadableStream({
      start(controller) {
        const enc = new TextEncoder()
        for (const e of events)
          controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`))
        controller.enqueue(enc.encode('data: [DONE]\n\n'))
        controller.close()
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
  )

const sentBody = (
  fetch: ReturnType<typeof vi.fn>,
  i: number
): Record<string, unknown> & {
  messages: Array<{ role: string; content: string }>
} => JSON.parse(String((fetch.mock.calls[i][1] as RequestInit).body))

const service = (fetch: unknown): ReturnType<typeof createAiService> =>
  createAiService({
    settings: {
      chat: () => ({ provider: 'opencode-go', baseUrl: '', model: '' }),
      privateLocalOnly: () => true,
      speech: () => ({ engine: 'off', model: '', baseUrl: '' }),
      secret: () => 'k',
    } satisfies AiServiceSettings,
    fetch: fetch as FetchLike,
    usage: createUsageStore({ read: async () => null, write: async () => {} }),
    client: { retryDelayMs: 0, sleep: async () => {} },
  })

afterEach(() => vi.restoreAllMocks())

describe('回答在哪个字段', () => {
  it('content 字符串 / null / 分段数组，思考字段两种叫法，tool_calls 参数', () => {
    expect(contentText('a')).toBe('a')
    expect(contentText(null)).toBe('')
    expect(
      contentText([
        { type: 'text', text: '{"a"' },
        { type: 'text', text: ':1}' },
      ])
    ).toBe('{"a":1}')
    expect(messageParts({ content: null, reasoning_content: '想' })).toEqual({
      content: '',
      reasoning: '想',
      toolArgs: '',
    })
    expect(messageParts({ content: '', reasoning: '想' }).reasoning).toBe('想')
    expect(
      messageParts({
        content: null,
        tool_calls: [{ function: { name: 'x', arguments: '{"a":1}' } }],
      }).toolArgs
    ).toBe('{"a":1}')
    expect(
      messageParts({ tool_calls: [{ function: { arguments: { a: 1 } } }] })
        .toolArgs
    ).toBe('{"a":1}')
  })
})

describe('思考型模型把额度用光', () => {
  it.each([
    ['GLM：content 为 null', null],
    ['DeepSeek：content 为空串', ''],
  ] as const)('%s → 补额度再请求一次，用量合计', async (_name, content) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(spent(content))
      .mockResolvedValueOnce(reply({ content: '好的' }))
    const result = await chatCompletion(
      config,
      { messages: [{ role: 'user', content: 'q' }], maxTokens: 300 },
      { fetch }
    )
    expect(result.content).toBe('好的')
    expect(sentBody(fetch, 0).max_tokens).toBe(300)
    expect(sentBody(fetch, 1).max_tokens).toBe(300 + REASONING_HEADROOM_TOKENS)
    expect(result.usage?.totalTokens).toBe(800)
  })

  it('补额度后仍然没有正文 → truncated（不是 bad_json）', async () => {
    const fetch = vi.fn().mockImplementation(async () => spent(null))
    await expect(
      chatCompletion(
        config,
        { messages: [{ role: 'user', content: 'q' }], maxTokens: 16 },
        { fetch }
      )
    ).rejects.toMatchObject({ code: 'truncated' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('JSON 调用的 max_tokens 至少 JSON_MIN_TOKENS，给思考留余量', async () => {
    const fetch = vi.fn(async () => reply({ content: INTENT }))
    const result = await service(fetch).chatJson({
      messages: [{ role: 'user', content: '找诺兰' }],
      maxTokens: 300,
    })
    expect(sentBody(fetch, 0).max_tokens).toBe(JSON_MIN_TOKENS)
    expect(result.data).toMatchObject({ action: 'discover.discover' })
    expect(result).not.toHaveProperty('reasoning')
  })

  it('流式：reasoning 增量不推给界面；只有思考就被截断时补额度重来', async () => {
    const deltas: string[] = []
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        sse([
          { choices: [{ delta: { reasoning_content: '想一想' } }] },
          { choices: [{ delta: {}, finish_reason: 'length' }] },
        ])
      )
      .mockResolvedValueOnce(
        sse([
          { choices: [{ delta: { reasoning_content: '想好了' } }] },
          { choices: [{ delta: { content: '你好' } }] },
          { choices: [{ delta: { content: '！' }, finish_reason: 'stop' }] },
        ])
      )
    const result = await chatCompletion(
      config,
      { messages: [{ role: 'user', content: '你好' }], maxTokens: 400 },
      { fetch, onDelta: d => deltas.push(d) }
    )
    expect(deltas).toEqual(['你好', '！'])
    expect(result).toMatchObject({ content: '你好！', reasoning: '想好了' })
  })

  it('chat 拿到空回答 → bad_response（说明里带结束原因）', async () => {
    const fetch = vi.fn(async () => reply({ content: '' }))
    await expect(
      service(fetch).chat({ messages: [{ role: 'user', content: 'q' }] })
    ).rejects.toThrow(/空回答/)
  })
})

describe('JSON 模式不被支持', () => {
  it('400 提到 response_format → 去掉它、只靠提示词重发', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "response_format type 'json_object' is not supported",
            },
          }),
          { status: 400 }
        )
      )
      .mockResolvedValueOnce(reply({ content: INTENT }))
    const result = await service(fetch).chatJson({
      messages: [{ role: 'user', content: 'q' }],
      schema: { type: 'object' },
    })
    expect(result.data).toMatchObject({ action: 'discover.discover' })
    expect(sentBody(fetch, 0).response_format).toEqual({ type: 'json_object' })
    const second = sentBody(fetch, 1)
    expect(second.response_format).toBeUndefined()
    expect(second.messages[0].content).toContain('JSON')
  })

  it('无关的 400 不降级，原样报 http', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { message: 'invalid temperature' } }),
          { status: 400 }
        )
    )
    await expect(
      service(fetch).chatJson({ messages: [{ role: 'user', content: 'q' }] })
    ).rejects.toMatchObject({ code: 'http' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('响应体不是 JSON → bad_response，说明里带原始返回', async () => {
    const fetch = vi.fn(
      async () => new Response('<html>502 Bad Gateway</html>', { status: 200 })
    )
    await expect(
      service(fetch).chat({ messages: [{ role: 'user', content: 'q' }] })
    ).rejects.toThrow(/502 Bad Gateway/)
  })
})

describe('JSON 容错：各种外壳', () => {
  it.each([
    ['代码块', `\`\`\`json\n${INTENT}\n\`\`\``],
    ['没收尾的代码块', `\`\`\`json\n${INTENT}`],
    ['前后说明，说明里带括号', `[注意] 结果如下：\n${INTENT}\n以上。`],
    ['闭合的 think', `<think>先想 {草稿}</think>\n${INTENT}`],
    ['只剩 </think>', `用户想找片…{"action":"x"}</think>${INTENT}`],
  ])('%s', (_name, text) => {
    expect(parseJsonLoose(text)).toMatchObject({ action: 'discover.discover' })
  })

  it('思考里取最后一个完整对象（不取嵌套的内层）', () => {
    const reasoning = `草稿 {"action":"answer"} 再想想，定稿：{"action":"discover.discover","x":{"y":1}} 完`
    expect(parseLastJson(reasoning)).toEqual({
      action: 'discover.discover',
      x: { y: 1 },
    })
  })

  it('正文为空、答案在思考里 → 用思考里的 JSON', async () => {
    const fetch = vi.fn(async () =>
      reply({ content: '', reasoning_content: `决定输出 ${INTENT}` })
    )
    const result = await service(fetch).chatJson({
      messages: [{ role: 'user', content: 'q' }],
    })
    expect(result.data).toMatchObject({ action: 'discover.discover' })
  })

  it('tool_calls 形式返回 → 用参数里的 JSON', async () => {
    const fetch = vi.fn(async () =>
      reply({
        content: null,
        tool_calls: [{ function: { name: 'intent', arguments: INTENT } }],
      })
    )
    const result = await service(fetch).chatJson({
      messages: [{ role: 'user', content: 'q' }],
    })
    expect(result.data).toMatchObject({ action: 'discover.discover' })
  })

  it('解析不了 → 带原输出与纠正提示重问一次，成功就用', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(reply({ content: '好的，我来帮你找诺兰的电影。' }))
      .mockResolvedValueOnce(reply({ content: INTENT }))
    const result = await service(fetch).chatJson({
      messages: [{ role: 'user', content: 'q' }],
    })
    expect(result.data).toMatchObject({ action: 'discover.discover' })
    const messages = sentBody(fetch, 1).messages as Array<{
      role: string
      content: string
    }>
    expect(messages.at(-2)).toEqual({
      role: 'assistant',
      content: '好的，我来帮你找诺兰的电影。',
    })
    expect(messages.at(-1)).toEqual({ role: 'user', content: JSON_REPAIR_HINT })
  })

  it('截断的 JSON（length）→ 加额度重问', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(reply({ content: '{"action":"disc' }, 'length'))
      .mockResolvedValueOnce(reply({ content: INTENT }))
    await service(fetch).chatJson({
      messages: [{ role: 'user', content: 'q' }],
      maxTokens: 300,
    })
    expect(sentBody(fetch, 1).max_tokens).toBe(300 * 2 + 4096)
  })

  it('结构校验不过也重问；两次都不行 → bad_json，说明与日志带原始返回前 500 字', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetch = vi.fn(async () =>
      reply({ content: `抱歉，${'我做不到'.repeat(200)}` })
    )
    const error = (await service(fetch)
      .chatJson({ messages: [{ role: 'user', content: 'q' }] })
      .catch((e: unknown) => e)) as Error
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(error).toMatchObject({ code: 'bad_json' })
    expect(error.message).toContain('原始返回：抱歉，我做不到')
    expect(error.message.length).toBeLessThan(600)
    expect(warn.mock.calls[0][0]).toMatch(/原始返回前 500 字/)

    const bad = vi.fn(async () => reply({ content: '{"foo":1}' }))
    await expect(
      service(bad).chatJson(
        { messages: [{ role: 'user', content: 'q' }] },
        { validate: (d): d is object => 'action' in (d as object) }
      )
    ).rejects.toThrow(/结构不符合要求/)
    expect(bad).toHaveBeenCalledTimes(2)
  })
})

describe('助手意图：宽松读取', () => {
  const action = {
    name: 'control',
    describe: '',
    parse: (raw: unknown) => raw,
    run: vi.fn(),
  }
  const skills = [
    { id: 'player', scope: 'any', actions: [action] },
  ] as unknown as AssistantSkill[]

  it('数组外壳、包一层 intent、动作名大小写', () => {
    expect(intentObject([{ action: 'a' }])).toEqual({ action: 'a' })
    expect(intentObject({ intent: { action: 'a' } })).toEqual({ action: 'a' })
    expect(intentObject('x')).toBeNull()
    const parsed = parseIntent(
      [{ action: ' Player.Control ', reply: '好' }],
      skills
    )
    expect(parsed.intent).toMatchObject({
      kind: 'action',
      id: 'player.control',
    })
  })

  it('数字 / 开关写成字符串也认', () => {
    expect(rawSlots({ value: '1.5', on: 'true', text: 3 })).toMatchObject({
      value: 1.5,
      on: true,
      text: '3',
    })
    expect(rawSlots({ value: 'abc', on: 'maybe' })).toMatchObject({
      value: null,
      on: null,
    })
    expect(rawSlots({ on: '关' }).on).toBe(false)
  })

  it('错误文案：格式不对与想太久分开，不再一律「没听懂」', () => {
    const bad = errorText(new AiCallError('bad_json', 'x'))
    expect(bad).toContain('格式不对')
    expect(errorText(new AiCallError('bad_response', 'x'))).toBe(bad)
    expect(errorText(new AiCallError('truncated', 'x'))).toContain('想得太久')
    expect(bad).not.toContain('没听懂')
  })
})
