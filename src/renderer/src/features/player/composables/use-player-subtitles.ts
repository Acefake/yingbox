/**
 * 播放器字幕：本地同目录字幕自动挂载、在线字幕（OpenSubtitles）搜索 / 下载、AI 字幕挂载，
 * 以及齿轮菜单「字幕」二级页要列的字幕轨（tracks / active，菜单见 settings-menu/install-menu.ts）。
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

/** 一条可选的字幕轨（本地候选、下载过的在线字幕、AI 字幕） */
export interface SubtitleTrack {
  name: string
  /** 本地文件路径；在线字幕为 online:<fileId> */
  path: string
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
  /** 这一集可选的字幕轨 */
  tracks: Ref<SubtitleTrack[]>
  /** 当前挂着的字幕轨路径；没有为 null */
  active: Ref<string | null>
  /** 切到某条字幕轨（菜单里选的）；成功返回 true */
  selectTrack: (path: string) => Promise<boolean>
  /** 切集 / 销毁：释放 blob URL、清空字幕轨 */
  dispose: () => void
}

/** 创建播放器的字幕状态与操作 */
export function usePlayerSubtitles(
  options: PlayerSubtitlesOptions
): PlayerSubtitles {
  let objectUrl: string | null = null
  const tracks = ref<SubtitleTrack[]>([])
  const active = ref<string | null>(null)
  /** 已转成 WebVTT 的字幕：切回来时不用再读 / 再下载 */
  const loaded = new Map<string, string>()

  const revoke = (): void => {
    if (!objectUrl) return
    URL.revokeObjectURL(objectUrl)
    objectUrl = null
  }

  /** 切集 / 销毁的世代号：挂载等待 switch 期间变了就丢弃结果 */
  let generation = 0

  const dispose = (): void => {
    generation++
    revoke()
    tracks.value = []
    active.value = null
    loaded.clear()
  }

  const addTrack = (track: SubtitleTrack): void => {
    if (!tracks.value.some(t => t.path === track.path))
      tracks.value = [...tracks.value, track]
  }

  /** 把一段 WebVTT 挂到实例上并记为当前字幕轨 */
  const mount = async (
    instance: Artplayer,
    track: SubtitleTrack,
    vtt: string
  ): Promise<boolean> => {
    if (options.player() !== instance) return false
    const started = generation
    revoke()
    const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
    objectUrl = url
    await instance.subtitle.switch(url, { name: track.name, type: 'vtt' })
    // 等待期间切集 / 关弹窗：不复活上一集的字幕轨；dispose 已释放过时不重复释放
    if (generation !== started || options.player() !== instance) {
      if (objectUrl === url) revoke()
      return false
    }
    loaded.set(track.path, vtt)
    addTrack(track)
    active.value = track.path
    return true
  }

  /** 读本地字幕文件（主进程转成 WebVTT，含 GBK 编码转换） */
  const readFile = async (path: string): Promise<string | null> => {
    const cached = loaded.get(path)
    if (cached) return cached
    const read = await window.api?.subtitle?.read(path)
    return read?.success && read.data ? read.data : null
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
      const track = { name: hit.name, path: `online:${hit.fileId}` }
      if (!(await mount(instance, track, downloaded.data))) return
      instance.subtitle.show = true
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

    for (const item of list) addTrack({ name: item.name, path: item.path })
    // 默认加载最佳匹配（与视频同名者优先）；切换在齿轮菜单「字幕」里
    try {
      const vtt = await readFile(list[0].path)
      if (vtt) await mount(instance, list[0], vtt)
    } catch {
      // 读不出就只列出候选
    }
  }

  const applyFile = async (path: string, name: string): Promise<boolean> => {
    const instance = options.player()
    if (!window.api?.subtitle?.read || !instance) return false
    try {
      const vtt = await readFile(path)
      if (!vtt || !(await mount(instance, { name, path }, vtt))) return false
      instance.subtitle.show = true
      instance.notice.show = `字幕：${name}`
      return true
    } catch {
      return false
    }
  }

  const selectTrack = async (path: string): Promise<boolean> => {
    const instance = options.player()
    const track = tracks.value.find(t => t.path === path)
    if (!instance || !track) return false
    if (active.value === path) {
      instance.subtitle.show = true
      return true
    }
    try {
      const vtt = await readFile(path)
      if (!vtt || !(await mount(instance, track, vtt))) return false
      instance.subtitle.show = true
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
    tracks,
    active,
    selectTrack,
    dispose,
  }
}
