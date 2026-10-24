/**
 * 齿轮设置菜单（照 YouTube）：在 Artplayer 的 setting 组件上装「字幕」「画质」「音轨」「弹幕」四个二级页，
 * 并让一级列表始终按 SETTING_ORDER 排（别处加进来的睡眠定时、播放信息、问剧情等也一起排）。
 * 层级面板、返回按钮、当前项打勾与右侧当前值由 Artplayer 提供；选项与顺序的规则在 menu-rules.ts。
 */
import type { default as Artplayer, Setting } from 'artplayer'
import type Hls from 'hls.js'
import { type Ref, type WatchStopHandle, watch } from 'vue'

import type { SubtitleTrack } from '../composables/use-player-subtitles'
import {
  type MenuChoice,
  audioChoices,
  choiceTooltip,
  danmakuChoices,
  orderSettings,
  qualityChoices,
  subtitleChoices,
} from './menu-rules'

/** 菜单读写的播放器状态 */
export interface SettingsMenuSources {
  subtitles: {
    tracks: Ref<SubtitleTrack[]>
    active: Ref<string | null>
    select: (path: string) => Promise<boolean>
    /** 在线字幕与 AI 字幕面板 */
    openPanel: () => void
  }
  /** 没有弹幕（不支持或这个条目不匹配弹幕）时为 null */
  danmaku: {
    enabled: Ref<boolean>
    toggle: () => void
    openPanel: () => void
  } | null
  /** 当前的 hls.js 实例（画质 / 音轨）；非 HLS 为 null */
  hls: () => Hls | null
}


/** 一级列表按 SETTING_ORDER 重排：原地改数组（Artplayer 按数组缓存面板），再按新顺序挪 DOM */
function reorder(art: Artplayer): void {
  const setting = art.setting as unknown as {
    option?: Array<{ name?: string; $item?: HTMLElement }>
  }
  const list = setting.option
  if (!Array.isArray(list)) return
  const sorted = orderSettings(list)
  if (sorted.every((item, i) => item === list[i])) return
  list.splice(0, list.length, ...sorted)
  for (const item of list) item.$item?.parentElement?.appendChild(item.$item)
}

/** 加或换一个带二级页的入口；choices 为空时移除 */
function upsert(
  art: Artplayer,
  name: string,
  html: string,
  choices: MenuChoice[],
  pick: (value: string) => void
): void {
  const exists = Boolean(art.setting.find(name))
  if (!choices.length) {
    if (exists) art.setting.remove(name)
    return
  }
  // Artplayer 用 onSelect 的返回值更新一级列表右侧的当前值（类型声明写的是 void）
  const entry = {
    name,
    html,
    tooltip: choiceTooltip(choices),
    selector: choices.map(c => ({ ...c })),
    onSelect: (item: { value?: string; html: string }) => {
      pick(String(item.value ?? ''))
      return item.html
    },
  } as unknown as Setting
  if (exists) art.setting.update(entry)
  else art.setting.add(entry)
}

/** 装菜单；实例销毁时停掉对状态的监听 */
export function installSettingsMenu(
  art: Artplayer,
  sources: SettingsMenuSources
): void {
  if (!art.setting?.add) return
  const stops: WatchStopHandle[] = []

  // 别处（睡眠定时、播放信息、前情提要……）加入口后也重排
  const add = art.setting.add.bind(art.setting)
  art.setting.add = ((item: Setting) => {
    const added = add(item)
    reorder(art)
    return added
  }) as typeof art.setting.add

  const { subtitles, danmaku } = sources
  const renderSubtitles = (): void =>
    upsert(
      art,
      'ybSubtitles',
      '字幕',
      subtitleChoices(
        subtitles.tracks.value,
        subtitles.active.value,
        art.subtitle?.show === true
      ),
      value => {
        if (value === 'panel') {
          art.setting.show = false
          subtitles.openPanel()
        } else if (value === 'off') art.subtitle.show = false
        else void subtitles.select(value)
      }
    )
  renderSubtitles()
  stops.push(
    watch([subtitles.tracks, subtitles.active], renderSubtitles, {
      flush: 'post',
    })
  )
  art.on('subtitle', renderSubtitles)

  if (danmaku) {
    const renderDanmaku = (): void =>
      upsert(
        art,
        'ybDanmaku',
        '弹幕',
        danmakuChoices(danmaku.enabled.value),
        value => {
          if (value === 'panel') {
            art.setting.show = false
            danmaku.openPanel()
          } else if ((value === 'on') !== danmaku.enabled.value)
            danmaku.toggle()
        }
      )
    renderDanmaku()
    stops.push(watch(danmaku.enabled, renderDanmaku))
  }

  // 画质 / 音轨：HLS 清单解析后才知道有几档
  const renderStreams = (): void => {
    const hls = sources.hls()
    if (!hls) return
    upsert(
      art,
      'ybQuality',
      '画质',
      qualityChoices(
        hls.levels ?? [],
        hls.autoLevelEnabled ? -1 : hls.currentLevel
      ),
      value => {
        hls.currentLevel = Number(value)
      }
    )
    upsert(
      art,
      'ybAudio',
      '音轨',
      audioChoices(hls.audioTracks ?? [], hls.audioTrack),
      value => {
        hls.audioTrack = Number(value)
      }
    )
  }
  art.on('video:loadedmetadata', renderStreams)

  reorder(art)
  art.on('destroy', () => {
    for (const stop of stops) stop()
  })
}
