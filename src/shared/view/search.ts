/**
 * 搜索 view.search：在 CMS 与插件站点里按关键词搜，片名相同的结果合成一张卡。
 * 与桌面搜索页同一类数据（站点自带海报，没有豆瓣编号），点开用片名走选源（view.sourcesStart）。
 */
import { type Infer, s } from './schema'

export const ViewSearchCardSchema = s.object('ViewSearchCard', {
  /** 片名（站点给的原名，同名多条取第一条） */
  title: s.string,
  /** 年份；没有为空串 */
  year: s.string,
  /** 类型或更新备注，如「剧情片」「更新至 12 集」；没有为空串 */
  tag: s.string,
  /** 海报缩略图路径；站点没给或不能做缩略图为空串 */
  poster: s.string,
  /** 有几个站点搜到了它（越多越可能有可播的源） */
  siteCount: s.number,
})

export type ViewSearchCard = Infer<typeof ViewSearchCardSchema>
