// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { OnlineTransportError } from '../src/renderer/src/features/online/api/online'

afterEach(() => {
  localStorage.clear()
  vi.useRealTimers()
})

describe('CMS 健康缓存与恢复', () => {
  it('后台断线不计为源失败', async () => {
    const { cmsHealth } =
      await import('../src/renderer/src/features/online/composables/cms-health')
    const api = 'https://transport.test/api'
    cmsHealth.clear()
    for (let i = 0; i < 3; i++)
      cmsHealth.failure(
        api,
        'search',
        new OnlineTransportError(new Error('HTTP 401'))
      )
    expect(cmsHealth.get(api, 'search')).toBeUndefined()
  })
  it('手动重试和监视器停止后，旧请求不能写回失败', async () => {
    const { cmsHealth } =
      await import('../src/renderer/src/features/online/composables/cms-health')
    const api = 'https://source.test/api'
    const old = Array.from({ length: 3 }, () => cmsHealth.begin(api, 'search'))
    cmsHealth.remove(api)
    cmsHealth.success(api, 'browse')
    old.forEach(request => request.failure(new Error('HTTP 503')))
    expect(cmsHealth.get(api, 'search')).toBeUndefined()
    expect(cmsHealth.usable(api, 'search')).toBe(true)
    const stopped = cmsHealth.begin(api, 'detail')
    cmsHealth.invalidateRequests()
    stopped.failure(new Error('HTTP 503'))
    expect(cmsHealth.get(api, 'detail')).toBeUndefined()
  })
  it('搜索失败不影响详情，列表成功不解除搜索冷却；手动重试恢复尝试', async () => {
    vi.resetModules()
    const { cmsHealth } =
      await import('../src/renderer/src/features/online/composables/cms-health')
    cmsHealth.clear()
    for (let i = 0; i < 3; i++)
      cmsHealth.failure(
        'https://source.test/api',
        'search',
        new Error('HTTP 403')
      )
    cmsHealth.success('https://source.test/api', 'browse')
    expect(cmsHealth.usable('https://source.test/api', 'search')).toBe(false)
    expect(cmsHealth.usable('https://source.test/api', 'detail')).toBe(true)
    expect(cmsHealth.note('https://source.test/api')).toContain(
      '搜索：HTTP 403'
    )
    await nextTick()
    expect(localStorage.getItem('online_cms_health_v1')).toContain('HTTP 403')
    vi.resetModules()
    const reloaded =
      await import('../src/renderer/src/features/online/composables/cms-health')
    expect(reloaded.cmsHealth.usable('https://source.test/api', 'search')).toBe(
      false
    )
    reloaded.cmsHealth.remove('https://source.test/api')
    expect(reloaded.cmsHealth.usable('https://source.test/api', 'search')).toBe(
      true
    )
    expect(
      reloaded.cmsHealth.get('https://source.test/api', 'search')
    ).toBeUndefined()
  })
})
