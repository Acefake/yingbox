/** NAS 不提供 AV 源；共享数据源管理界面仍使用同一接口。 */
import { type ComputedRef, type WritableComputedRef, computed } from 'vue'
export interface AvSite {
  name: string
  api: string
}
export function useAvSources(): {
  enabledApis: WritableComputedRef<string[]>
  activeSources: ComputedRef<AvSite[]>
  allSources: ComputedRef<AvSite[]>
  getActiveSources(): AvSite[]
  addSources(sources: AvSite[]): number
} {
  const empty = computed<AvSite[]>(() => [])
  return {
    enabledApis: computed<string[]>({ get: () => [], set: () => {} }),
    activeSources: empty,
    allSources: empty,
    getActiveSources: (): AvSite[] => [],
    addSources: (_sources: AvSite[]): number => 0,
  }
}
