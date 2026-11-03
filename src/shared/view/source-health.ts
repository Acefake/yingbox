/**
 * 在线源健康检测 view.sourceHealth（ADR-0036）：全部源跑一遍，通的启用、不通的停用。
 */
import { type Infer, s } from './schema'

export const ViewSourceHealthSchema = s.object('ViewSourceHealth', {
  /** 正在检测 */
  checking: s.boolean,
  /** 本轮已检测完几个、一共几个（没在检测时是上一轮的数） */
  done: s.number,
  total: s.number,
  /** 检测不通、已被停用的站点名 */
  failed: s.array(s.string),
})

export type ViewSourceHealth = Infer<typeof ViewSourceHealthSchema>
