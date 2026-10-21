/**
 * 演员库界面的纯规则：资料行、年龄、首字、表单 ↔ 编辑请求（只带改过的、改过自动锁）、来源设置行、名字键。
 */
import { describe, expect, it } from 'vitest'
import {
  actorFacts,
  ageOn,
  editRequest,
  formOf,
  initialOf,
  worksQuery,
} from '../../../src/renderer/src/features/library/actors/actor-rules'
import {
  actorSourceRows,
  moveActorSource,
  toggleActorSource,
} from '../../../src/renderer/src/features/library/settings/actor-source-rules'
import {
  peopleOf,
  personKey,
} from '../../../src/renderer/src/features/library/detail/detail-rules'
import {
  type ActorDetail,
  DEFAULT_ACTOR_SETTINGS,
} from '../../../src/shared/library/ipc'

const ACTOR: ActorDetail = {
  id: 7,
  name: '三上悠亜',
  photo: null,
  gender: 'female',
  workCount: 3,
  aliases: ['鬼頭桃菜'],
  birthday: '1993-08-16',
  birthplace: '愛知県',
  height: 159,
  bust: 83,
  waist: 57,
  hip: 85,
  cup: 'G',
  overview: null,
  images: ['https://a/1.jpg'],
  tagline: null,
  ids: {},
  urls: {},
  fieldSources: {},
  lockedFields: ['cup'],
  profileState: 'found',
  profileAt: 1,
  updatedAt: 1,
}

describe('演员库界面规则', () => {
  it('年龄按当天算，生日没到减一', () => {
    expect(ageOn('1993-08-16', new Date(2026, 7, 15))).toBe(32)
    expect(ageOn('1993-08-16', new Date(2026, 7, 16))).toBe(33)
    expect(ageOn('bad', new Date())).toBeNull()
    expect(ageOn('2999-01-01', new Date(2026, 0, 1))).toBeNull()
  })

  it('资料行：生日带年龄、三围缺项用短横', () => {
    const facts = actorFacts({ ...ACTOR, waist: null }, new Date(2026, 9, 21))
    expect(facts).toEqual([
      { label: '生日', value: '1993-08-16（33 岁）' },
      { label: '身高', value: '159 cm' },
      { label: '三围', value: 'B83 · W– · H85' },
      { label: '罩杯', value: 'G 罩杯' },
      { label: '出身地', value: '愛知県' },
      { label: '性别', value: '女' },
    ])
    expect(initialOf('  三上')).toBe('三')
    expect(initialOf('')).toBe('?')
  })

  it('编辑请求：没变化为 null；只带改过的字段并自动加锁；数字与罩杯归一', () => {
    const form = formOf(ACTOR)
    expect(editRequest(ACTOR, form, new Set(ACTOR.lockedFields))).toBeNull()
    const edited = {
      ...form,
      height: ' 160 ',
      cup: 'h',
      aliases: '鬼頭桃菜\n\n桃菜 ',
      birthday: '',
    }
    expect(editRequest(ACTOR, edited, new Set(['cup']))).toEqual({
      actorId: 7,
      values: {
        height: 160,
        cup: 'H',
        aliases: ['鬼頭桃菜', '桃菜'],
        birthday: null,
      },
      lockedFields: ['aliases', 'birthday', 'cup', 'height'],
    })
    // 只改锁定集合
    expect(editRequest(ACTOR, form, new Set())).toEqual({
      actorId: 7,
      values: {},
      lockedFields: [],
    })
    expect(worksQuery(7)).toEqual({
      types: ['movie'],
      actorId: 7,
      sort: 'year',
      order: 'desc',
    })
  })

  it('来源设置行与开关 / 排序', () => {
    const rows = actorSourceRows(DEFAULT_ACTOR_SETTINGS)
    expect(rows[0]).toMatchObject({
      id: 'gfriends',
      rank: 1,
      canUp: false,
      canDown: true,
    })
    const moved = moveActorSource(DEFAULT_ACTOR_SETTINGS, 'avbase', -1)
    expect(moved.sources.slice(0, 2).map(s => s.id)).toEqual([
      'avbase',
      'gfriends',
    ])
    expect(moveActorSource(DEFAULT_ACTOR_SETTINGS, 'gfriends', -1)).toBe(
      DEFAULT_ACTOR_SETTINGS
    )
    const off = toggleActorSource(DEFAULT_ACTOR_SETTINGS, 'javdb', false)
    expect(off.sources.find(s => s.id === 'javdb')!.enabled).toBe(false)
    expect(off.autoLookup).toBe(true)
  })

  it('详情演职员：演员库里的演员可点并用本地头像', () => {
    const meta = {
      level: 'title',
      cast: [
        { id: 'a', name: 'Ｍｉａ ', profilePath: 'https://remote/a.jpg' },
        { id: 'b', name: 'Other', profilePath: 'https://remote/b.jpg' },
      ],
      crew: [],
    } as never
    const people = peopleOf(
      meta,
      p => p ?? null,
      new Map([[personKey('mia'), { id: 3, photo: 'local' }]])
    )
    expect(people.map(p => [p.name, p.actorId, p.photo])).toEqual([
      ['Ｍｉａ ', 3, 'local'],
      ['Other', undefined, 'https://remote/b.jpg'],
    ])
  })
})
