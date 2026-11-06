import type { SegmentedOption } from '@/components/ui/UiSegmented.vue'

/** AV 页面可用的导航分类。 */
export type AvTab =
  | 'browse'
  | 'search'
  | 'favorites'
  | 'watch-later'
  | 'playlists'
  | 'history'
/** 「搜索」视图没有 Tab，由路由 ?q= 进入。 */
export const tabs: SegmentedOption<AvTab>[] = [
  { value: 'browse', label: '浏览' },
  { value: 'favorites', label: '收藏' },
  { value: 'watch-later', label: '待看' },
  { value: 'playlists', label: '片单' },
  { value: 'history', label: '播放历史' },
]
