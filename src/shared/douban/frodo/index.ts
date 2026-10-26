/**
 * 豆瓣 frodo 数据源（m.douban.com/rexxar 的备用）：签名、请求构造、响应映射、回退策略与开关。
 * 纯 Node（node:crypto），不依赖 Electron；出网由调用方注入。说明见 docs/library-refactor/douban-frodo.md。
 */
export {
  type FrodoRequest,
  FRODO_HEADERS,
  frodoRequest,
  rexxarToFrodo,
} from './client'
export {
  type FrodoFallback,
  type SourceCooldown,
  createSourceCooldown,
  describeFailure,
  withFrodoFallback,
} from './fallback'
export {
  type DoubanListBody,
  type DoubanListItem,
  type DoubanSearchBody,
  type DoubanSearchItem,
  type DoubanSubjectDetail,
  isEmptySearch,
  mapList,
  mapSearch,
  mapSubject,
} from './map'
export { frodoSignature, frodoTimestamp } from './sign'
export { DOUBAN_FRODO_DEFAULT, FRODO_SWITCH_ENV, frodoEnabled } from './switch'
