/**
 * 海报悬停预览（Netflix 式）的显隐与定位：悬停 420ms 后弹出、离开 180ms 后收起、
 * 移到卡片上保持；卡片上的「播放 / 去码 / 边跑边看」按需取影片的第一个文件。
 * 轮播图逻辑在 FilmHoverCard 组件里。
 */
import { type Ref, ref } from 'vue'
import { message } from 'ant-design-vue'
import { type AmaneDetail, type AmaneFilm, amaneRequest } from '../api/amane'
import { hoverPosition } from '../utils/film'

export interface FilmHoverOptions {
  error: Ref<string>
  isDisposed: () => boolean
  /** 多选中不弹预览 */
  selecting: () => boolean
  openFilm: (id: number) => Promise<void>
}

export function useFilmHover(options: FilmHoverOptions) {
  const hoverFilm = ref<AmaneFilm | null>(null)
  const hoverStyle = ref<Record<string, string>>({})
  const hoverActionBusy = ref(false)
  /** 影片 id → 第一个文件 id（null = 没有文件）；列表整页刷新时清空 */
  const hoverFileCache = new Map<number, number | null>()
  let hoverTimer: number | undefined
  let hoverHideTimer: number | undefined

  function hideHover(): void {
    clearTimeout(hoverTimer)
    clearTimeout(hoverHideTimer)
    if (hoverFilm.value) hoverFilm.value = null
  }

  function showHover(film: AmaneFilm, el: HTMLElement): void {
    if (options.isDisposed()) return
    const { left, top } = hoverPosition(el.getBoundingClientRect(), {
      width: window.innerWidth,
      height: window.innerHeight,
    })
    hoverStyle.value = { left: `${left}px`, top: `${top}px` }
    hoverFilm.value = film
  }

  function filmHoverEnter(film: AmaneFilm, event: PointerEvent): void {
    if (
      event.pointerType === 'touch' ||
      options.isDisposed() ||
      options.selecting()
    )
      return
    clearTimeout(hoverTimer)
    clearTimeout(hoverHideTimer)
    if (hoverFilm.value?.id === film.id) return
    const el = event.currentTarget as HTMLElement
    hoverTimer = window.setTimeout(() => showHover(film, el), 420)
  }

  function filmHoverLeave(): void {
    clearTimeout(hoverTimer)
    clearTimeout(hoverHideTimer)
    hoverHideTimer = window.setTimeout(() => {
      hoverFilm.value = null
    }, 180)
  }

  function hoverCardEnter(): void {
    clearTimeout(hoverHideTimer)
    clearTimeout(hoverTimer)
  }

  function hoverOpen(): void {
    const film = hoverFilm.value
    if (!film) return
    hideHover()
    void options.openFilm(film.id)
  }

  /** 列表项不含文件 ID;点操作时按影片拉一次详情并缓存。 */
  async function firstFileId(filmId: number): Promise<number | null> {
    const cached = hoverFileCache.get(filmId)
    if (cached !== undefined) return cached
    const detail = await amaneRequest<AmaneDetail>(`/metadata/${filmId}`)
    const id = detail.files[0]?.id ?? null
    hoverFileCache.set(filmId, id)
    return id
  }

  /** 对悬停影片的第一个文件执行操作；没有文件时提示 */
  async function hoverFileAction(
    action: (fileId: number) => Promise<void>
  ): Promise<void> {
    const film = hoverFilm.value
    if (!film || hoverActionBusy.value) return
    hoverActionBusy.value = true
    try {
      const id = await firstFileId(film.id)
      if (id === null) {
        message.info('该影片还没有关联本地文件')
        return
      }
      hideHover()
      await action(id)
    } catch (e) {
      options.error.value = (e as Error).message
    } finally {
      hoverActionBusy.value = false
    }
  }

  /** 影片列表整页刷新：清文件缓存；悬停的影片已不在列表里就收起 */
  function onFilmsReplaced(films: AmaneFilm[]): void {
    const hoveredId = hoverFilm.value?.id
    hoverFileCache.clear()
    if (hoveredId && !films.some(item => item.id === hoveredId)) hideHover()
  }

  return {
    hoverFilm,
    hoverStyle,
    hoverActionBusy,
    hideHover,
    filmHoverEnter,
    filmHoverLeave,
    hoverCardEnter,
    hoverOpen,
    hoverFileAction,
    onFilmsReplaced,
  }
}
