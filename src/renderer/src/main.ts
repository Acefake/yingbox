import './assets/main.css'

import { createApp } from 'vue'
import App from '@/App.vue'
import router from '@/router/index'
import { setupDirectives } from '@/directives'
import Antd from 'ant-design-vue'

const defaults: Record<string, string> = {
  metadataLanguage: 'zh-CN',
  imageDownloadSize_poster: 'original',
  imageDownloadSize_backdrop: 'original',
  imageDownloadSize_actor: 'original',
}
for (const [key, val] of Object.entries(defaults)) {
  if (localStorage.getItem(key) === null) {
    localStorage.setItem(key, val)
  }
}

const app = createApp(App)
app.use(Antd)
app.use(router)
setupDirectives(app)
app.mount('#app')
