import { DirectiveBinding } from 'vue'

// 右键点击自定义指令
export const vRightClick = {
  mounted(el: HTMLElement, binding: DirectiveBinding) {
    // 阻止默认的右键菜单
    el.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault()

      // 如果绑定了函数，则执行
      if (typeof binding.value === 'function') {
        binding.value(e)
      }
    })
  },

  unmounted(el: HTMLElement) {
    // 清理事件监听器
    el.removeEventListener('contextmenu', () => {})
  }
}

// 导出默认指令
export default vRightClick
