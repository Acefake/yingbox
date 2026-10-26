/**
 * NFO 描述信息解析（类型、国家、评分、简介、年份）与国家名换算。
 */
import { describe, expect, it } from 'vitest'
import {
  countryCode,
  countryCodes,
  hasNfoDetails,
  parseNfoDetails,
} from '../../src/shared/library/identify'

describe('parseNfoDetails', () => {
  it('Kodi 新式 NFO：多个 genre、country、ratings 默认项、plot', () => {
    const xml = `<movie>
  <plot>Neo 发现世界是假的。</plot>
  <outline>短简介</outline>
  <genre>Action</genre>
  <genre>Science Fiction</genre>
  <country>United States of America</country>
  <country>Australia</country>
  <ratings>
    <rating name="imdb" max="10"><value>8.7</value></rating>
    <rating name="themoviedb" max="10" default="true"><value>8.2</value></rating>
  </ratings>
  <year>1999</year>
</movie>`
    expect(parseNfoDetails(xml)).toEqual({
      genres: ['Action', 'Science Fiction'],
      countries: ['US', 'AU'],
      rating: 8.2,
      ratingSource: 'tmdb',
      plot: 'Neo 发现世界是假的。',
      year: 1999,
    })
  })

  it('旧式 rating、一个标签里多个值、CDATA 与实体、premiered 取年份', () => {
    const xml = `<tvshow>
  <outline><![CDATA[警匪 &amp; 江湖]]></outline>
  <genre>动作 / 犯罪、剧情</genre>
  <genre>动作</genre>
  <country>中国香港, 中国大陆</country>
  <rating>7.9</rating>
  <premiered>2002-12-12</premiered>
</tvshow>`
    expect(parseNfoDetails(xml)).toEqual({
      genres: ['动作', '犯罪', '剧情'],
      countries: ['HK', 'CN'],
      rating: 7.9,
      ratingSource: 'nfo',
      plot: '警匪 & 江湖',
      year: 2002,
    })
  })

  it('百分制评分换算到 10 分；0 分、空标签、认不出的国家丢弃', () => {
    const d = parseNfoDetails(
      `<movie><ratings><rating max="100" default="true"><value>85</value></rating></ratings>
       <genre></genre><country>Atlantis</country><plot>  </plot></movie>`
    )
    expect(d).toEqual({
      genres: [],
      countries: [],
      rating: 8.5,
      ratingSource: 'nfo',
    })
    expect(parseNfoDetails('<movie><rating>0</rating></movie>').rating).toBe(
      undefined
    )
  })

  it('自带逗号的国家名整串认（不拆）；default 属性必须恰好为 true', () => {
    const d = parseNfoDetails(`<movie>
  <country>Korea, Republic of</country>
  <country>Iran, Islamic Republic of</country>
  <ratings>
    <rating name="imdb" max="10" default="trueish"><value>6.0</value></rating>
    <rating name="isdefault=true" max="10"><value>6.5</value></rating>
    <rating name="tmdb" max="10" default='TRUE'><value>7.4</value></rating>
  </ratings>
</movie>`)
    expect(d.countries).toEqual(['KR', 'IR'])
    expect(d.rating).toBe(7.4)
    // 都不是 default 时取第一条
    expect(
      parseNfoDetails(
        '<movie><ratings><rating default="false"><value>5.5</value></rating><rating><value>9</value></rating></ratings></movie>'
      ).rating
    ).toBe(5.5)
  })

  it('只有 ID 的 NFO 没有可补的信息', () => {
    const d = parseNfoDetails(
      '<movie><uniqueid type="tmdb">603</uniqueid></movie>'
    )
    expect(hasNfoDetails(d)).toBe(false)
    expect(hasNfoDetails({ genres: ['剧情'], countries: [] })).toBe(true)
  })
})

describe('countryCode', () => {
  it('中英文名、简称与两位代码都换成 ISO 代码，认不出返回 undefined', () => {
    expect(countryCode('美国')).toBe('US')
    expect(countryCode(' South Korea ')).toBe('KR')
    expect(countryCode('中国大陆')).toBe('CN')
    expect(countryCode('jp')).toBe('JP')
    expect(countryCode('Us')).toBe('US')
    expect(countryCode('to')).toBeUndefined()
    expect(countryCode('XX')).toBeUndefined()
    expect(countryCode('火星')).toBeUndefined()
    expect(countryCodes(['日本', 'Japan', '韩国'])).toEqual(['JP', 'KR'])
  })
})
