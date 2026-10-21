import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import SourceSiteRow from '../src/renderer/src/features/online/components/SourceSiteRow.vue'
import {
  healthNote,
  isActive,
  splitByHealth,
} from '../src/renderer/src/features/online/utils/plugin-health'
import {
  markPluginOk,
  markPluginUnavailable,
  pluginHealthOf,
  pluginRowProps,
  retryAllPlugins,
  retryPlugin,
} from '../src/renderer/src/features/online/composables/plugin-health'
import { useVODParser } from '../src/renderer/src/features/online/composables/use-vod-parser'

const trip = (
  until: number,
  reason: 'blocked' | 'unreachable' = 'blocked'
): { host: string; reason: typeof reason; until: number } => ({
  host: '4k-av.com',
  reason,
  until,
})

const online = {
  resetBlocks: vi.fn(async () => {}),
  vod: vi.fn(async (): Promise<unknown> => ({ success: true, data: {} })),
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  online.resetBlocks.mockClear()
  ;(globalThis as { window?: unknown }).window = {
    api: { online },
    setTimeout,
    clearTimeout,
  }
})

afterEach(() => {
  for (const name of ['4k-av', 'jable', '欧乐']) markPluginOk(name)
  vi.useRealTimers()
  delete (globalThis as { window?: unknown }).window
})

describe('插件源可用性规则', () => {
  it('isActive 只认冷却期内的记录', () => {
    expect(isActive(undefined, 0)).toBe(false)
    expect(isActive(trip(100), 99)).toBe(true)
    expect(isActive(trip(100), 100)).toBe(false)
  })

  it('healthNote 写明原因与剩余分钟（向上取整，至少 1 分钟）', () => {
    expect(healthNote(trip(30 * 60_000), 0)).toBe(
      '被站点拦截 · 约 30 分钟后自动重试'
    )
    expect(healthNote(trip(61_000, 'unreachable'), 0)).toBe(
      '无法访问 · 约 2 分钟后自动重试'
    )
    expect(healthNote(trip(10), 0)).toContain('约 1 分钟')
  })

  it('splitByHealth 跳过冷却期内的源，保持原顺序', () => {
    const sites = [{ name: 'a' }, { name: 'b' }, { name: 'c' }]
    const table: Record<string, ReturnType<typeof trip>> = {
      b: trip(50),
      c: trip(10),
    }
    expect(splitByHealth(sites, n => table[n], 20)).toEqual({
      usable: [{ name: 'a' }, { name: 'c' }],
      skipped: [{ name: 'b' }],
    })
  })
})

describe('插件源可用性状态', () => {
  it('标记后列表行变红并写明原因、可重试；到期自动清除', () => {
    markPluginUnavailable('4k-av', trip(Date.now() + 30 * 60_000))
    expect(pluginRowProps('4k-av')).toEqual({
      status: 'fail',
      note: '被站点拦截 · 约 30 分钟后自动重试',
      checkable: true,
      checkLabel: '重试数据源',
    })
    vi.advanceTimersByTime(30 * 60_000)
    expect(pluginHealthOf('4k-av')).toBeUndefined()
    expect(pluginRowProps('4k-av')).toMatchObject({
      status: 'ok',
      note: '',
      checkable: false,
    })
  })

  it('到期时触发响应式更新（界面上的红点会自己消失）', () => {
    markPluginUnavailable('jable', trip(Date.now() + 60_000))
    const status = computed(() => pluginRowProps('jable').status)
    expect(status.value).toBe('fail')
    vi.advanceTimersByTime(60_000)
    expect(status.value).toBe('ok')
  })

  it('已过期的熔断不记', () => {
    markPluginUnavailable('jable', trip(Date.now() - 1))
    expect(pluginHealthOf('jable')).toBeUndefined()
  })

  it('重试：清掉记录并让引擎解除该主机熔断；全部重试不带主机', async () => {
    markPluginUnavailable('4k-av', trip(Date.now() + 60_000))
    await retryPlugin('4k-av')
    expect(pluginHealthOf('4k-av')).toBeUndefined()
    expect(online.resetBlocks).toHaveBeenCalledWith('4k-av.com')
    markPluginUnavailable('jable', trip(Date.now() + 60_000))
    await retryAllPlugins()
    expect(pluginHealthOf('jable')).toBeUndefined()
    expect(online.resetBlocks).toHaveBeenLastCalledWith()
  })

  it('插件调用回报 unavailable 时标记该源；之后正常返回则清除', async () => {
    const parser = useVODParser()
    online.vod.mockResolvedValueOnce({
      success: true,
      data: {},
      unavailable: trip(Date.now() + 60_000),
    })
    await parser.search({ siteName: '4k-av', keyword: 'x' })
    expect(pluginHealthOf('4k-av')).toMatchObject({ reason: 'blocked' })
    await parser.search({ siteName: '4k-av', keyword: 'x' })
    expect(pluginHealthOf('4k-av')).toBeUndefined()
  })

  it('数据源行：不可用时红点 + 原因说明 + 「重试」按钮，正常时只有名称', async () => {
    markPluginUnavailable('4k-av', trip(Date.now() + 30 * 60_000))
    const row = (name: string): Promise<string> =>
      renderToString(
        h(SourceSiteRow, {
          name,
          api: 'csp_x',
          badge: '插件',
          enabled: true,
          ...pluginRowProps(name),
        })
      )
    const bad = await row('4k-av')
    expect(bad).toContain('class="is-fail site-dot"')
    expect(bad).toContain('被站点拦截 · 约 30 分钟后自动重试')
    expect(bad).toContain('重试数据源 4k-av')
    expect(bad).not.toContain('site-api')
    const good = await row('欧乐')
    expect(good).toContain('class="is-ok site-dot"')
    expect(good).not.toContain('site-note')
    expect(good).not.toContain('重试数据源')
  })
})
