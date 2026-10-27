/**
 * 追更 feature 的公共出口（桌面端，或连着片库服务的网页端可用）：
 * - 追剧日历页里的追更面板，以及日历卡片上的追更小标记；
 * - 追更策略的共用件：每行「跟随 / 单独设」胶囊与单独设表单、偏好选项与摘要规则、全局切全自动的选目录守卫，
 *   给电影追踪面板和设置 · 自动追更（autograb-upgrade 里登记）用。
 */
export { autograbApi, autograbAvailable } from './api'
export { type AutograbMark, markKey } from './autograb-rules'
export { default as AutograbFolderPrompt } from './components/AutograbFolderPrompt.vue'
export { default as AutograbMarkChip } from './components/AutograbMarkChip.vue'
export { default as AutograbPanel } from './components/AutograbPanel.vue'
export { default as GrabOverrideForm } from './components/GrabOverrideForm.vue'
export { default as ItemPolicyMenu } from './components/ItemPolicyMenu.vue'
export { openAutograbSettings } from './open-settings'
export {
  CONFIRM_FIRST_OPTIONS,
  MIN_RESOLUTION_OPTIONS,
  MOVIE_MODE_OPTIONS,
  RESOLUTION_OPTIONS,
  STRATEGY_OPTIONS,
  SUBS_OPTIONS,
  TRI_OPTIONS,
  TV_MODE_OPTIONS,
  gbText,
  isCustom,
  optionLabel,
  overrideSummary,
  patchPrefs,
  prefsSummary,
  wordsText,
} from './prefs-rules'
export { useAutograbMarks } from './use-autograb-marks'
export { usePolicyFolder } from './use-policy-folder'
