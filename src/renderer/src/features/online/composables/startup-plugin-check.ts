/** 启动时实际调用插件搜索接口；空列表也算可用，错误页和无列表响应不可用。 */
import type { VodResponse } from '../../../../../shared/contract/online'
import type { CatSpiderSite } from '../types'
import { normalizeVodPayload } from '@/utils/vod-data'
import { onlineApi } from '../api/online'
import { OnlineTransportError } from '../api/errors'
import {
  markPluginOk,
  markPluginUnavailable,
  pluginProbeStates,
} from './plugin-health'

export async function checkStartupPlugin(
  site: CatSpiderSite,
  isCurrent: () => boolean,
  timeoutMs = 45_000
): Promise<boolean | undefined> {
  if (!isCurrent()) return
  const pending = { status: 'checking' as const, note: '启动检测中' }
  pluginProbeStates.set(site.name, pending)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result: VodResponse = await Promise.race([
      onlineApi()
        .vod({
          action: 'search',
          background: true,
          siteName: site.name,
          keyword: '电影',
          page: 1,
        })
        .catch(error => {
          throw new OnlineTransportError(error)
        }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('检测超时')), timeoutMs)
      }),
    ])
    if (!isCurrent()) return
    if (result.unavailable) markPluginUnavailable(site.name, result.unavailable)
    if (!result.success || result.unavailable)
      throw new Error(result.error || '插件暂不可用')
    const data = normalizeVodPayload(result.data)
    const nested = normalizeVodPayload(data?.data)
    if (!Array.isArray(data?.list) && !Array.isArray(nested?.list))
      throw new Error('插件响应缺少列表')
    markPluginOk(site.name, 'search')
    pluginProbeStates.set(site.name, {
      status: 'ok',
      note: '启动检测：搜索可用',
    })
    return true
  } catch (error) {
    if (!isCurrent()) return
    if (error instanceof OnlineTransportError) {
      pluginProbeStates.set(site.name, {
        status: 'unknown',
        note: '后台暂不可用，保留启用选择',
      })
      return
    }
    pluginProbeStates.set(site.name, {
      status: 'fail',
      note: error instanceof Error ? error.message : '插件检测失败',
    })
    return false
  } finally {
    clearTimeout(timer)
    if (pluginProbeStates.get(site.name) === pending)
      pluginProbeStates.delete(site.name)
  }
}
