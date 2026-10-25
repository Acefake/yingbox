import { beforeEach, describe, expect, it, vi } from 'vitest'
const { chat, settings } = vi.hoisted(() => ({
  chat: vi.fn(),
  settings: {
    'ai.provider': 'deepseek',
    'ai.model': 'deepseek-chat',
    'ai.baseUrl': 'https://example.com',
  },
}))
vi.mock('@/features/ai', () => ({
  aiAvailable: () => true,
  aiConfigured: () => true,
  aiKeyConfigured: () => true,
  chatJson: chat,
}))
vi.mock('@/features/settings', () => ({
  getSetting: (key: keyof typeof settings) => settings[key],
}))
import { enhanceConditions } from '../../../src/renderer/src/features/library/search/ai-conditions'
beforeEach(() => {
  chat.mockReset()
  chat.mockResolvedValue({ data: { genres: ['科幻'] } })
  settings['ai.model'] = 'deepseek-chat'
})
describe('统一搜索的云端边界', () => {
  it('私密范围拒绝模型调用', async () => {
    await expect(
      enhanceConditions('查询', 'jav', new AbortController().signal)
    ).rejects.toThrow('仅使用本地')
    expect(chat).not.toHaveBeenCalled()
  })
  it('只发送查询和固定字段说明，同模型命中缓存，换模型重新解析', async () => {
    const signal = new AbortController().signal
    await enhanceConditions('90 年代港片', 'movie', signal)
    expect(chat).toHaveBeenCalledOnce()
    expect(chat.mock.calls[0][0].messages[1]).toEqual({
      role: 'user',
      content: '90 年代港片',
    })
    await enhanceConditions('90 年代港片', 'movie', signal)
    expect(chat).toHaveBeenCalledOnce()
    settings['ai.model'] = 'other-model'
    await enhanceConditions('90 年代港片', 'movie', signal)
    expect(chat).toHaveBeenCalledTimes(2)
  })
  it('取消后不缓存迟到的解析结果', async () => {
    const controller = new AbortController()
    chat.mockImplementationOnce(async () => {
      controller.abort()
      return { data: { genres: ['恐怖'] } }
    })
    await expect(
      enhanceConditions('取消专用查询', 'all', controller.signal)
    ).rejects.toThrow('停止')
    await enhanceConditions('取消专用查询', 'all', new AbortController().signal)
    expect(chat).toHaveBeenCalledTimes(2)
  })
})
