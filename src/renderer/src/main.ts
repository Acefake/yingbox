import './assets/main.css'

import { createApp } from 'vue'
import App from '@/App.vue'
import router from '@/router/index'
import { routes } from '@/router/routers'
import { setupDirectives } from '@/directives'
import { initTheme } from '@/utils/theme'
import { registerPwa } from '@/pwa'
import {
  assistantSettingsSection,
  installPrivateSkills,
} from '@/features/assistant'
import { aiAvailable } from '@/features/ai'
import { downloadSettingsSection } from '@/features/download'
import { ladaSettingsSection } from '@/features/lada'
import { netdiskAvailable, netdiskSettingsSection } from '@/features/netdisk'
import { sourcesSettingsSection } from '@/features/online'
import {
  sectionLockAvailable,
  sectionLockSettingsSection,
} from '@/features/section-lock'
import { getSetting, registerSettingsSection } from '@/features/settings'
import { installWatchlist } from '@/features/watchlist'
import { installLibraryProgress } from '@/features/library'
import { configureHoverPreview } from '@/components/ui/hover-preview'

/**
 * 网页端：清掉旧链接地址栏里一次性携带的密钥参数 `key`（Go 后端密钥），不留在历史记录里。
 */
function bindPhoneBootstrap(): void {
  const params = new URLSearchParams(window.location.search)
  if (!params.has('key')) return
  params.delete('key')
  const rest = params.toString()
  window.history.replaceState(
    {},
    '',
    `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`
  )
}

if (!window.api?.win) bindPhoneBootstrap()

initTheme()

// 各 feature 自己定义设置分区，在应用入口组合进设置面板（按 order 排位）
for (const section of [
  assistantSettingsSection,
  sourcesSettingsSection,
  ladaSettingsSection,
  downloadSettingsSection,
]) {
  registerSettingsSection(section)
}
// 网盘（115 登录、转存）只在桌面端
if (netdiskAvailable) registerSettingsSection(netdiskSettingsSection)
// 板块锁只在桌面端（主进程保存密码哈希）；可锁的板块读路由表
if (sectionLockAvailable)
  registerSettingsSection(sectionLockSettingsSection(routes))

// 卡片悬停预览读设置里的开关与等待时间（每次悬停时读，改了立即生效）
configureHoverPreview(() => ({
  enabled: getSetting('ui.hoverPreview'),
  delayMs: getSetting('ui.hoverPreviewDelay'),
}))

// 「想看」清单：整部看完的条目自动移出
installWatchlist()

// 媒体库条目的观看进度记进片库（播放器上报、继续播放从片库补）
installLibraryProgress()

// AI 助手的私密技能：设置打开时才下载并登记（独立 chunk），关闭时卸载并清空对话上下文
installPrivateSkills({
  enabled: () => aiAvailable() && getSetting('app.adultMode'),
  load: () => import('@/features/av/assistant'),
})

const app = createApp(App)
app.use(router)
setupDirectives(app)
app.mount('#app')

registerPwa()
