/**
 * 演员库界面的纯规则：资料行（年龄、身高三围）、首字占位、编辑表单 ↔ 编辑请求、作品墙查询、排序选项。
 * 不依赖 Vue，便于单测。
 */
import type {
  ActorDetail,
  ActorField,
  ActorProfileValues,
  ActorSortField,
  LibraryQuery,
  UpdateActorRequest,
} from '../../../../../shared/library/ipc'

/** 演员列表排序选项。 */
export const ACTOR_SORT_OPTIONS: ReadonlyArray<{
  value: ActorSortField
  label: string
}> = [
  { value: 'works', label: '作品数' },
  { value: 'name', label: '名字' },
  { value: 'recent', label: '最近入库' },
]

/** 字段在界面上的名字。 */
export const ACTOR_FIELD_LABELS: Record<ActorField, string> = {
  aliases: '别名',
  gender: '性别',
  birthday: '生日',
  birthplace: '出身地',
  height: '身高',
  bust: '胸围',
  waist: '腰围',
  hip: '臀围',
  cup: '罩杯',
  overview: '简介',
  images: '头像地址',
}

/** 没有头像时的占位字：名字第一个字（按码位，不拆开代理对）。 */
export function initialOf(name: string): string {
  return [...name.trim()][0] ?? '?'
}

/** 生日在 now 那天的周岁；生日不合法或在未来返回 null。 */
export function ageOn(birthday: string | null, now: Date): number | null {
  const m = birthday ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday) : null
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  let age = now.getFullYear() - y
  if (
    now.getMonth() + 1 < mo ||
    (now.getMonth() + 1 === mo && now.getDate() < d)
  )
    age--
  return age >= 0 && age < 150 ? age : null
}

/** 详情里的资料行（没有的字段不出现）。 */
export function actorFacts(
  actor: Pick<
    ActorDetail,
    | 'birthday'
    | 'birthplace'
    | 'height'
    | 'bust'
    | 'waist'
    | 'hip'
    | 'cup'
    | 'gender'
  >,
  now: Date
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = []
  if (actor.birthday) {
    const age = ageOn(actor.birthday, now)
    rows.push({
      label: '生日',
      value: age === null ? actor.birthday : `${actor.birthday}（${age} 岁）`,
    })
  }
  if (actor.height) rows.push({ label: '身高', value: `${actor.height} cm` })
  const { bust, waist, hip } = actor
  if (bust || waist || hip) {
    const part = (k: string, v: number | null): string => `${k}${v ?? '–'}`
    rows.push({
      label: '三围',
      value: [part('B', bust), part('W', waist), part('H', hip)].join(' · '),
    })
  }
  if (actor.cup) rows.push({ label: '罩杯', value: `${actor.cup} 罩杯` })
  if (actor.birthplace) rows.push({ label: '出身地', value: actor.birthplace })
  if (actor.gender) {
    rows.push({ label: '性别', value: actor.gender === 'female' ? '女' : '男' })
  }
  return rows
}

/** 编辑表单：全部是字符串，输入框直接绑定。 */
export type ActorForm = Record<Exclude<ActorField, 'gender'>, string> & {
  gender: '' | 'female' | 'male'
}

const MEASURES = ['height', 'bust', 'waist', 'hip'] as const

/** 详情 → 表单。别名、头像一行一个。 */
export function formOf(actor: ActorProfileValues): ActorForm {
  const n = (v: number | null): string => (v === null ? '' : String(v))
  return {
    aliases: actor.aliases.join('\n'),
    gender: actor.gender ?? '',
    birthday: actor.birthday ?? '',
    birthplace: actor.birthplace ?? '',
    height: n(actor.height),
    bust: n(actor.bust),
    waist: n(actor.waist),
    hip: n(actor.hip),
    cup: actor.cup ?? '',
    overview: actor.overview ?? '',
    images: actor.images.join('\n'),
  }
}

const lines = (text: string): string[] =>
  text
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)

/** 表单的一个字段 → 契约值。数字认不出时为 NaN（交给引擎拒绝并提示）。 */
function valueOf(
  form: ActorForm,
  field: ActorField
): ActorProfileValues[ActorField] {
  if (field === 'aliases' || field === 'images') return lines(form[field])
  if (field === 'gender') return form.gender || null
  if ((MEASURES as readonly string[]).includes(field)) {
    const raw = form[field as (typeof MEASURES)[number]].trim()
    return raw ? Number(raw) : null
  }
  const raw = (form[field as Exclude<ActorField, 'gender'>] as string).trim()
  return field === 'cup' ? raw.toUpperCase() || null : raw || null
}

/**
 * 表单 → 编辑请求：只带改过的字段；改过的字段自动加锁（之后的自动刷新不覆盖），
 * 用户在表单里手动解锁 / 加锁的以 locks 为准。没有任何变化返回 null。
 */
export function editRequest(
  actor: ActorDetail,
  form: ActorForm,
  locks: ReadonlySet<ActorField>
): UpdateActorRequest | null {
  const before = formOf(actor)
  const values: Partial<ActorProfileValues> = {}
  const locked = new Set(locks)
  for (const field of Object.keys(ACTOR_FIELD_LABELS) as ActorField[]) {
    if (form[field].trim() === before[field].trim()) continue
    ;(values as Record<string, unknown>)[field] = valueOf(form, field)
    locked.add(field)
  }
  const sameLocks =
    locked.size === actor.lockedFields.length &&
    actor.lockedFields.every(f => locked.has(f))
  if (!Object.keys(values).length && sameLocks) return null
  return {
    actorId: actor.id,
    values,
    lockedFields: [...locked].sort(),
  }
}

/** 演员作品墙的查询：只要电影，按上映年份新到旧。 */
export function worksQuery(actorId: number): LibraryQuery {
  return { types: ['movie'], actorId, sort: 'year', order: 'desc' }
}
