import './assets/main.css'

import { createApp } from 'vue'
import App from '@/App.vue'
import router from '@/router/index'
import { setupDirectives } from '@/directives'
import Antd from 'ant-design-vue'
import { initTheme } from '@/utils/theme'
import { registerPwa } from '@/pwa'
import { setAmanePhoneToken } from '@/api/amane'
import { libraryBridge } from '@/features/library/api/bridge'
import { migrateLegacyTmdbToken } from '@/features/library/settings/provider-token'
import { startLegacyLibraryMirror } from '@/features/settings/legacy-library-mirror'
import { registerSettingsSection } from '@/features/settings/registry'
import { getSetting, setSetting } from '@/features/settings/use-setting'
import { amaneSettingsSection } from '@/views/Amane/settings-section'

/**
 * 手机接入(桌面客户端 → Amane 设置 → "手机接入"):地址栏一次性携带
 * `?amane=<token>&key=<后端key>`,写入本地存储并清理参数。
 */
function bindPhoneBootstrap(): void {
  const params = new URLSearchParams(window.location.search)
  const amane = params.get('amane') || ''
  const key = params.get('key') || ''
  if (!amane && !key) return
  if (amane) setAmanePhoneToken(amane)
  if (key && !getSetting('backend.apiKey'))
    void setSetting('backend.apiKey', key)
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

startLegacyLibraryMirror()
initTheme()

// Amane 的设置分区由 Amane 自己定义，在应用入口组合进设置面板
registerSettingsSection(amaneSettingsSection)

const app = createApp(App)
app.use(Antd)
app.use(router)
setupDirectives(app)
app.mount('#app')

registerPwa()

// 媒体库令牌存在引擎里；旧版本存在 localStorage 的令牌在这里一次性迁过去
void migrateLegacyTmdbToken(libraryBridge())
