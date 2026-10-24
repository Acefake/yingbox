/**
 * 播放器的弹幕：在 Artplayer 实例上装 artplayer-plugin-danmuku，为当前条目找弹幕库、取弹幕，
 * 跟随设置（开关、不透明度、区域、速度、字号、屏蔽词）实时更新；面板的搜索与手动绑定也在这里。
 * 每换一个实例（换集）重新 attach；mpv 不走这里。
 */
import type Artplayer from 'artplayer'
import artplayerPluginDanmuku, {
  type Option as DanmukuOption,
  type Result as DanmukuPlugin,
} from 'artplayer-plugin-danmuku'
import { type Ref, computed, ref, shallowRef, watch } from 'vue'

import { getSetting, setSetting } from '@/features/settings'

import type {
  DanmakuAnime,
  DanmakuComment,
} from '../../../../../shared/contract/danmaku'
import { type ArtControl, danmakuControl } from './danmaku-control'
import {
  type DanmakuBinding,
  type DanmakuTarget,
  parseBlockWords,
  pluginLook,
  prepareComments,
} from './danmaku-rules'
import {
  bindManually,
  fetchComments,
  resolveSource,
  searchAnimes,
} from './danmaku-source'
import { danmakuReady, danmakuSupported } from './danmaku-store'

/** 面板与播放器共用的弹幕状态 */
export interface DanmakuState {
  panelOpen: Ref<boolean>
  /** 当前弹幕库 */
  source: Ref<DanmakuBinding | null>
  /** 当前弹幕条数（屏蔽后） */
  count: Ref<number>
  /** 状态说明（加载中、没找到、出错） */
  message: Ref<string>
  loading: Ref<boolean>
  /** 凭据是否已填 */
  ready: Ref<boolean>
  query: Ref<string>
  searching: Ref<boolean>
  results: Ref<DanmakuAnime[]>
  searchMessage: Ref<string>
}

/** useDanmaku 的输入 */
export interface DanmakuOptions {
  /** 当前播放条目；为 null 时不加载 */
  target: () => DanmakuTarget | null
}

/** useDanmaku 交给播放器组件的接口 */
export interface DanmakuController {
  state: DanmakuState
  /** 装到新的 Artplayer 实例上 */
  attach: (instance: Artplayer) => Promise<void>
  /** 实例销毁前拆下 */
  detach: () => void
  /** 控制栏「弹」按钮 */
  control: () => ArtControl
  toggle: () => void
  openPanel: () => void
  setQuery: (value: string) => void
  search: () => Promise<void>
  bind: (
    anime: DanmakuAnime,
    episode: DanmakuAnime['episodes'][number]
  ) => Promise<void>
}

