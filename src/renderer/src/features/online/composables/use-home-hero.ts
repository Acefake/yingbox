/**
 * 首页 Hero 轮播的数据：优先本地片库最近入库、有背景图的片子（「本地片库 · 新入库」），
 * 片库为空或没有片库时用豆瓣热门的前几部（「豆瓣 · 热门」）。
 *
 * 每页是同一个形状（HeroSlide）：背景图、标志图或片名、简介、元信息、规格标签，以及播放 / 打开详情 / 想看登记。
 * 片库那一份在首页挂载和每次回到首页时重取（新扫进来的片子随即出现）。
 */
import { type ComputedRef, computed, onActivated, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { toast } from '@/components/ui'
import type { SpecBadge } from '@/components/ui/spec-badge'
import {
  type LibraryHighlight,
  libraryHighlights,
  libraryItemLocation,
  playLibraryItem,
} from '@/features/library'
import type { WatchlistMeta } from '@/features/watchlist'

import { formatRating } from '../../../../../shared/library/rating'

import type { DoubanItem } from '../types'
import { doubanDetail } from '../utils/douban-detail'
import { useDoubanFeed } from './use-douban-feed'

/** Hero 的一页 */
export interface HeroSlide {
  key: string
  /** 片名上方的小标签行 */
  kicker: string
  title: string
  /** 透明底标志图；没有时显示大号片名 */
  logo: string | null
  /** 背景图（横向剧照优先） */
  art: string
  overview: string
  /** 年份 · 类型 · 时长 */
  meta: string[]
  specs: SpecBadge[]
  /** 「待看」登记；null 时不显示待看 */
  watchlist: WatchlistMeta | null
  /** 主按钮文字 */
  playLabel: string
  play: () => void
  open: () => void
}

/** 轮播最多几页 */
export const HERO_SLIDES = 5

export interface HomeHero {
  slides: ComputedRef<HeroSlide[]>
  /** 两路数据都还没到 */
  loading: ComputedRef<boolean>
}

/**
 * @param openDouban 打开豆瓣条目的详情（在线页的详情覆盖层）
 */
export function useHomeHero(openDouban: (item: DoubanItem) => void): HomeHero {
  const router = useRouter()
  const feed = useDoubanFeed()
  const library = ref<LibraryHighlight[] | null>(null)

  const reload = async (): Promise<void> => {
    library.value = await libraryHighlights(HERO_SLIDES).catch(() => [])
  }
  onMounted(() => void reload())
  onActivated(() => void reload())

  const fromLibrary = (item: LibraryHighlight): HeroSlide => {
    const open = (): void =>
      void router.push(libraryItemLocation(item.type, item.id))
    return {
      key: `library:${item.id}`,
      kicker: '本地片库 · 新入库',
      title: item.title,
      logo: item.logo,
      art: item.backdrop,
      overview: item.overview,
      meta: item.meta,
      specs: item.specs,
      watchlist: item.watchlist,
      playLabel: '播放',
      play: async () => {
        if (await playLibraryItem(item.id)) return
        toast.error('没有可播放的文件，已打开详情')
        open()
      },
      open,
    }
  }

  const fromDouban = (item: DoubanItem): HeroSlide => {
    return {
      key: `douban:${item.url}`,
      kicker: `豆瓣 · ${feed.query.value.kind === 'tv' ? '热门剧集' : '热门电影'}`,
      title: item.title,
      logo: null,
      art: item.backdrop || item.cover || item.coverSrc,
      overview: item.overview,
      meta: [
        item.year ? `${item.year} 年` : '',
        item.type,
        formatRating(Number(item.rate), 'douban'),
      ].filter(Boolean),
      specs: [],
      watchlist: {
        section: 'online',
        key: item.title,
        title: item.title,
        poster: item.cover || undefined,
        cover: item.backdrop || undefined,
        detail: doubanDetail(item),
      },
      playLabel: '选源播放',
      play: () => openDouban(item),
      open: () => openDouban(item),
    }
  }

  const slides = computed<HeroSlide[]>(() => {
    if (library.value?.length) return library.value.map(fromLibrary)
    return feed.items.value
      .filter(item => item.backdrop || item.cover || item.coverSrc)
      .slice(0, HERO_SLIDES)
      .map(fromDouban)
  })
  const loading = computed(
    () =>
      !slides.value.length &&
      (library.value === null ||
        feed.status.value === 'idle' ||
        feed.status.value === 'loading')
  )
  return { slides, loading }
}
