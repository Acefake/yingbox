/**
 * 播放器字幕：本地同目录字幕自动挂载（多个候选时加切换菜单）与在线字幕（OpenSubtitles）搜索 / 下载。
 * 字幕统一由主进程转成 WebVTT，以 blob URL 交给 Artplayer；切集或销毁期间返回的结果直接丢弃。
 */
import { type Ref, ref } from 'vue'
import type Artplayer from 'artplayer'

/** 本地字幕候选（同目录 .srt/.ass/.vtt） */
export interface LocalSubtitle {
  name: string
  path: string
  ext: string
}

/** 在线字幕搜索结果的一项 */
export interface OnlineSubtitleHit {
  name: string
  language: string
  downloads: number
  rating?: number
  size?: number
  format: string
  fileId: number
}

/** 在线字幕的搜索条件（每次搜索时读取） */
export interface SubtitleSearchContext {
  /** 搜索关键词（通常是影视名） */
  title: string
  /** IMDB id，有则大幅提高匹配精度 */
  imdbId?: string
  /** 剧集的季 / 集 */
  season?: number
  episode?: number
}

/** usePlayerSubtitles 的依赖 */
export interface PlayerSubtitlesOptions {
  /** 当前的 Artplayer 实例（切集 / 销毁后会变），用来判断异步结果是否过期 */
  player: () => Artplayer | null
  /** 在线字幕的默认搜索条件 */
  search: () => SubtitleSearchContext
}

/** usePlayerSubtitles 的返回值 */
export interface PlayerSubtitles {
  panelOpen: Ref<boolean>
  query: Ref<string>
  hits: Ref<OnlineSubtitleHit[]>
  searching: Ref<boolean>
  downloadingId: Ref<number | null>
  message: Ref<string>
  /** 开关在线字幕面板；首次打开自动按标题搜一次 */
  togglePanel: () => void
  /** 搜索在线字幕 */
  search: () => Promise<void>
  /** 下载并挂载一条在线字幕 */
  applyOnline: (hit: OnlineSubtitleHit) => Promise<void>
  /** 为本地视频自动挂载同目录字幕 */
  applyLocal: (instance: Artplayer, source: string) => Promise<void>
  /** 挂载一个字幕文件（AI 字幕生成后用）；成功返回 true */
  applyFile: (path: string, name: string) => Promise<boolean>
  /** 释放当前字幕的 blob URL */
  dispose: () => void
}

