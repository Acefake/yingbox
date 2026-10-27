/**
 * 设置面板的分区注册表。面板只按表渲染，加一个分区只需在这里（或所属功能里）登记一项。
 *
 * 分区组件在打开时才加载（load 返回动态 import），可以 defineExpose({ canLeave })
 * 拦截离开（例如有未保存修改）。打开设置时传入的 "<分区>:<子页>" 中的子页以 sub 属性交给分区。
 */
import { type Component, shallowReactive } from 'vue'
import type { IconName } from '@/components/ui/icons'

/** 一个设置分区 */
export interface SettingsSection {
  /** 唯一标识，也是 app:open-settings 事件里的分区名 */
  id: string
  /** 导航与标题文字 */
  title: string
  /** 导航图标 */
  icon: IconName
  /** 搜索设置时额外匹配的关键词 */
  keywords: string
  /** 懒加载分区组件 */
  load: () => Promise<{ default: Component }>
  /** 只在成人模式下显示 */
  adultOnly?: boolean
  /** 只在桌面端有意义（AI、软件更新等依赖主进程）；网页端不登记 */
  desktopOnly?: boolean
  /** 分区自己管理滚动，独占内容区（默认由面板统一滚动） */
  fill?: boolean
  /** 固定传给分区组件的属性 */
  props?: Record<string, unknown>
  /** 导航中的排序值（升序）；省略时排在最后 */
  order?: number
}

/** 设置模块自带的分区 */
const coreSections: SettingsSection[] = [
  {
    id: 'appearance',
    title: '外观',
    icon: 'sun',
    keywords: '主题 深色 浅色 悬停 预览 预告片 防剧透 剧照 简介',
    load: () => import('./sections/AppearanceSettings.vue'),
    order: 10,
  },
  {
    id: 'scrape',
    title: '刮削',
    icon: 'download',
    keywords:
      '元数据 语言 中文 豆瓣 简介 tmdb token 令牌 密钥 图片质量 海报 背景图 演员 头像 尺寸 清晰度',
    load: () => import('./sections/ScrapeSettings.vue'),
    order: 30,
  },
  {
    id: 'player',
    title: '播放器',
    icon: 'play',
    keywords: 'mpv 引擎 artplayer 超分 小窗 画中画 置顶',
    load: () => import('./sections/PlayerSettings.vue'),
    order: 60,
  },
  {
    id: 'danmaku',
    title: '弹幕',
    icon: 'subtitle',
    keywords: '弹幕 弹弹play dandanplay appid appsecret',
    load: () => import('./sections/DanmakuSettings.vue'),
    order: 65,
  },
  {
    id: 'ai',
    title: 'AI',
    icon: 'sparkle',
    keywords:
      'ai 助手 快捷键 siri 唤起 alt space 模型 openai deepseek openrouter opencode ollama key 语音识别 whisper 用量 私密',
    load: () => import('./sections/AiSettings.vue'),
    order: 67,
    desktopOnly: true,
  },
  {
    id: 'update',
    title: '软件更新',
    icon: 'refresh',
    keywords: '版本 下载 重启',
    load: () => import('./sections/UpdateSettings.vue'),
    order: 80,
    desktopOnly: true,
  },
]

/** 网页端（没有 Electron preload）：只在桌面端有意义的分区不登记 */
const webRuntime = typeof window !== 'undefined' && !window.api
const fitsRuntime = (section: SettingsSection): boolean =>
  !section.desktopOnly || !webRuntime

/** 全部分区（按 order 升序显示，order 相同或缺省时按登记顺序） */
export const settingsSections = shallowReactive<SettingsSection[]>(
  coreSections.filter(fitsRuntime)
)

const orderOf = (section: SettingsSection): number =>
  section.order ?? Number.POSITIVE_INFINITY

/**
 * 登记一个由其它 feature 提供的分区（由应用入口组合），按 order 插入到对应位置；
 * 同 id 重复登记时以后者为准。
 */
export function registerSettingsSection(section: SettingsSection): void {
  if (!fitsRuntime(section)) return
  const existing = settingsSections.findIndex(item => item.id === section.id)
  if (existing >= 0) settingsSections.splice(existing, 1)
  const at = settingsSections.findIndex(
    item => orderOf(item) > orderOf(section)
  )
  if (at < 0) settingsSections.push(section)
  else settingsSections.splice(at, 0, section)
}
