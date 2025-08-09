import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import router from './router/index'
import { setupDirectives } from './directives'

/**
 * 创建 Vue 应用实例
 */
const app = createApp(App)

// 注册路由
app.use(router)

// 注册自定义指令
setupDirectives(app)

// 挂载应用
app.mount('#app')
