/**
 * 首页 Hero 轮播的数据：有没看完的片子时第一张放它（「本地片库 · 看到 62%」，主按钮「继续播放 · 剩 48 分钟」），
 * 后面接精选来源：本地片库最近入库、有背景图的片子（「本地片库 · 新入库」），片库为空或没有片库时用豆瓣热门的前几部。
 * 选片与文案规则见 utils/hero-rules.ts。
 *
 * 每页是同一个形状（HeroSlide）：背景图、缩略图、标志图或片名、简介、元信息、规格标签、评分，以及播放 / 打开详情 / 想看登记。
 * 片库那一份在首页挂载和每次回到首页时重取（新扫进来的片子随即出现）；继续观看那一张跟着继续观看记录变。
 */
import {
  type ComputedRef,
  computed,
  onActivated,
  onMounted,
  ref,
  watch,
} from 'vue'
import { useRouter } from 'vue-router'

import { toast } from '@/components/ui'
import type { SpecBadge } from '@/components/ui/spec-badge'
import {
  type LibraryHighlight,
  libraryHighlight,
  libraryHighlights,
  libraryItemLocation,
  playLibraryItem,
  resumeLibrary,
} from '@/features/library'
import {
  type ContinueRecord,
  continueRecords,
  metaOf,
  openMediaPlayer,
  replayOptions,
} from '@/features/player'
import type { WatchlistMeta } from '@/features/watchlist'
import { htmlToText } from '@/utils/html-text'

import { formatRating } from '../../../../../shared/library/rating'

import type { DoubanItem, OnlineDetailItem } from '../types'
import { doubanDetail } from '../utils/douban-detail'
import {
  HERO_SLIDES,
  composeSlides,
  libraryItemIdOf,
  pickResumeRecord,
  resumeKicker,
  resumePlayLabel,
} from '../utils/hero-rules'
import { useHotFeed } from './use-home-browse'

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
  /** 没有横图时按原比例展示竖版封面。 */
  artIsPoster?: boolean
  /** 右下缩略图条用的小图 */
  thumb: string
  overview: string
  /** 年份 · 类型 · 时长 */
  meta: string[]
  specs: SpecBadge[]
  /** 「豆瓣 8.3」；没有为空串 */
  rating: string
  /** 「待看」登记；null 时不显示待看 */
  watchlist: WatchlistMeta | null
  /** 主按钮文字 */
  playLabel: string
  play: () => void
  open: () => void
}

export { HERO_SLIDES }

export interface HomeHero {
  slides: ComputedRef<HeroSlide[]>
  /** 两路数据都还没到 */
  loading: ComputedRef<boolean>
}

/**
 * @param openDouban 打开豆瓣条目的详情（在线页的详情覆盖层）
 * @param openContinue 打开继续观看记录的详情（在线条目本页打开，片库条目去片库页）
 */
export function useHomeHero(
  openDouban: (item: DoubanItem) => void,
  openContinue: (record: ContinueRecord) => void
): HomeHero {
  const router = useRouter()
  const feed = useHotFeed('movie')
  const library = ref<LibraryHighlight[] | null>(null)

  const reload = async (): Promise<void> => {
    library.value = await libraryHighlights(HERO_SLIDES).catch(() => [])
  }
  onMounted(() => void reload())
  onActivated(() => void reload())

  // —— 继续观看那一张：片库条目另取详情（标志图、简介、规格），取不到就用记录里的封面 ——
  const records = continueRecords()
  const resume = computed(() => pickResumeRecord(records.value))
  const resumeInfo = ref<LibraryHighlight | null>(null)
  watch(
    () => (resume.value ? libraryItemIdOf(resume.value) : null),
    async id => {
      resumeInfo.value = null
      if (id === null) return
      const info = await libraryHighlight(id).catch(() => null)
      if (resume.value && libraryItemIdOf(resume.value) === id)
        resumeInfo.value = info
    },
    { immediate: true }
  )

  const fromResume = (record: ContinueRecord): HeroSlide | null => {
    const info = resumeInfo.value
    const art = info?.backdrop || record.cover || ''
    if (!art) return null
    const itemId = libraryItemIdOf(record)
    const detail = record.detail as OnlineDetailItem | undefined
    const online = record.section === 'online' ? detail : undefined
    return {
      // 与片库精选同一个键：同一部不在轮播里出现两次
      key: itemId !== null ? `library:${itemId}` : `continue:${record.id}`,
      kicker: resumeKicker(record),
      title: info?.title || record.title,
      logo: info?.logo ?? null,
      art,
      thumb: info?.thumb || record.cover || art,
      overview:
        info?.overview ||
        htmlToText(online?.vod_content || online?.overview || ''),
      meta:
        info?.meta ??
        [online?.vod_year, online?.type_name].filter((v): v is string =>
          Boolean(v)
        ),
      specs: info?.specs ?? [],
      rating: info?.rating ?? '',
      watchlist: info?.watchlist ?? null,
      playLabel: resumePlayLabel(record),
      play: async () => {
        const ok =
          libraryItemIdOf(record) !== null
            ? await resumeLibrary(record, false)
            : await openMediaPlayer({
                ...replayOptions(record),
                continueAs: metaOf(record),
              })
        if (!ok) toast.error('无法打开播放器')
      },
      open: () => openContinue(record),
    }
  }

  const fromLibrary = (item: LibraryHighlight): HeroSlide => {
    const open = (): void =>
      void router.push(libraryItemLocation(item.type, item.id))
    return {
      key: `library:${item.id}`,
      kicker: '本地片库 · 新入库',
      title: item.title,
      logo: item.logo,
      art: item.backdrop,
      thumb: item.thumb,
      overview: item.overview,
      meta: item.meta,
      specs: item.specs,
      rating: item.rating,
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
    const art = item.backdrop || item.cover || item.coverSrc
    return {
      key: `douban:${item.url}`,
      kicker: '豆瓣 · 热门电影',
      title: item.title,
      logo: null,
      art,
      artIsPoster: !item.backdrop,
      thumb: art,
      overview: item.overview,
      meta: [item.year ? `${item.year} 年` : '', item.type].filter(Boolean),
      specs: [],
      rating: formatRating(Number(item.rate), 'douban'),
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

  const featured = computed<HeroSlide[]>(() => {
    if (library.value?.length) return library.value.map(fromLibrary)
    return feed.items.value
      .filter(item => item.backdrop || item.cover || item.coverSrc)
      .slice(0, HERO_SLIDES)
      .map(fromDouban)
  })
  const slides = computed<HeroSlide[]>(() =>
    composeSlides(
      resume.value ? fromResume(resume.value) : null,
      featured.value
    )
  )
  const loading = computed(
    () =>
      !slides.value.length &&
      (library.value === null ||
        feed.status.value === 'idle' ||
        feed.status.value === 'loading')
  )
  return { slides, loading }
}
