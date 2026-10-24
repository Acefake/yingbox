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
import {
  type ComputedRef,
  type Ref,
  computed,
  ref,
  shallowRef,
  watch,
} from 'vue'

import { getSetting, setSetting } from '@/features/settings'

import type {
  DanmakuAnime,
  DanmakuComment,
} from '../../../../../shared/contract/danmaku'
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
import {
  danmakuCredentialsRevision,
  danmakuReady,
  danmakuSupported,
} from './danmaku-store'
import { createLoadTracker } from './load-tracker'

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
  /** 弹幕开关（设置 danmaku.enabled；齿轮菜单「弹幕」显示它） */
  enabled: ComputedRef<boolean>
  /** 开关弹幕；没填凭据时打开面板提示 */
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
  /** 当前条目的原始弹幕（未屏蔽） */
  let raw: DanmakuComment[] = []
  /** 当前条目的加载状态：只有成功才算完成，失败后可重试 */
  const loads = createLoadTracker()
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

  /** 取一个弹幕库的弹幕；返回是否成功（被新一轮加载取代时也算失败） */
  const loadComments = async (
    binding: DanmakuBinding,
    run: number
  ): Promise<boolean> => {
    state.loading.value = true
    state.message.value = '正在加载弹幕…'
    const reply = await fetchComments(binding.episodeId)
    if (run !== token) return false
    state.loading.value = false
    if (!reply.success) {
      state.message.value = reply.error || '弹幕加载失败'
      return false
    }
    raw = reply.data ?? []
    state.source.value = binding
    state.message.value = raw.length ? '' : '这一集还没有弹幕'
    pushComments()
    return true
  }

  /** 记下一轮加载的结果；已被新一轮取代时不动记录 */
  const settle = (key: string, run: number, ok: boolean): void => {
    if (run !== token) return
    if (ok) loads.succeed(key)
    else loads.fail(key)
  }

  /** 为当前条目找弹幕库并加载 */
  const resolve = async (notify: boolean, force = false): Promise<void> => {
    const target = options.target()
    if (!plugin || !target || !danmakuSupported()) return
    const key = JSON.stringify(target)
    if (!loads.needs(key, force)) return
    if (!state.ready.value) {
      state.message.value = '先在设置 · 弹幕里填写弹弹play AppId 和 AppSecret'
      if (notify && art)
        art.notice.show = '弹幕需要先在设置里填写弹弹play AppId'
      return
    }
    const run = ++token
    loads.start(key)
    state.loading.value = true
    state.message.value = '正在匹配弹幕…'
    state.query.value = target.title
    const found = await resolveSource(target)
    if (run !== token) return
    state.loading.value = false
    if (!found.binding) {
      state.message.value =
        found.error || '没找到对应的弹幕，可以右键「弹」按钮搜索'
      // 出错（网络、凭据）允许重试；确实没匹配到算完成
      settle(key, run, !found.error)
      return
    }
    settle(key, run, await loadComments(found.binding, run))
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
    raw = []
    loads.reset()
    state.source.value = null
    state.count.value = 0
    state.loading.value = false
    state.message.value = ''
  }

  /** 开关弹幕：没填凭据时打开面板提示，否则开关 */
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
    const key = JSON.stringify(target)
    const run = ++token
    loads.start(key)
    state.panelOpen.value = false
    state.results.value = []
    if (!enabled.value) void setSetting('danmaku.enabled', true)
    settle(key, run, await loadComments(binding, run))
  }

  watch(enabled, on => {
    if (!plugin) return
    if (on) {
      plugin.show()
      // 未加载或上次失败的条目重新加载
      void resolve(true)
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
  // 凭据填好或改过：当前条目没加载成功时补加载
  watch(
    [
      state.ready,
      () => getSetting('danmaku.appId'),
      danmakuCredentialsRevision,
    ],
    () => {
      if (state.ready.value && plugin && enabled.value) void resolve(false)
    }
  )

  const setQuery = (value: string): void => {
    state.query.value = value
  }

  return {
    state,
    attach,
    detach,
    enabled,
    toggle,
    openPanel,
    setQuery,
    search,
    bind,
  }
}
