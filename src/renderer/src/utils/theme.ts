/** Theme helpers for the Claude desktop reference design tokens in tokens.css */
import { type ComputedRef, type Ref, computed, readonly, ref } from 'vue'
import { theme as antdThemeAlgo } from 'ant-design-vue'
import type { ThemeConfig } from 'ant-design-vue/es/config-provider/context'

export type AppTheme = 'light' | 'dark'

const STORAGE_KEY = 'yingbox-theme'

/** Shared reactive theme — read via useTheme(); mutate via setTheme/toggleTheme. */
const themeRef = ref<AppTheme>('dark')

export function getStoredTheme(): AppTheme | null {
  const value = localStorage.getItem(STORAGE_KEY)
  return value === 'light' || value === 'dark' ? value : null
}

export function resolveInitialTheme(): AppTheme {
  return getStoredTheme() ?? 'dark'
}

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif'

export function buildAntdTheme(theme: AppTheme): ThemeConfig {
  const isDark = theme === 'dark'
  return {
    algorithm: isDark
      ? antdThemeAlgo.darkAlgorithm
      : antdThemeAlgo.defaultAlgorithm,
    token: isDark
      ? {
          colorPrimary: '#0a84ff',
          colorInfo: '#0a84ff',
          colorTextLightSolid: '#ffffff',
          colorSuccess: '#30d158',
          colorWarning: '#ff9f0a',
          colorError: '#ff453a',
          colorBgBase: '#121214',
          colorBgContainer: '#1c1c1e',
          colorText: '#f5f5f7',
          colorTextSecondary: 'rgba(235, 235, 245, 0.68)',
          colorBorder: 'rgba(255, 255, 255, 0.1)',
          borderRadius: 8,
          borderRadiusLG: 12,
          borderRadiusSM: 6,
          fontFamily: FONT_STACK,
          controlHeight: 32,
          wireframe: false,
        }
      : {
          colorPrimary: '#007aff',
          colorInfo: '#007aff',
          colorTextLightSolid: '#ffffff',
          colorSuccess: '#34c759',
          colorWarning: '#ff9500',
          colorError: '#ff3b30',
          colorBgBase: '#ffffff',
          colorBgContainer: '#ffffff',
          colorText: '#1d1d1f',
          colorTextSecondary: 'rgba(60, 60, 67, 0.82)',
          colorBorder: 'rgba(0, 0, 0, 0.1)',
          borderRadius: 8,
          borderRadiusLG: 12,
          borderRadiusSM: 6,
          fontFamily: FONT_STACK,
          controlHeight: 32,
          wireframe: false,
        },
  }
}

export function applyTheme(theme: AppTheme): void {
  const root = document.documentElement
  if (theme === 'light') root.setAttribute('data-theme', 'light')
  else root.removeAttribute('data-theme')
  localStorage.setItem(STORAGE_KEY, theme)
  themeRef.value = theme
  const themeColor = document.querySelector('meta[name="theme-color"]')
  if (themeColor)
    themeColor.setAttribute('content', theme === 'dark' ? '#171717' : '#fafaf8')
}

export function setTheme(theme: AppTheme): void {
  applyTheme(theme)
}

export function toggleTheme(): AppTheme {
  const next: AppTheme = themeRef.value === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  return next
}

/** Call once at app boot. Defaults to dark; respects stored preference. */
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
