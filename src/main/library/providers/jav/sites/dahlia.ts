/**
 * DAHLIA 官网（dahlia-av.jp）：WordPress works 主题，单一厂牌，制作商与发行商同名。
 * 解析流程见 wp-works.ts。
 * 行为参考 Amane 的 dahlia 爬虫，代码独立实现。
 */
import type { JavSiteId } from '../types'
import { createWpWorksSite } from './wp-works'

/** DAHLIA 站点。 */
export const dahlia = createWpWorksSite({
  id: 'dahlia' as JavSiteId,
  base: 'https://dahlia-av.jp',
  studio: 'DAHLIA',
  label: 'DAHLIA',
  prefixes: 'dldss dhla favr',
})
