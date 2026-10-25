// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  subtitleKeyword,
  usePlayerSubtitles,
} from '../src/renderer/src/features/player/composables/use-player-subtitles'

/** 在线字幕面板：取词规则、按片名自动搜、换片清状态（PR #149 审查） */
describe('在线字幕搜索', () => {
  afterEach(() => {
    window.api = undefined as never
  })

  it('取词：输入框优先，只有空白时回退到片名，都为空返回空串', () => {
    expect(subtitleKeyword(' 沙丘 ', '星际穿越')).toBe('沙丘')
    expect(subtitleKeyword('   ', ' 星际穿越 ')).toBe('星际穿越')
    expect(subtitleKeyword('', undefined)).toBe('')
    expect(subtitleKeyword('  ', '  ')).toBe('')
  })

  it('没有片名时打开面板不搜索、不提示「请输入」', () => {
    const searchOnline = vi.fn()
    window.api = { subtitle: { searchOnline } } as never
    const subs = usePlayerSubtitles({
      player: () => null,
      search: () => ({ title: '' }),
    })
    subs.togglePanel()
    expect(subs.panelOpen.value).toBe(true)
    expect(searchOnline).not.toHaveBeenCalled()
    expect(subs.message.value).toBe('')
  })

  it('换片后 dispose 清空结果 / 提示 / 输入，再打开按新片名自动搜', async () => {
    let title = '旧片'
    const searchOnline = vi.fn(async (input: { query: string }) => ({
      success: true,
      data:
        input.query === '旧片'
          ? []
          : [
              {
                name: 'a.srt',
                language: 'zh',
                downloads: 1,
                format: 'srt',
                fileId: 1,
              },
            ],
    }))
    window.api = { subtitle: { searchOnline } } as never
    const subs = usePlayerSubtitles({
      player: () => null,
      search: () => ({ title }),
    })
    subs.togglePanel()
    await vi.waitFor(() => expect(subs.message.value).toBe('无结果'))
    subs.query.value = '手动输入'
    subs.togglePanel()

    // 换片
    subs.dispose()
    title = '新片'
    expect(subs.hits.value).toEqual([])
    expect(subs.message.value).toBe('')
    expect(subs.query.value).toBe('')

    subs.togglePanel()
    await vi.waitFor(() => expect(subs.hits.value).toHaveLength(1))
    expect(searchOnline).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: '新片' })
    )
  })

  it('搜索等待期间换片：上一部的结果丢弃', async () => {
    let finish = (): void => {}
    const searchOnline = vi.fn(
      () =>
        new Promise(resolve => {
          finish = () =>
            resolve({
              success: true,
              data: [
                {
                  name: 'old.srt',
                  language: 'zh',
                  downloads: 1,
                  format: 'srt',
                  fileId: 9,
                },
              ],
            })
        })
    )
    window.api = { subtitle: { searchOnline } } as never
    const subs = usePlayerSubtitles({
      player: () => null,
      search: () => ({ title: '旧片' }),
    })
    const pending = subs.search()
    subs.dispose()
    finish()
    await pending
    expect(subs.hits.value).toEqual([])
    expect(subs.searching.value).toBe(false)
  })

  it('打开面板时清掉上一次残留的提示', () => {
    window.api = { subtitle: { searchOnline: vi.fn() } } as never
    const subs = usePlayerSubtitles({
      player: () => null,
      search: () => ({ title: '' }),
    })
    subs.message.value = '无结果'
    subs.togglePanel()
    expect(subs.message.value).toBe('')
  })
})
