import { type ComputedRef, type Ref, computed } from 'vue'
import { useStorage } from '@vueuse/core'
import type { MenuButtonItem } from '@/components/ui/UiMenuButton.vue'

/** AV 搜索历史与菜单，选择历史项时通知页面发起搜索。 */
export function useAvSearchHistory(select: (keyword: string) => void): {
  searchHistory: Ref<string[]>
  searchHistoryItems: ComputedRef<MenuButtonItem[]>
} {
  const searchHistory = useStorage<string[]>('av_search_history', [])
  const searchHistoryItems = computed<MenuButtonItem[]>(() => {
    if (!searchHistory.value.length) {
      return [
        {
          key: 'empty',
          label: '暂无搜索历史',
          disabled: true,
          onSelect: () => {},
        },
      ]
    }
    return [
      ...searchHistory.value.map(keyword => ({
        key: `query:${keyword}`,
        label: keyword.length > 32 ? `${keyword.slice(0, 32)}…` : keyword,
        onSelect: () => {
          select(keyword)
        },
      })),
      {
        key: 'clear',
        label: '清空搜索历史',
        icon: 'trash',
        onSelect: () => {
          searchHistory.value = []
        },
      },
    ]
  })

  return { searchHistory, searchHistoryItems }
}
