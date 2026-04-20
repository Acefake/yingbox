import './assets/main.css'

import { createApp } from 'vue'
import App from '@/App.vue'
import router from '@/router/index'
import { setupDirectives } from '@/directives'

console.log('=== 应用开始启动 ===')
console.log('Vue 版本:', '3.x')
console.log('当前时间:', new Date().toISOString())

/**
 * 创建 Vue 应用实例
 */
const app = createApp(App)

console.log('Vue 应用实例创建成功')

// 注册路由
app.use(router)
console.log('路由注册成功')

// 注册自定义指令
setupDirectives(app)
console.log('自定义指令注册成功')

// 挂载应用
app.mount('#app')
console.log('应用挂载成功，渲染完成')
