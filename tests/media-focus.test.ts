import { describe, expect, it } from 'vitest'
import { analyzeFocus } from '../src/main/thumbnails/focus/analyze'
import {
  FOCUS_VERSION,
  type MediaFocus,
  focusPosition,
  parseFocus,
} from '../src/shared/media-focus'
import {
  type Canvas,
  SKIN,
  canvas,
  checker,
  face,
  fold,
  person,
  rect,
} from './fixtures/focus-images'

/**
 * 海报取景的焦点：横版剧照 / 番号封套裁成竖版海报时，人脸（或画面主体）落在哪。
 * 焦点计算（analyzeFocus，编解码线程里跑）对合成图给出位置；
 * focusPosition 把焦点换成 object-position（不重新编码图片）。
 */

const run = (c: Canvas): MediaFocus => analyzeFocus(c.rgba, c.width, c.height)

describe('analyzeFocus：合成图', () => {
  it.each([
    ['左', 0.2],
    ['中', 0.5],
    ['右', 0.8],
  ])('横版剧照里%s边的人：焦点跟着脸', (_, x) => {
    const focus = run(person(canvas(1280, 720), x, 0.3, 0.09))
    expect(focus.by).toBe('skin')
    expect(Math.abs(focus.x - x)).toBeLessThan(0.05)
    expect(focus.y).toBeLessThan(0.45)
    expect(focus.v).toBe(FOCUS_VERSION)
  })

  it('竖图里的人：纵向焦点在脸上，不在躯干中部', () => {
    const focus = run(person(canvas(400, 600), 0.4, 0.22, 0.07))
    expect(focus.by).toBe('skin')
    expect(Math.abs(focus.x - 0.4)).toBeLessThan(0.06)
    expect(focus.y).toBeLessThan(0.32)
  })

  it('两个人：取大的那张脸', () => {
    const c = canvas(1280, 720)
    face(c, 0.15, 0.3, 0.05)
    person(c, 0.72, 0.35, 0.12)
    expect(Math.abs(run(c).x - 0.72)).toBeLessThan(0.06)
  })

  it('没有肤色、有纹理：退到边缘能量的重心', () => {
    const focus = run(checker(canvas(1280, 720), 0.7, 0.2, 0.9, 0.6))
    expect(focus.by).toBe('edges')
    expect(focus.x).toBeGreaterThan(0.7)
    expect(focus.x).toBeLessThan(0.9)
  })

  it('纯色图：退回正中', () => {
    expect(run(canvas(800, 450))).toEqual({
      v: FOCUS_VERSION,
      x: 0.5,
      y: 0.5,
      by: 'center',
    })
  })

  it('散落的小肤色点不算人', () => {
    const c = canvas(1280, 720)
    for (let i = 0; i < 12; i++)
      rect(c, 0.05 + i * 0.07, 0.8, 0.055 + i * 0.07, 0.81, SKIN)
    expect(run(c).by).not.toBe('skin')
  })
})

describe('analyzeFocus：番号封套（背面 | 书脊 | 正面）', () => {
  /** DMM 的 pl.jpg：800×538，书脊约在 52%，正面在右。 */
  const sleeve = (): Canvas =>
    fold(rect(canvas(800, 538), 0, 0, 0.52, 1, [200, 200, 205]), 0.52)

  it('找到书脊：正面框住，背面的小脸不抢焦点', () => {
    const c = sleeve()
    face(c, 0.2, 0.3, 0.06)
    person(c, 0.78, 0.3, 0.1)
    const focus = run(c)
    expect(focus.box).toBeDefined()
    expect(focus.box![0]).toBeGreaterThan(0.51)
    expect(focus.box![0]).toBeLessThan(0.55)
    expect(focus.box!.slice(1)).toEqual([0, 1, 1])
    expect(focus.by).toBe('skin')
    expect(Math.abs(focus.x - 0.78)).toBeLessThan(0.05)
  })

  it('正面没有人：焦点在正面框里', () => {
    const c = sleeve()
    face(c, 0.2, 0.3, 0.08)
    const focus = run(c)
    expect(focus.box?.[0]).toBeGreaterThan(0.51)
    expect(focus.x).toBeGreaterThan(focus.box![0])
  })

  it('16:9 剧照里的竖线不是书脊', () => {
    const c = fold(canvas(1280, 720), 0.6)
    person(c, 0.3, 0.3, 0.1)
    const focus = run(c)
    expect(focus.box).toBeUndefined()
    expect(Math.abs(focus.x - 0.3)).toBeLessThan(0.05)
  })

  it('封套比例但没有折痕：不框（不猜正面在右）', () => {
    const c = canvas(800, 538)
    person(c, 0.25, 0.3, 0.1)
    const focus = run(c)
    expect(focus.box).toBeUndefined()
    expect(Math.abs(focus.x - 0.25)).toBeLessThan(0.05)
  })
})