/** 创建播放器的字幕状态与操作 */
export function usePlayerSubtitles(
  options: PlayerSubtitlesOptions
): PlayerSubtitles {
  let objectUrl: string | null = null

  const dispose = (): void => {
    if (!objectUrl) return
    URL.revokeObjectURL(objectUrl)
    objectUrl = null
  }

  const isLocalSource = (url: string): boolean => url.startsWith('local://')

  // ── 在线字幕（OpenSubtitles）────────────────────────────

  const panelOpen = ref(false)
  const query = ref('')
  const hits = ref<OnlineSubtitleHit[]>([])
  const searching = ref(false)
  const downloadingId = ref<number | null>(null)
  const message = ref('')

  const togglePanel = (): void => {
    panelOpen.value = !panelOpen.value
    if (panelOpen.value && !hits.value.length) {
      // 首次打开自动用标题搜一次
      search()
    }
  }

  const search = async (): Promise<void> => {
    const api = window.api?.subtitle
    if (!api?.searchOnline) {
      message.value = '当前环境不支持在线字幕（需 Electron）'
      return
    }
    const keyword = (query.value || options.search().title || '').trim()
    if (!keyword) {
      message.value = '请输入影视名称'
      return
    }
    searching.value = true
    message.value = ''
    hits.value = []
    try {
      const result = await api.searchOnline({
        query: keyword,
        imdbId: options.search().imdbId || undefined,
        season: options.search().season,
        episode: options.search().episode,
      })
      if (!result?.success) {
        message.value = result?.notConfigured
          ? '未配置 API key：在启动环境设置 YINGBOX_OPENSUBTITLES_KEY 后重启应用'
          : result?.error || '搜索失败'
        return
      }
      hits.value = result.data || []
      if (!hits.value.length) message.value = '无结果'
    } catch (error) {
      message.value = (error as Error).message
    } finally {
      searching.value = false
    }
  }

  /** 下载并挂载在线字幕（与本地字幕共用同一 blob 挂载链路） */
  const applyOnline = async (hit: OnlineSubtitleHit): Promise<void> => {
    const api = window.api?.subtitle
    const instance = options.player()
    if (!api?.downloadOnline || !instance) return
    downloadingId.value = hit.fileId
    try {
      const downloaded = await api.downloadOnline(hit.fileId)
      if (!downloaded?.success || !downloaded.data) {
        message.value = downloaded?.notConfigured
          ? '未配置 API key：设置 YINGBOX_OPENSUBTITLES_KEY 后重启应用'
          : downloaded?.error || '下载失败'
        return
      }
      if (options.player() !== instance) return
      dispose()
      objectUrl = URL.createObjectURL(
        new Blob([downloaded.data], { type: 'text/vtt' })
      )
      await instance.subtitle.switch(objectUrl, {
        name: hit.name,
        type: 'vtt',
      })
      instance.notice.show = `字幕：${hit.name}`
      panelOpen.value = false
    } catch (error) {
      message.value = (error as Error).message
    } finally {
      downloadingId.value = null
    }
  }

  /**
   * 为本地视频自动挂载同目录字幕。
   *
   * 字幕文件可能是 GBK 编码的 srt/ass，由主进程统一读成 WebVTT 后
   * 以 blob URL 交给 Artplayer（避免 local:// 跨源读取限制）。
   */
  const applyLocal = async (
    instance: Artplayer,
    source: string
  ): Promise<void> => {
    const subtitleApi = window.api?.subtitle
    if (!subtitleApi || !isLocalSource(source)) return

    let list: LocalSubtitle[] = []
    try {
      const found = await subtitleApi.find(source)
      if (!found?.success || !Array.isArray(found.data)) return
      list = found.data
    } catch {
      return
    }
    // 等待期间可能已切集/销毁播放器，此时放弃挂载
    if (!list.length || options.player() !== instance) return

    const switchTo = async (item: LocalSubtitle): Promise<boolean> => {
      if (options.player() !== instance) return false
      try {
        const read = await subtitleApi.read(item.path)
        if (!read?.success || !read.data) return false
        if (options.player() !== instance) return false
        dispose()
        objectUrl = URL.createObjectURL(
          new Blob([read.data], { type: 'text/vtt' })
        )
        await instance.subtitle.switch(objectUrl, {
          name: item.name,
          type: 'vtt',
        })
        return true
      } catch {
        return false
      }
    }

    // 默认加载最佳匹配（与视频同名者优先）
    const applied = await switchTo(list[0])
    if (!applied || options.player() !== instance) return

    // 多个候选时提供字幕切换菜单；菜单失败不应影响已生效的字幕
    if (list.length > 1) {
      try {
        instance.setting.add({
          name: 'localSubtitle',
          html: '字幕',
          selector: list.map(item => ({
            html: item.name,
            subtitlePath: item.path,
          })),
          onSelect(
            this: Artplayer,
            item: { html: string; subtitlePath?: string }
          ) {
            const target = list.find(sub => sub.path === item.subtitlePath)
            if (target) void switchTo(target)
            this.notice.show = `字幕：${item.html}`
          },
        })
      } catch {
        // ignore
      }
    }
  }

  const applyFile = async (path: string, name: string): Promise<boolean> => {
    const api = window.api?.subtitle
    const instance = options.player()
    if (!api?.read || !instance) return false
    try {
      const read = await api.read(path)
      if (!read?.success || !read.data || options.player() !== instance)
        return false
      dispose()
      objectUrl = URL.createObjectURL(
        new Blob([read.data], { type: 'text/vtt' })
      )
      await instance.subtitle.switch(objectUrl, { name, type: 'vtt' })
      instance.subtitle.show = true
      instance.notice.show = `字幕：${name}`
      return true
    } catch {
      return false
    }
  }

  return {
    panelOpen,
    query,
    hits,
    searching,
    downloadingId,
    message,
    togglePanel,
    search,
    applyOnline,
    applyLocal,
    applyFile,
    dispose,
  }
}