/** 弹幕 composable */
export function useDanmaku(options: DanmakuOptions): DanmakuController {
  const state: DanmakuState = {
    panelOpen: ref(false),
    source: shallowRef(null),
    count: ref(0),
    message: ref(''),
    loading: ref(false),
    ready: computed(danmakuReady),
    query: ref(''),
    searching: ref(false),
    results: shallowRef([]),
    searchMessage: ref(''),
  }

  let art: Artplayer | null = null
  let plugin: DanmukuPlugin | null = null
  let buttons: HTMLElement[] = []
  /** 当前条目的原始弹幕（未屏蔽） */
  let raw: DanmakuComment[] = []
  let loadedFor = ''
  let token = 0

  const enabled = computed(() => getSetting('danmaku.enabled'))
  const look = computed(() =>
    pluginLook({
      opacity: getSetting('danmaku.opacity'),
      area: getSetting('danmaku.area'),
      speed: getSetting('danmaku.speed'),
      fontSize: getSetting('danmaku.fontSize'),
    })
  )
  const blockRules = computed(() =>
    parseBlockWords(getSetting('danmaku.blockWords'))
  )

  const renderButtons = (): void => {
    for (const el of buttons) el.classList.toggle('is-active', enabled.value)
  }

  /** 把弹幕（屏蔽、偏移后）交给插件 */
  const pushComments = (): void => {
    if (!plugin) return
    const list = prepareComments(
      raw,
      blockRules.value,
      state.source.value?.shift ?? 0
    )
    state.count.value = list.length
    // load(list) 只追加；替换整份要改 option.danmuku 再无参 load
    plugin.option.danmuku = list.map(c => ({ ...c }))
    void plugin.load()
  }

  /** 取一个弹幕库的弹幕 */
  const loadComments = async (
    binding: DanmakuBinding,
    run: number
  ): Promise<void> => {
    state.loading.value = true
    state.message.value = '正在加载弹幕…'
    const reply = await fetchComments(binding.episodeId)
    if (run !== token) return
    state.loading.value = false
    if (!reply.success) {
      state.message.value = reply.error || '弹幕加载失败'
      return
    }
    raw = reply.data ?? []
    state.source.value = binding
    state.message.value = raw.length ? '' : '这一集还没有弹幕'
    pushComments()
  }

  /** 为当前条目找弹幕库并加载 */
  const resolve = async (notify: boolean, force = false): Promise<void> => {
    const target = options.target()
    if (!plugin || !target || !danmakuSupported()) return
    if (!force && loadedFor === JSON.stringify(target)) return
    if (!state.ready.value) {
      state.message.value = '先在设置 · 弹幕里填写弹弹play AppId 和 AppSecret'
      if (notify && art)
        art.notice.show = '弹幕需要先在设置里填写弹弹play AppId'
      return
    }
    const run = ++token
    loadedFor = JSON.stringify(target)
    state.loading.value = true
    state.message.value = '正在匹配弹幕…'
    state.query.value = target.title
    const found = await resolveSource(target)
    if (run !== token) return
    state.loading.value = false
    if (!found.binding) {
      state.message.value =
        found.error || '没找到对应的弹幕，可以右键「弹」按钮搜索'
      return
    }
    await loadComments(found.binding, run)
    if (run === token && found.uncertain && art)
      art.notice.show = `弹幕：${found.binding.animeTitle} ${found.binding.episodeTitle}（不对可右键「弹」搜索）`
  }

  /** 装到新实例上（换集时 UnifiedVideoPlayer 新建实例后调用） */
  const attach = async (instance: Artplayer): Promise<void> => {
    if (!danmakuSupported()) return
    art = instance
    await instance.plugins.add(
      artplayerPluginDanmuku({
        danmuku: [],
        emitter: false,
        antiOverlap: true,
        synchronousPlayback: true,
        visible: enabled.value,
        ...look.value,
      })
    )
    if (art !== instance) return
    plugin = (instance.plugins.artplayerPluginDanmuku as DanmukuPlugin) ?? null
    if (enabled.value) void resolve(false)
  }

  /** 拆下（实例销毁前调用）：插件随 Artplayer 一起销毁 */
  const detach = (): void => {
    token++
    art = null
    plugin = null
    buttons = []
    raw = []
    loadedFor = ''
    state.source.value = null
    state.count.value = 0
    state.loading.value = false
    state.message.value = ''
  }

  /** 单击「弹」：没填凭据时打开面板提示，否则开关 */
  const toggle = (): void => {
    if (!state.ready.value) {
      state.panelOpen.value = true
      void resolve(true, true)
      return
    }
    void setSetting('danmaku.enabled', !enabled.value)
  }

  const openPanel = (): void => {
    state.panelOpen.value = true
  }

  /** 控制栏按钮（每个实例一个） */
  const control = (): ArtControl =>
    danmakuControl({
      toggle,
      openPanel,
      mounted: $el => {
        buttons.push($el)
        renderButtons()
      },
    })

  /** 面板里搜索作品 */
  const search = async (): Promise<void> => {
    const keyword = state.query.value.trim()
    if (keyword.length < 2) {
      state.searchMessage.value = '作品名至少 2 个字'
      return
    }
    state.searching.value = true
    state.searchMessage.value = ''
    const reply = await searchAnimes(keyword)
    state.searching.value = false
    if (!reply.success) {
      state.searchMessage.value = reply.error || '搜索失败'
      state.results.value = []
      return
    }
    state.results.value = reply.data ?? []
    if (!state.results.value.length) state.searchMessage.value = '没有结果'
  }

  /** 面板里选定作品和集：绑定到当前条目并加载 */
  const bind = async (
    anime: DanmakuAnime,
    episode: DanmakuAnime['episodes'][number]
  ): Promise<void> => {
    const target = options.target()
    if (!target) return
    const binding = bindManually(target, {
      animeId: anime.animeId,
      animeTitle: anime.animeTitle,
      episodeId: episode.episodeId,
      episodeTitle: episode.episodeTitle,
    })
    loadedFor = JSON.stringify(target)
    state.panelOpen.value = false
    state.results.value = []
    if (!enabled.value) void setSetting('danmaku.enabled', true)
    await loadComments(binding, ++token)
  }

  watch(enabled, on => {
    renderButtons()
    if (!plugin) return
    if (on) {
      plugin.show()
      const target = options.target()
      if (target && loadedFor !== JSON.stringify(target)) void resolve(true)
    } else plugin.hide()
  })
  watch(look, value => plugin?.config({ ...value } as DanmukuOption))
  watch(blockRules, pushComments)
  watch(
    () => JSON.stringify(options.target()),
    () => {
      if (plugin && enabled.value) void resolve(false)
    }
  )
  // 凭据刚填好：当前条目补加载
  watch(state.ready, ok => {
    if (ok && plugin && enabled.value) void resolve(false)
  })

  const setQuery = (value: string): void => {
    state.query.value = value
  }

  return {
    state,
    attach,
    detach,
    control,
    toggle,
    openPanel,
    setQuery,
    search,
    bind,
  }
}
