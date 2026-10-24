/**
 * 齿轮设置菜单（照 YouTube）的纯规则：一级列表的顺序，以及各二级页面的选项（当前项打勾、
 * 一级列表右侧显示当前值）。层级面板与返回由 Artplayer 的 setting 组件提供，挂载在 install-menu.ts。
 */

/**
 * 一级列表顺序：字幕、播放速度、画质、音轨、弹幕，然后是睡眠定时、问剧情 / 前情提要、播放信息。
 * 不在表里的入口排在最后，按加入顺序。
 */
export const SETTING_ORDER: readonly string[] = [
  'ybSubtitles',
  'playbackRate',
  'ybQuality',
  'ybAudio',
  'ybDanmaku',
  'ybSleep',
  'ybRecap',
  'ybPlotQa',
  'ybPlaybackInfo',
]

/** 二级页面的一个选项 */
export interface MenuChoice {
  html: string
  /** 选中时据此执行（画质层号、音轨号、字幕路径、off / on / panel） */
  value: string
  /** 当前项（打勾） */
  default?: boolean
}

const rank = (name: string | undefined): number => {
  const i = name ? SETTING_ORDER.indexOf(name) : -1
  return i < 0 ? SETTING_ORDER.length : i
}

/** 按 SETTING_ORDER 排一级列表（稳定排序，返回新数组） */
export function orderSettings<T extends { name?: string }>(items: T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank(a.item.name) - rank(b.item.name) || a.i - b.i)
    .map(({ item }) => item)
}

/** 一级列表右侧的当前值：当前项的文字 */
export function choiceTooltip(choices: readonly MenuChoice[]): string {
  return choices.find(c => c.default)?.html ?? ''
}

/** 播放速度的显示：1 倍为「正常」 */
export function rateLabel(rate: number): string {
  return rate === 1 ? '正常' : String(rate)
}

/**
 * 画质（HLS 多码率）：「自动」在最前，其余按高度从高到低；少于两档时不出现。
 * @param levels hls.levels
 * @param current hls 当前手动层号；-1 为自动
 */
export function qualityChoices(
  levels: ReadonlyArray<{ height: number; bitrate: number }>,
  current: number
): MenuChoice[] {
  if (levels.length < 2) return []
  const sorted = levels
    .map((level, index) => ({ level, index }))
    .sort(
      (a, b) =>
        b.level.height - a.level.height || b.level.bitrate - a.level.bitrate
    )
  return [
    { html: '自动', value: '-1', default: current < 0 },
    ...sorted.map(({ level, index }) => ({
      html: level.height
        ? `${level.height}p`
        : `${Math.round(level.bitrate / 1000)} kbps`,
      value: String(index),
      default: index === current,
    })),
  ]
}

/**
 * 音轨（HLS 多音轨）：少于两条时不出现；名称缺省用语言，再缺省用序号。
 * @param current 当前音轨号
 */
export function audioChoices(
  tracks: ReadonlyArray<{ name?: string; lang?: string }>,
  current: number
): MenuChoice[] {
  if (tracks.length < 2) return []
  return tracks.map((track, index) => ({
    html: track.name || track.lang || `音轨 ${index + 1}`,
    value: String(index),
    default: index === current,
  }))
}

/**
 * 字幕：「关闭」在最前，字幕轨居中，「在线字幕与 AI 字幕…」入口在最后。
 * @param tracks 可选的字幕轨（本地同名字幕、在线下载、AI 生成）
 * @param active 当前挂着的字幕路径
 * @param shown 字幕是否显示
 */
export function subtitleChoices(
  tracks: ReadonlyArray<{ name: string; path: string }>,
  active: string | null,
  shown: boolean
): MenuChoice[] {
  const on = shown && active !== null
  return [
    { html: '关闭', value: 'off', default: !on },
    ...tracks.map(track => ({
      html: track.name,
      value: track.path,
      default: on && track.path === active,
    })),
    { html: '在线字幕与 AI 字幕…', value: 'panel' },
  ]
}

/** 弹幕：开 / 关二选一，另有「弹幕设置…」入口（搜索匹配、透明度、区域等） */
export function danmakuChoices(on: boolean): MenuChoice[] {
  return [
    { html: '开启', value: 'on', default: on },
    { html: '关闭', value: 'off', default: !on },
    { html: '弹幕设置…', value: 'panel' },
  ]
}
