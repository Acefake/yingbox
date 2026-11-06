/** 独立更新程序入口，复用主窗口的品牌组件与设计令牌。 */
import './assets/styles/tokens.css'
import './components/ui/ui.css'
import { createApp } from 'vue'
import UpdateCompanion from './features/settings/UpdateCompanion.vue'

createApp(UpdateCompanion).mount('#app')
