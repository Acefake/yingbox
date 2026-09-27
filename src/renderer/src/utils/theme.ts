/** Theme helpers for the Apple-style design tokens in tokens.css */
import { type ComputedRef, type Ref, computed, readonly, ref } from 'vue'
import { theme as antdThemeAlgo } from 'ant-design-vue'
import type { ThemeConfig } from 'ant-design-vue/es/config-provider/context'

export type AppTheme = 'light' | 'dark'

const STORAGE_KEY = 'yingbox-theme'

/** Shared reactive theme — read via useTheme(); mutate via setTheme/toggleTheme. */
const themeRef = ref<AppTheme>('light')

export function getStoredTheme(): AppTheme | null {
  const value = localStorage.getItem(STORAGE_KEY)
  return value === 'light' || value === 'dark' ? value : null
}

export function resolveInitialTheme(): AppTheme {
  return getStoredTheme() ?? 'light'
}

export function buildAntdTheme(theme: AppTheme): ThemeConfig {
  const isDark = theme === 'dark'
  return {
    algorithm: isDark ? antdThemeAlgo.darkAlgorithm : antdThemeAlgo.defaultAlgorithm,
    token: {
      colorPrimary: isDark ? '#0a84ff' : '#007aff',
      colorInfo: isDark ? '#0a84ff' : '#007aff',
      colorSuccess: isDark ? '#30d158' : '#34c759',
      colorWarning: '#ff9f0a',
      colorError: isDark ? '#ff453a' : '#ff3b30',
      colorBgBase: isDark ? '#1c1c1e' : '#f5f5f7',
      colorBgContainer: isDark ? '#2c2c2e' : '#ffffff',
      colorText: isDark ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.88)',
      colorTextSecondary: isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)',
      colorBorder: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
      borderRadius: 10,
      borderRadiusLG: 14,
      borderRadiusSM: 6,
      fontFamily:
        '"SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif',
      controlHeight: 32,
      wireframe: false,
    },
  }
}

export function applyTheme(theme: AppTheme): void {
  const root = document.documentElement
  if (theme === 'dark') root.setAttribute('data-theme', 'dark')
  else root.removeAttribute('data-theme')
  localStorage.setItem(STORAGE_KEY, theme)
  themeRef.value = theme
  const themeColor = document.querySelector('meta[name="theme-color"]')
  if (themeColor) themeColor.setAttribute('content', theme === 'dark' ? '#1c1c1e' : '#f5f5f7')
}

export function setTheme(theme: AppTheme): void {
  applyTheme(theme)
}

export function toggleTheme(): AppTheme {
  const next: AppTheme = themeRef.value === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  return next
}

/** Call once at app boot. Defaults to light; respects stored preference. */
export function initTheme(): AppTheme {
  const theme = resolveInitialTheme()
  applyTheme(theme)
  return theme
}

export interface UseThemeReturn {
  theme: Readonly<Ref<AppTheme>>
  isDark: ComputedRef<boolean>
  antdTheme: ComputedRef<ThemeConfig>
  setTheme: (theme: AppTheme) => void
  toggleTheme: () => AppTheme
}

/** Reactive theme + Ant Design ConfigProvider bridge. Instant switch, no reload. */
export function useTheme(): UseThemeReturn {
  return {
    theme: readonly(themeRef),
    isDark: computed(() => themeRef.value === 'dark'),
    antdTheme: computed(() => buildAntdTheme(themeRef.value)),
    setTheme,
    toggleTheme,
  }
}
