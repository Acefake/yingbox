/**
 * 追更 feature 的公共出口（桌面端，或连着片库服务的网页端可用）：
 * - 自动追更页的剧集栏（AutograbView）、剧的追更侧板、日历上追更状态点开的这一集侧板、
 *   剧集详情页的「追更」入口、侧栏待处理角标；
 * - 追更策略的共用件：电影追踪每行「跟随 / 单独设」胶囊与单独设表单、偏好选项与摘要规则、全局切全自动的选目录守卫，
 *   给电影追踪面板和设置 · 自动追更（autograb-upgrade 里登记）用。
 */
export { autograbApi, autograbAvailable } from './api'
export { type AutograbMark, markKey } from './autograb-rules'
export { default as AutograbFolderPrompt } from './components/AutograbFolderPrompt.vue'
export { default as AutograbView } from './components/AutograbView.vue'
export { default as EpisodeGrabSheet } from './components/EpisodeGrabSheet.vue'
export { default as SeriesTrackButton } from './components/SeriesTrackButton.vue'
export { default as GrabOverrideForm } from './components/GrabOverrideForm.vue'
export { default as ItemPolicyMenu } from './components/ItemPolicyMenu.vue'
export { default as GrabPoster } from './components/GrabPoster.vue'
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
export { useAutograbBadge } from './use-autograb-badge'
export { useAutograbMarks } from './use-autograb-marks'
export { usePolicyFolder } from './use-policy-folder'
