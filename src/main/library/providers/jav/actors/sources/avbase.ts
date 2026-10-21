/**
 * AVBase 演员页（www.avbase.net/talents/<名>）：Next.js 站点，直接读 __NEXT_DATA__ 里的 talent。
 *
 * 站点没有演员检索入口（/talents?q= 是 404），按名字直接构造地址，站点会把别名解析到同一人物页；
 * 不存在的名字是 404，算查无此人。talent.actors[] 是同一人物的多个名義（即别名），
 * 身材 / 生日 / 出身地取 meta.basic_info，缺的再用 primary.meta.fanza 补；
 * primary.note 为「男優」时是男优。profile（简介）出现率低且含 HTML，不取。
 * 行为参考 Amane 的 avbase 演员爬虫，代码独立实现。
 */
import { list, nextPageProps, str } from '../../html'
import { calendarDate, positiveInt, uniqueNames } from '../names'
import type { ActorContext, ActorProfile, ActorSource } from '../types'

export const AVBASE_BASE = 'https://www.avbase.net'

type Obj = Record<string, unknown>

const obj = (value: unknown): Obj | undefined =>
  value && typeof value === 'object' ? (value as Obj) : undefined

/** talent JSON → 演员资料；缺规范名返回 null。 */
export function avbaseTalent(talent: Obj, url: string): ActorProfile | null {
  const primary = obj(talent.primary)
  const name = str(primary, 'name')
  if (!primary || !name) return null
  const basic = obj(obj(talent.meta)?.basic_info)
  const fanza = obj(obj(primary.meta)?.fanza)
  /** basic_info 优先，FANZA 的资料兜底。 */
  const info = (key: string): string | undefined =>
    str(basic, key) ?? str(fanza, key)
  const image = str(primary, 'image_url')
  const id = talent.id
  return {
    source: 'avbase',
    name,
    aliases: uniqueNames(
      [
        ...list(talent, 'actors').map(a => str(a, 'name')),
        str(primary, 'ruby'),
      ],
      name
    ),
    ...(str(primary, 'note') === '男優' ? { gender: 'male' as const } : {}),
    birthday: calendarDate(info('birthday')),
    birthplace: info('prefectures'),
    height: positiveInt(info('height')),
    bust: positiveInt(info('bust')),
    waist: positiveInt(info('waist')),
    hip: positiveInt(info('hip')),
    cup: info('cup')?.toUpperCase(),
    images: image ? [image] : [],
    ids:
      typeof id === 'number' || typeof id === 'string'
        ? { avbase: String(id) }
        : {},
    url,
  }
}

export function avbaseTalentUrl(name: string): string {
  return `${AVBASE_BASE}/talents/${encodeURIComponent(name.trim())}`
}

export const avbaseActors: ActorSource = {
  id: 'avbase',
  label: 'AVBase',
  capability: 'profile',
  // 男优也有人物页；只声明女优会在按性别裁剪时漏掉男优
  genders: ['female', 'male'],
  async fetch(name: string, ctx: ActorContext): Promise<ActorProfile | null> {
    if (!name.trim()) return null
    const url = avbaseTalentUrl(name)
    const html = await ctx.page(url)
    if (html === null) return null
    const talent = obj(nextPageProps(html)?.talent)
    return talent ? avbaseTalent(talent, url) : null
  },
}
