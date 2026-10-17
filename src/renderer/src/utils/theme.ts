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
  '"Segoe UI Variable", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif'

export function buildAntdTheme(theme: AppTheme): ThemeConfig {
  const isDark = theme === 'dark'
  return {
    algorithm: isDark
      ? antdThemeAlgo.darkAlgorithm
      : antdThemeAlgo.defaultAlgorithm,
    token: isDark
      ? {
          colorPrimary: '#f1f1f1',
          colorInfo: '#f1f1f1',
          colorTextLightSolid: '#242424',
          colorSuccess: '#30d158',
          colorWarning: '#ff9f0a',
          colorError: '#ff453a',
          colorBgBase: '#171717',
          colorBgContainer: '#202020',
          colorText: '#f1f1f1',
          colorTextSecondary: '#a3a3a3',
          colorBorder: '#303030',
          borderRadius: 8,
          borderRadiusLG: 10,
          borderRadiusSM: 6,
          fontFamily: FONT_STACK,
          controlHeight: 38,
          wireframe: false,
        }
      : {
          colorPrimary: '#242424',
          colorInfo: '#242424',
          colorTextLightSolid: '#f1f1f1',
          colorSuccess: '#34c759',
          colorWarning: '#ff9f0a',
          colorError: '#ff3b30',
          colorBgBase: '#fafaf8',
          colorBgContainer: '#ffffff',
          colorText: '#242424',
          colorTextSecondary: '#6c6c6c',
          colorBorder: '#dededa',
          borderRadius: 8,
          borderRadiusLG: 10,
          borderRadiusSM: 6,
          fontFamily: FONT_STACK,
          controlHeight: 38,
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
