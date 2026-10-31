/** 搜索入口和 AI 卡片使用同一个完整结果页。 */
import type { RouteLocationRaw } from 'vue-router'
export function resourceSearchLocation(text: string): RouteLocationRaw {
  return { path: '/search', query: { q: text.trim().slice(0, 500) } }
}

export { default as LocalSearchPreview } from './LocalSearchPreview.vue'
