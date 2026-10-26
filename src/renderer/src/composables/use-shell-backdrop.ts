import { computed, getCurrentScope, onScopeDispose, reactive } from 'vue'

/**
 * 窗口键胶囊身后是不是深色画面。
 *
 * 铺满窗口的页面（条目详情）在 Hero 滚到顶部一条后面时声明，外壳据此给胶囊挂 `.yb-on-media`，
 * 浅色主题下也换成深色玻璃，和 Hero 里的返回圆钮一致；页面滚走或卸载后撤回，回到主题玻璃。
 * 侧栏纵贯窗口、总有一截压在页面底色上，不跟着切换（浅色下用更实的 --glass-sidebar-bg）。
 * 多个页面同时声明时任一为真即为真。颜色过渡见 tokens.css 的 `.yb-media-swap`。
 */
const claims = reactive(new Map<symbol, boolean>())

/** 窗口键胶囊身后当前是深色画面 */
export const toolbarOverMedia = computed(() =>
  [...claims.values()].some(Boolean)
)

/**
 * 声明本页对胶囊底色的要求；返回的函数传 true / false 更新。在组件 setup 里调用，作用域结束时自动撤回。
 */
export function useShellBackdrop(): (overMedia: boolean) => void {
  const key = Symbol('shell-backdrop')
  if (getCurrentScope()) onScopeDispose(() => claims.delete(key))
  return overMedia => {
    if (claims.get(key) !== overMedia) claims.set(key, overMedia)
  }
}
