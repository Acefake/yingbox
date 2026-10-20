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
  /** 分区自己管理滚动，独占内容区（默认由面板统一滚动） */
  fill?: boolean
  /** 固定传给分区组件的属性 */
  props?: Record<string, unknown>
}

/** 设置模块自带的分区 */
const coreSections: SettingsSection[] = [
  {
    id: 'appearance',
    title: '外观',
    icon: 'sun',
    keywords: '主题 深色 浅色',
    load: () => import('./sections/AppearanceSettings.vue'),
  },
  {
    id: 'images',
    title: '图片质量',
    icon: 'image',
    keywords: '海报 背景图 演员 尺寸',
    load: () => import('./sections/ImageSettings.vue'),
  },
  {
    id: 'scrape',
    title: '刮削',
    icon: 'download',
    keywords: '并发 元数据 语言 tmdb',
    load: () => import('./sections/ScrapeSettings.vue'),
  },
  {
    id: 'provider',
    title: '服务',
    icon: 'globe',
    keywords: 'tmdb token 后端 密钥 自定义 连接',
    load: () => import('./sections/ProviderSettings.vue'),
  },
  {
    id: 'sources',
    title: '数据源',
    icon: 'database',
    keywords: 'cms av 在线源 插件 站点',
    load: () => import('@/components/SourceManagerPanel.vue'),
    fill: true,
    props: { embedded: true, visible: true },
  },
  {
    id: 'player',
    title: '播放器',
    icon: 'play',
    keywords: 'mpv 引擎 artplayer 超分',
    load: () => import('./sections/PlayerSettings.vue'),
  },
  {
    id: 'lada',
    title: '去马赛克',
    icon: 'wand',
    keywords: 'lada 去码 马赛克 无码 mpv 路径',
    load: () => import('./sections/LadaSettings.vue'),
    adultOnly: true,
  },
  {
    id: 'update',
    title: '软件更新',
    icon: 'refresh',
    keywords: '版本 下载 重启',
    load: () => import('./sections/UpdateSettings.vue'),
  },
]

/** 全部分区（按登记顺序显示） */
export const settingsSections = shallowReactive<SettingsSection[]>([
  ...coreSections,
])

/** 登记一个由其它功能提供的分区；同 id 重复登记时以后者为准 */
export function registerSettingsSection(section: SettingsSection): void {
  const index = settingsSections.findIndex(item => item.id === section.id)
  if (index >= 0) settingsSections.splice(index, 1, section)
  else settingsSections.push(section)
}
