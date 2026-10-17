import './assets/main.css'

import { createApp } from 'vue'
import App from '@/App.vue'
import router from '@/router/index'
import { setupDirectives } from '@/directives'
import Antd from 'ant-design-vue'
import { initTheme } from '@/utils/theme'
import { registerPwa } from '@/pwa'
import { setAmanePhoneToken } from '@/api/amane'
import {
  getScrapeProviderConfig,
  saveScrapeProviderConfig,
} from '@/stores/scrape-provider-store'

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
  if (key) {
    const config = getScrapeProviderConfig()
    if (!config.goBackendApiKey)
      saveScrapeProviderConfig({ goBackendApiKey: key })
  }
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

const defaults: Record<string, string> = {
  metadataLanguage: 'zh-CN',
  imageDownloadSize_poster: 'original',
  imageDownloadSize_backdrop: 'original',
  imageDownloadSize_actor: 'original',
  scrapeConcurrency: '3',
}
for (const [key, val] of Object.entries(defaults)) {
  if (localStorage.getItem(key) === null) {
    localStorage.setItem(key, val)
  }
}

initTheme()

const app = createApp(App)
app.use(Antd)
app.use(router)
setupDirectives(app)
app.mount('#app')

registerPwa()
