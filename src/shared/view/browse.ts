/**
 * 浏览页 view.browse（ADR-0030）：热门、某个类型或某个精选片单的一页豆瓣卡。
 */
import { ViewCardSchema } from './home'
import { type Infer, s } from './schema'

export const ViewBrowsePageSchema = s.object('ViewBrowsePage', {
  /** 页面大标题：「全部」、类型名、片单名 */
  title: s.string,
  /** 这一页的卡；客户端按 id 去重后追加（豆瓣分页偶有重复） */
  items: s.array(ViewCardSchema),
  /** 下一页的 start；到底为 null */
  next: s.nullable(s.number),
})

export type ViewBrowsePage = Infer<typeof ViewBrowsePageSchema>
