/** 主题：明暗切换，以及把 tokens.css 同步给 Ant Design */
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

/**
 * CSS 变量读不到时（例如测试环境、样式尚未注入）用的兜底值，与 tokens.css 保持一致。
 * 正常运行时一律以 tokens.css 为准。
 */
const FALLBACK: Record<AppTheme, Record<string, string>> = {
  dark: {
    '--accent': '#0a84ff',
    '--text-on-accent': '#ffffff',
    '--success': '#30d158',
    '--warning': '#ff9f0a',
    '--danger': '#ff453a',
    '--bg-base': '#121214',
    '--bg-elevated': '#1c1c1e',
    '--text-primary': '#f5f5f7',
    '--text-secondary': 'rgba(235, 235, 245, 0.68)',
    '--text-tertiary': 'rgba(235, 235, 245, 0.55)',
    '--border-default': 'rgba(255, 255, 255, 0.1)',
    '--separator': 'rgba(255, 255, 255, 0.08)',
    '--shadow-md': '0 8px 24px rgba(0, 0, 0, 0.32)',
  },
  light: {
    '--accent': '#007aff',
    '--text-on-accent': '#ffffff',
    '--success': '#34c759',
    '--warning': '#ff9500',
    '--danger': '#ff3b30',
    '--bg-base': '#ffffff',
    '--bg-elevated': '#ffffff',
    '--text-primary': '#1d1d1f',
    '--text-secondary': 'rgba(60, 60, 67, 0.82)',
    '--text-tertiary': 'rgba(60, 60, 67, 0.7)',
    '--border-default': 'rgba(0, 0, 0, 0.1)',
    '--separator': 'rgba(0, 0, 0, 0.08)',
    '--shadow-md': '0 8px 24px rgba(0, 0, 0, 0.1)',
  },
}

/** 与主题无关的令牌兜底值 */
const SHARED_FALLBACK: Record<string, string> = {
  '--radius-xs': '4px',
  '--radius-sm': '6px',
  '--radius-md': '8px',
  '--radius-lg': '12px',
  '--control-height': '32px',
  '--font-sans':
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif',
}

/**
 * 读取 tokens.css 里的变量。只有当页面当前主题就是要构建的主题时才读 DOM，
 * 否则（或读不到时）用兜底值，避免拿到另一套主题的颜色。
 */
function tokenReader(theme: AppTheme): (name: string) => string {
  const root = typeof document === 'undefined' ? null : document.documentElement
  const current: AppTheme | null = root
    ? root.getAttribute('data-theme') === 'light'
      ? 'light'
      : 'dark'
    : null
  const style = root && current === theme ? getComputedStyle(root) : null
  return name =>
    style?.getPropertyValue(name).trim() ||
    FALLBACK[theme][name] ||
    SHARED_FALLBACK[name] ||
    ''
}

/** '8px' → 8；解析失败返回兜底数字 */
function px(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * Ant Design 的主题：颜色、圆角、字体、控件高度全部取自 tokens.css 的 CSS 变量，
 * 明暗算法跟随我们的主题。message / notification / Modal.confirm 这些静态方法
 * 由 App.vue 通过 ConfigProvider.config 同步拿到同一份主题。
 */
export function buildAntdTheme(theme: AppTheme): ThemeConfig {
  const read = tokenReader(theme)
  const accent = read('--accent')
  return {
    algorithm:
      theme === 'dark'
        ? antdThemeAlgo.darkAlgorithm
        : antdThemeAlgo.defaultAlgorithm,
    token: {
      colorPrimary: accent,
      colorInfo: accent,
      colorLink: accent,
      colorTextLightSolid: read('--text-on-accent'),
      colorSuccess: read('--success'),
      colorWarning: read('--warning'),
      colorError: read('--danger'),
      colorBgBase: read('--bg-base'),
      colorBgContainer: read('--bg-elevated'),
      colorBgElevated: read('--bg-elevated'),
      colorText: read('--text-primary'),
      colorTextSecondary: read('--text-secondary'),
      colorTextTertiary: read('--text-tertiary'),
      colorBorder: read('--border-default'),
      colorBorderSecondary: read('--separator'),
      boxShadowSecondary: read('--shadow-md'),
      borderRadius: px(read('--radius-md'), 8),
      borderRadiusLG: px(read('--radius-lg'), 12),
      borderRadiusSM: px(read('--radius-sm'), 6),
      borderRadiusXS: px(read('--radius-xs'), 4),
      fontFamily: read('--font-sans'),
      controlHeight: px(read('--control-height'), 32),
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