describe('focusPosition：焦点 → object-position', () => {
  const at = (
    x: number,
    y = 0.5,
    extra: Partial<MediaFocus> = {}
  ): MediaFocus =>
    ({ v: FOCUS_VERSION, x, y, by: 'skin', ...extra }) as MediaFocus

  // 横图 1.5 放进 2:3 竖框：可见宽 = (2/3) / 1.5 ≈ 0.444
  it.each([
    [0.2, '0% 50%'],
    [0.5, '50% 50%'],
    [0.6, '68% 50%'],
    [0.8, '100% 50%'],
  ])(
    '横图进竖框：焦点 x=%s → %s（脸落在可见窗口正中，贴边时顶到边）',
    (x, expected) => {
      expect(focusPosition(at(x), 1.5, 2 / 3)).toBe(expected)
    }
  )

  it('有正面框：窗口尽量不出框（宁可脸不居中，也不露书脊和背面）', () => {
    expect(
      focusPosition(at(0.6, 0.5, { box: [0.53, 0, 1, 1] }), 1.5, 2 / 3)
    ).toBe('95% 50%')
  })

  it('框比窗口窄：窗口把框整个装下', () => {
    // 可见宽 0.444，框 [0.7, 1] 宽 0.3：窗口左缘在 [0.556, 0.7] 里
    expect(
      focusPosition(at(0.95, 0.5, { box: [0.7, 0, 1, 1] }), 1.5, 2 / 3)
    ).toBe('100% 50%')
  })

  it('竖图进横框：只算纵向', () => {
    // 可见高 = 0.667 / 1.778 = 0.375；y=0.25 → (0.25 − 0.1875) / 0.625 = 10%
    expect(focusPosition(at(0.1, 0.25), 2 / 3, 16 / 9)).toBe('50% 10%')
  })

  it('比例一致：不裁，居中', () => {
    expect(focusPosition(at(0.1, 0.9), 2 / 3, 2 / 3)).toBe('50% 50%')
  })
})

describe('parseFocus：持久化与 IPC 边界的校验', () => {
  it('合法记录原样通过', () => {
    const focus = { v: 1, x: 0.3, y: 0.4, by: 'face', box: [0.5, 0, 1, 1] }
    expect(parseFocus(focus)).toEqual(focus)
    expect(
      parseFocus({ v: 1, x: 0.5, y: 0.5, by: 'skin', checked: true })
    ).toEqual({
      v: 1,
      x: 0.5,
      y: 0.5,
      by: 'skin',
      checked: true,
    })
  })

  it.each([
    ['越界', { v: 1, x: 1.2, y: 0.5, by: 'skin' }],
    ['NaN', { v: 1, x: Number.NaN, y: 0.5, by: 'skin' }],
    ['未知方法', { v: 1, x: 0.5, y: 0.5, by: 'magic' }],
    ['框反了', { v: 1, x: 0.5, y: 0.5, by: 'skin', box: [0.8, 0, 0.2, 1] }],
    ['不是对象', 'x'],
  ])('%s → null', (_, value) => {
    expect(parseFocus(value)).toBeNull()
  })
})

describe('IPC 契约 media：渲染层边界的参数校验', () => {
  it('focus(urls)：字符串数组，一次最多 FOCUS_BATCH 张', async () => {
    const { media } = await import('../src/shared/contract/media')
    const { FOCUS_BATCH } = await import('../src/shared/media-focus')
    expect(media.calls.focus.parse([['a', 'b']])).toEqual([['a', 'b']])
    expect(() => media.calls.focus.parse([[1]])).toThrow()
    expect(() => media.calls.focus.parse(['a'])).toThrow()
    expect(() =>
      media.calls.focus.parse([
        Array.from({ length: FOCUS_BATCH + 1 }, () => 'a'),
      ])
    ).toThrow()
  })

  it('saveFocus(url, focus)：焦点不合法就拒绝', async () => {
    const { media } = await import('../src/shared/contract/media')
    const focus = { v: FOCUS_VERSION, x: 0.5, y: 0.5, by: 'face' }
    expect(media.calls.saveFocus.parse(['u', focus])).toEqual(['u', focus])
    expect(() =>
      media.calls.saveFocus.parse(['u', { ...focus, by: 'x' }])
    ).toThrow()
  })
})
