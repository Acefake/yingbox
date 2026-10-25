/** 主题：明暗切换与降低透明度。颜色等令牌全在 tokens.css，按根节点的 data-theme / data-transparency 生效 */
import { type ComputedRef, computed, watchEffect } from 'vue'
import { getSetting, setSetting } from '@/features/settings/use-setting'

export type AppTheme = 'light' | 'dark'

/** 当前主题：直接取自设置（app.theme），任一窗口修改后所有窗口同步 */
const themeRef = computed<AppTheme>(() => getSetting('app.theme'))

/** 把主题应用到文档：data-theme 属性与浏览器 theme-color */
function applyTheme(theme: AppTheme): void {
  const root = document.documentElement
  if (theme === 'light') root.setAttribute('data-theme', 'light')
  else root.removeAttribute('data-theme')
  const themeColor = document.querySelector('meta[name="theme-color"]')
  if (themeColor)
    themeColor.setAttribute('content', theme === 'dark' ? '#000000' : '#ffffff')
}

/** 降低透明度（设置 ui.reduceTransparency）：根节点 data-transparency="reduced"，玻璃令牌换成实色 */
function applyTransparency(reduced: boolean): void {
  const root = document.documentElement
  if (reduced) root.setAttribute('data-transparency', 'reduced')
  else root.removeAttribute('data-transparency')
}

/** 切换主题（写入设置，界面经 initTheme 的监听自动更新） */
export function setTheme(theme: AppTheme): void {
  void setSetting('app.theme', theme)
}

/** 在深色 / 浅色之间切换，返回切换后的主题 */
export function toggleTheme(): AppTheme {
  const next: AppTheme = themeRef.value === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}

/** 启动时调用一次：立即应用当前主题与透明度，之后设置变化时自动重新应用 */
export function initTheme(): void {
  watchEffect(() => applyTheme(themeRef.value))
  watchEffect(() => applyTransparency(getSetting('ui.reduceTransparency')))
}

export interface UseThemeReturn {
  theme: ComputedRef<AppTheme>
  isDark: ComputedRef<boolean>
  setTheme: (theme: AppTheme) => void
  toggleTheme: () => AppTheme
}

/** 响应式主题：当前值、是否深色，以及切换方法。切换即时生效，不用刷新 */
export function useTheme(): UseThemeReturn {
  return {
    theme: themeRef,
    isDark: computed(() => themeRef.value === 'dark'),
    setTheme,
    toggleTheme,
  }
}
