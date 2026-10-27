/**
 * 片库环境光的纯规则：每个分区的强调色、从海报墙前几格挑一张做环境光的海报。
 *
 * 环境光 = 焦点海报的缩略图放大重模糊 + 分区强调色光晕 + 细噪点，铺在页面顶部、往下融进黑底，
 * 让电影 / 剧集 / 番号三页不再是一整片死黑，又不抢海报。强调色只用在光晕、计数、未看圆点这类小处。
 */
import type { LibrarySection } from '../state/library-section'

/** 分区强调色：电影暖金、剧集冷蓝、番号玫粉。 */
export interface AmbientTone {
  /** 小处点缀用的实色（计数、未看圆点）。 */
  accent: string
  /** 顶部光晕用的半透明色。 */
  glow: string
}

export const AMBIENT_TONES: Readonly<Record<LibrarySection, AmbientTone>> = {
  movie: { accent: '#f0b65e', glow: 'rgba(240, 170, 80, 0.30)' },
  tv: { accent: '#6fb1ff', glow: 'rgba(80, 150, 255, 0.30)' },
  jav: { accent: '#ff7a9a', glow: 'rgba(255, 90, 140, 0.28)' },
}

/** 只看海报墙最前面这么多格：环境光跟着「打开页面第一眼看到的」走，不随滚动乱跳。 */
export const AMBIENT_LOOKAHEAD = 12

/** 能按下标取条目的列表（PagedList 满足；未加载的格是 undefined）。 */
export interface IndexedList<T> {
  readonly length: number
  at(index: number): T | undefined
}

/**
 * 从列表前 AMBIENT_LOOKAHEAD 格里挑第一张有海报的；都没有返回 null（只留光晕）。
 */
export function ambientPosterOf<T extends { poster: string | null }>(
  list: IndexedList<T>,
  lookahead = AMBIENT_LOOKAHEAD
): string | null {
  const end = Math.min(list.length, lookahead)
  for (let i = 0; i < end; i++) {
    const poster = list.at(i)?.poster
    if (poster) return poster
  }
  return null
}

/** 页面根节点上的 CSS 变量：环境光层和工具栏计数等小处都从这里取分区色。 */
export function ambientVars(section: LibrarySection): Record<string, string> {
  const tone = AMBIENT_TONES[section]
  return { '--ambient-accent': tone.accent, '--ambient-glow': tone.glow }
}
