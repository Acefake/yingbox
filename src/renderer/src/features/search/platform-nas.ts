import type { OnlineProvider, SearchEnhancement } from './types'

/** NAS 专用版只查询片库、115 和磁力，不加载在线引擎或模型。 */
export function useSearchOnline(): OnlineProvider {
  return { available: false, search: async () => '', open: async () => {} }
}
export async function enhanceSearch(): Promise<SearchEnhancement> {
  return { keywords: [], resources: [], message: '' }
}
