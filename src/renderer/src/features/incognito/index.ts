/**
 * 无痕模式 feature 的公共出口：会话级开关与统一判断 isIncognito()。
 * 写播放历史 / 续播进度 / 继续播放的地方都经它判断；开关与标识在侧栏（features/shell）。
 */
export {
  incognitoState,
  isIncognito,
  setIncognito,
  toggleIncognito,
} from './incognito-state'
