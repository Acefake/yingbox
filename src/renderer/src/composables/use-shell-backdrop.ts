import { computed, getCurrentScope, onScopeDispose, reactive } from 'vue'

/**
 * 外壳浮动控件身后是不是深色画面：侧栏与窗口键胶囊分开算（胶囊在顶部一条，侧栏纵贯窗口）。
 *
 * 铺满窗口的页面（条目详情）在 Hero 滚到它们后面时声明，外壳据此挂 `.yb-on-media`，
 * 浅色主题下也换成深色玻璃，和 Hero 里的控件一致；页面滚走或卸载后撤回，回到主题玻璃。
 * 多个页面同时声明时任一为真即为真。颜色过渡见 tokens.css 的 `.yb-media-swap`。
 */
export interface ShellBackdrop {
  /** 侧栏身后是画面 */
  sidebar: boolean
  /** 窗口键胶囊身后是画面 */
  toolbar: boolean
}

const claims = reactive(new Map<symbol, ShellBackdrop>())

/** 侧栏身后当前是深色画面 */
export const sidebarOverMedia = computed(() =>
  [...claims.values()].some(claim => claim.sidebar)
)

/** 窗口键胶囊身后当前是深色画面 */
export const toolbarOverMedia = computed(() =>
  [...claims.values()].some(claim => claim.toolbar)
)

/**
 * 声明本页对外壳底色的要求；返回的函数传新状态更新。在组件 setup 里调用，作用域结束时自动撤回。
 */
export function useShellBackdrop(): (state: ShellBackdrop) => void {
  const key = Symbol('shell-backdrop')
  if (getCurrentScope()) onScopeDispose(() => claims.delete(key))
  return state => {
    const prev = claims.get(key)
    if (prev?.sidebar !== state.sidebar || prev?.toolbar !== state.toolbar) {
      claims.set(key, { ...state })
    }
  }
}
