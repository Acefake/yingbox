import { afterEach, describe, expect, it, vi } from 'vitest'
import { isProxy, reactive } from 'vue'
import { doubanBrowse } from '../src/renderer/src/features/online/api/online'
import { defaultDoubanQuery } from '../src/shared/douban/query'

describe('doubanBrowse IPC 参数', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('响应式条件拷成普通对象再过 IPC（Proxy 无法结构化克隆）', async () => {
    const call = vi.fn().mockResolvedValue({ items: [], next: null })
    vi.stubGlobal('window', { api: { online: { doubanBrowse: call } } })
    const query = reactive(defaultDoubanQuery())
    await doubanBrowse(query, 0)
    const sent = call.mock.calls[0][0]
    expect(isProxy(sent)).toBe(false)
    expect(sent).toEqual(defaultDoubanQuery())
    expect(() => structuredClone(sent)).not.toThrow()
  })
})
