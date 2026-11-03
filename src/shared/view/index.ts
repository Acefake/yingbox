/** 视图结果类型的总表（ADR-0030）：生成 Kotlin 的根，嵌套的对象与枚举自动带上。新增视图在这里登记。 */
import {
  ViewDetailSchema,
  ViewPlayableSchema,
  ViewResumeSchema,
  ViewSourcesSchema,
} from './detail'
import { HomeViewSchema } from './home'

export const VIEW_ROOTS = [
  HomeViewSchema,
  ViewDetailSchema,
  ViewSourcesSchema,
  ViewPlayableSchema,
  ViewResumeSchema,
] as const
