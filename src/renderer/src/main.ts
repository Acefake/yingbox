import './assets/main.css'

import { createApp } from 'vue'
import App from '@/App.vue'
import router from '@/router/index'
import { setupDirectives } from '@/directives'
import Antd from 'ant-design-vue'
import { initTheme } from '@/utils/theme'
import { registerPwa } from '@/pwa'
import { amaneSettingsSection, setAmanePhoneToken } from '@/features/amane'
import { ladaSettingsSection } from '@/features/lada'
import { sourcesSettingsSection } from '@/features/online'
import { loadTmdbToken, registerSettingsSection } from '@/features/settings'
import { libraryBridge } from '@/features/library/api/bridge'
import { syncTmdbTokenToEngine } from '@/features/library/settings/provider-token'

/**
 * 手机接入(桌面客户端 → Amane 设置 → "手机接入"):地址栏一次性携带
 * `?amane=<token>`,写入本地存储并清理参数。旧链接里的 `key`（Go 后端密钥）一并清掉。
 */
function bindPhoneBootstrap(): void {
  const params = new URLSearchParams(window.location.search)
  const amane = params.get('amane') || ''
  if (!amane && !params.has('key')) return
  if (amane) setAmanePhoneToken(amane)
  params.delete('amane')
  params.delete('key')
  const rest = params.toString()
  window.history.replaceState(
    {},
    '',
    `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`
  )
}

if (!window.api?.file) bindPhoneBootstrap()

initTheme()

// 各 feature 自己定义设置分区，在应用入口组合进设置面板（按 order 排位）
for (const section of [
  sourcesSettingsSection,
  ladaSettingsSection,
  amaneSettingsSection,
]) {
  registerSettingsSection(section)
}

const app = createApp(App)
app.use(Antd)
app.use(router)
setupDirectives(app)
app.mount('#app')

registerPwa()

// TMDB 令牌（设置密钥）读进内存供在线页面同步取用，并补给还没配置令牌的媒体库引擎
void loadTmdbToken().then(() => syncTmdbTokenToEngine(libraryBridge()))
