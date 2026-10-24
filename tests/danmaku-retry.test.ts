/**
 * 弹幕失败重试与缓存：加载失败后允许重试；接口业务错误不写缓存。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { commentsError } from '../src/main/danmaku/rules'
import { createDanmakuService } from '../src/main/danmaku/service'
import { createLoadTracker } from '../src/renderer/src/features/player/danmaku/load-tracker'

const http = vi.hoisted(() => ({ body: '' }))

vi.mock('../src/main/http-client', () => ({
  fetchHttp: async () => new Response(http.body),
  readLimited: async (response: Response) => Buffer.from(await response.text()),
}))

describe('弹幕加载状态', () => {
  it('成功后同一条目不再加载，换条目或强制时加载', () => {
    const loads = createLoadTracker()
    expect(loads.needs('a')).toBe(true)
    loads.start('a')
    expect(loads.needs('a')).toBe(false)
    loads.succeed('a')
    expect(loads.needs('a')).toBe(false)
    expect(loads.needs('a', true)).toBe(true)
    expect(loads.needs('b')).toBe(true)
  })

  it('失败后清除记录，开关或凭据变化时可以重试', () => {
    const loads = createLoadTracker()
    loads.start('a')
    loads.fail('a')
    expect(loads.needs('a')).toBe(true)
  })

  it('旧条目的失败不影响新条目，reset 后全部重来', () => {
    const loads = createLoadTracker()
    loads.start('a')
    loads.start('b')
    loads.fail('a')
    expect(loads.needs('b')).toBe(false)
    loads.reset()
    expect(loads.needs('b')).toBe(true)
  })
})

describe('弹幕响应检查', () => {
  it('success:false 返回业务错误，缺 comments 视为格式不对', () => {
    expect(commentsError({ success: false, errorMessage: '凭据无效' })).toBe(
      '凭据无效'
    )
    expect(commentsError({ success: true })).toBe('弹幕服务返回格式不对')
    expect(commentsError(null)).toBe('弹幕服务返回格式不对')
    expect(commentsError({ count: 0, comments: [] })).toBeNull()
  })
})

describe('弹幕缓存', () => {
  const write = vi.fn(async () => {})
  const service = createDanmakuService({
    credentials: () => ({ appId: 'id', appSecret: 'secret' }),
    cache: { read: async () => null, write },
  })

  beforeEach(() => write.mockClear())

  it('HTTP 200 + success:false 返回错误且不写缓存', async () => {
    http.body = JSON.stringify({ success: false, errorMessage: '服务维护中' })
    const reply = await service.comments(42)
    expect(reply.success).toBe(false)
    expect(reply.error).toBe('服务维护中')
    expect(write).not.toHaveBeenCalled()
  })

  it('有效响应才写缓存', async () => {
    http.body = JSON.stringify({
      count: 1,
      comments: [{ p: '1.5,1,16777215,1', m: '前排' }],
    })
    const reply = await service.comments(42)
    expect(reply.success).toBe(true)
    expect(reply.data).toHaveLength(1)
    expect(write).toHaveBeenCalledWith(42, reply.data)
  })
})
