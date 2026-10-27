/**
 * 剧集追更偏好：资源偏好（./grab-prefs.ts）在追更契约里的名字。
 *
 * 全局一份 + 每部剧覆盖其中几项；字段、解析与合并规则都在 grab-prefs.ts。
 */
export {
  DEFAULT_GRAB_PREFS as DEFAULT_PREFS,
  GRAB_RESOLUTIONS as AUTOGRAB_RESOLUTIONS,
  type GrabPrefs as AutograbPrefs,
  type GrabPrefsOverride as AutograbPrefsOverride,
  type GrabResolution as AutograbResolution,
  mergePrefs,
  prefsOf,
  prefsOverrideOf,
  wordsOf,
} from './grab-prefs'
