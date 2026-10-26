/**
 * 追更 feature 的公共出口：追剧日历页里的追更面板，以及日历卡片上的追更小标记（桌面端，或连着片库服务的网页端可用）。
 */
export { autograbAvailable } from './api'
export { type AutograbMark, markKey } from './autograb-rules'
export { default as AutograbMarkChip } from './components/AutograbMarkChip.vue'
export { default as AutograbPanel } from './components/AutograbPanel.vue'
export { useAutograbMarks } from './use-autograb-marks'
