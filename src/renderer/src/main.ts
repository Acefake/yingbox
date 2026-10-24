import './assets/main.css'

import { createApp } from 'vue'
import App from '@/App.vue'
import router from '@/router/index'
import { setupDirectives } from '@/directives'
import { initTheme } from '@/utils/theme'
import { registerPwa } from '@/pwa'
import { downloadSettingsSection } from '@/features/download'
import { ladaSettingsSection } from '@/features/lada'
import { sourcesSettingsSection } from '@/features/online'
import { getSetting, registerSettingsSection } from '@/features/settings'
import { installWatchlist } from '@/features/watchlist'
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
  sourcesSettingsSection,
  ladaSettingsSection,
  downloadSettingsSection,
]) {
  registerSettingsSection(section)
}

// 卡片悬停预览读设置里的开关与等待时间（每次悬停时读，改了立即生效）
configureHoverPreview(() => ({
  enabled: getSetting('ui.hoverPreview'),
  delayMs: getSetting('ui.hoverPreviewDelay'),
}))

// 「想看」清单：整部看完的条目自动移出
installWatchlist()

const app = createApp(App)
app.use(router)
setupDirectives(app)
app.mount('#app')

registerPwa()
