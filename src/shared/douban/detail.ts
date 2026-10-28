import type { DoubanSubjectDetail } from './frodo/map'
import type { DetailImage } from '../contract/online'

/** 在线详情与首页轮播共用的豆瓣元数据；图片均为完整地址。 */
export interface DoubanMetadata extends DoubanSubjectDetail {
  duration: string
  directors: string[]
  actors: { name: string; photo: string }[]
  images: DetailImage[]
  /** 只取明确的横向剧照，没有时为空。 */
  backdrop: string
}
