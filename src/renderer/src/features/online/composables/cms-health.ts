/** CMS 健康缓存：与启用开关分离，按 API 地址及接口用途持久化。 */
import { useStorage } from '@vueuse/core'
import { ref } from 'vue'
import {
  type CmsCapability,
  type CmsHealth,
  type CmsHealthCache,
  canUse,
  cmsErrorText,
  nextHealth,
  parseHealthCache,
  probeDue,
} from '../utils/cms-health'
import type { SiteStatus } from '../utils/source-rules'
import { OnlineTransportError } from '../api/errors'

const records = useStorage<CmsHealthCache>(
  'online_cms_health_v1',
  {},
  undefined,
  {
    serializer: { read: parseHealthCache, write: JSON.stringify },
  }
)
const clock = ref(Date.now())
let revision = 0
const revisions = new Map<string, number>()
const labels: Record<CmsCapability, string> = {
  browse: '列表',
  search: '搜索',
  detail: '详情',
}

/** 健康状态存取；检测和业务请求共用，不读取或修改源启用选择。 */
export const cmsHealth = {
  /** 源的当前请求版本，供手动重试和业务缓存失效共用。 */
  version(api: string): number {
    let value = revisions.get(api)
    if (value === undefined) {
      value = ++revision
      revisions.set(api, value)
    }
    return value
  },
  /** 手动重试、删除或监视器退出后，旧回包不能覆盖当前健康状态。 */
  begin(
    api: string,
    capability: CmsCapability
  ): { success: () => void; failure: (error: unknown) => void } {
    const version = this.version(api)
    return {
      success: () => {
        if (revisions.get(api) === version) this.success(api, capability)
      },
      failure: error => {
        if (revisions.get(api) === version) this.failure(api, capability, error)
      },
    }
  },
  invalidateRequests(): void {
    revisions.clear()
  },
  get(api: string, capability: CmsCapability): CmsHealth | undefined {
    return records.value[api]?.[capability]
  },
  tick() {
    clock.value = Date.now()
  },
  usable(api: string, capability: CmsCapability): boolean {
    return canUse(this.get(api, capability), Date.now())
  },
  due(api: string): boolean {
    return probeDue(this.get(api, 'browse'), Date.now())
  },
  success(api: string, capability: CmsCapability): void {
    this.record(api, capability, '')
  },
  failure(api: string, capability: CmsCapability, error: unknown): void {
    if (error instanceof OnlineTransportError) return
    this.record(api, capability, cmsErrorText(error))
  },
  record(api: string, capability: CmsCapability, error: string): void {
    clock.value = Date.now()
    records.value = {
      ...records.value,
      [api]: {
        ...records.value[api],
        [capability]: nextHealth(this.get(api, capability), error, clock.value),
      },
    }
  },
  remove(api: string): void {
    revisions.set(api, ++revision)
    const next = { ...records.value }
    delete next[api]
    records.value = next
  },
  clear(): void {
    revisions.clear()
    records.value = {}
  },
  status(api: string): SiteStatus {
    const values = Object.values(records.value[api] ?? {})
    if (values.some(value => value.until > clock.value)) return 'fail'
    if (values.some(value => value.failures > 0)) return 'unknown'
    return values.length ? 'ok' : 'unknown'
  },
  note(api: string): string {
    return (['browse', 'search', 'detail'] as const)
      .flatMap(key => {
        const value = records.value[api]?.[key]
        if (!value) return []
        const label = labels[key]
        if (!value.error) return [`${label}可用`]
        const retry =
          value.until > clock.value
            ? `，冷却至 ${new Date(value.until).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
            : '，待重试'
        return [`${label}：${value.error}${retry}`]
      })
      .join('；')
  },
}
