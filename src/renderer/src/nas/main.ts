/** NAS 网页入口：只组合片库、完整网盘、设置与浏览器播放器。 */
import '../assets/main.css'
import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import { setupDirectives } from '@/directives'
import { initTheme } from '@/utils/theme'
import { registerPwa } from '@/pwa'
import { getSetting, registerSettingsSection } from '@/features/settings'
import {
  installLibraryProgress,
  librarySettingsSection,
} from '@/features/library'
import { netdiskSettingsSection } from '@/features/netdisk'
import { autograbSettingsSection } from '@/features/autograb-upgrade'
import { notifySettingsSection } from '@/features/notify'
import { installWatchlist } from '@/features/watchlist'
import { installPlayerHost } from '@/features/player'
import { configureHoverPreview } from '@/components/ui/hover-preview'
import App from './App.vue'
import { nasRoutes } from './routes'

initTheme()
for (const section of [
  librarySettingsSection,
  netdiskSettingsSection,
  autograbSettingsSection,
  notifySettingsSection,
])
  registerSettingsSection(section)
configureHoverPreview(() => ({
  enabled: getSetting('ui.hoverPreview'),
  delayMs: getSetting('ui.hoverPreviewDelay'),
}))
const router = createRouter({
  history: createWebHashHistory(),
  routes: nasRoutes,
})
router.beforeEach(to => {
  if (to.meta.adultOnly && !getSetting('app.adultMode')) return '/movie'
  document.title = `影盒 NAS - ${String(to.meta.title ?? '片库')}`
  return true
})
installLibraryProgress()
installWatchlist()
installPlayerHost(to => void router.push(to))
const app = createApp(App)
app.use(router)
setupDirectives(app)
app.mount('#app')
registerPwa()
