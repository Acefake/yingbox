import { expect, it } from 'vitest'
import { VISUAL_PARSERS } from '../../../src/shared/library/ipc/validate-visual'
it('CLIP 范围校验：省略兼容全部，明确接受三种模式，拒绝未知值', () => {
  const parse = VISUAL_PARSERS['visual.search']
  expect(parse({ text: '画面' }).source).toBeUndefined()
  for (const source of ['all', 'image', 'video'])
    expect(parse({ text: '画面', source }).source).toBe(source)
  for (const source of [null, '', 'frame', 1, {}, []])
    expect(() => parse({ text: '画面', source })).toThrow(/source/)
})
