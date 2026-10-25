/** 搜索面板在首次使用时加载。 */
import { defineAsyncComponent } from 'vue'
export const UnifiedSearchPanel = defineAsyncComponent(
  () => import('./UnifiedSearchPanel.vue')
)
