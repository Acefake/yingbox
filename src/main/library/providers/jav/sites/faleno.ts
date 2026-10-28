/**
 * FALENO 官网（faleno.jp/top）：WordPress works 主题，同站还发布 maryGOLD、JimmyScandal 的番号，
 * 发行商按番号前缀区分。解析流程见 wp-works.ts。
 */
import type { JavSiteId } from '../types'
import { createWpWorksSite } from './wp-works'

/** FALENO 站点。 */
export const faleno = createWpWorksSite({
  id: 'faleno' as JavSiteId,
  base: 'https://faleno.jp/top',
  studio: 'FALENO',
  label: 'FALENOstar',
  labelByPrefix: { mgold: 'maryGOLD', jimmy: 'JimmyScandal' },
  prefixes:
    'fsdss fns flns fadss flno fcdss fsvss ftht fthtd ftkd fsfst favr mgold jimmy',
})
