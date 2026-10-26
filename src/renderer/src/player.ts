/**
 * 独立播放器窗口的入口（player.html，主进程 src/main/player-window 加载）：只挂播放台，不带路由、外壳与 AI 助手。
 * 播放会话的进度经主进程交给主窗口写，见 features/player/window。
 */
import './assets/main.css'

import { createApp } from 'vue'

import { PlayerWindowApp } from '@/features/player'
import { setupDirectives } from '@/directives'
import { initTheme } from '@/utils/theme'

initTheme()

const app = createApp(PlayerWindowApp)
setupDirectives(app)
app.mount('#app')
