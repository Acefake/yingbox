/**
 * 设置 feature 的公共出口：读写设置、登记设置分区、设置面板与分区里复用的行组件。
 */
export {
  getSetting,
  setSetting,
  settingsReady,
  useSetting,
} from './use-setting'
export { type SettingsSection, registerSettingsSection } from './registry'
export { default as SettingsPanel } from './SettingsPanel.vue'
export { default as SettingsGroup } from './ui/SettingsGroup.vue'
export { default as SettingsRow } from './ui/SettingsRow.vue'
export {
  type TokenDraft,
  createTokenDraft,
  setTmdbToken,
  tmdbTokenConfigured,
} from './tmdb-token'
