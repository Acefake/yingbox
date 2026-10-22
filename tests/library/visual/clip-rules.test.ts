/**
 * 中文 CLIP 的纯规则：分词（BERT WordPiece）、像素归一化、参与索引的图片、量化与相似度。
 * 分词期望值与 transformers.js 对同一词表的输出一致（真实词表里「高跟鞋」= 7770 6656 7490）。
 */
import { describe, expect, it } from 'vitest'
import {
  CLIP_DIM,
  normalizePixels,
} from '../../../src/main/library/visual/clip-encoder'
import {
  CLIP_TEXT_LENGTH,
  ClipTokenizer,
} from '../../../src/main/library/visual/clip-tokenizer'
import {
  MAX_STILLS,
  imageSignature,
  indexImages,
  packVector,
  quantize,
  similarity,
  unpackVector,
} from '../../../src/main/library/visual/visual-rules'

const VOCAB = [
  '[PAD]',
  '[UNK]',
  '[CLS]',
  '[SEP]',
  '高',
  '跟',
  '鞋',
  'hello',
  ',',
  'wor',
  '##ld',
  '!',
  'ol',
]
const tokenizer = new ClipTokenizer(new Map(VOCAB.map((t, i) => [t, i])))
const id = (t: string): number => VOCAB.indexOf(t)

describe('ClipTokenizer', () => {
  it('汉字逐字、英文小写、标点单独成词、WordPiece 续接、认不出记 UNK', () => {
    expect(tokenizer.encode('高跟鞋')).toEqual([
      2,
      id('高'),
      id('跟'),
      id('鞋'),
      3,
    ])
    expect(tokenizer.encode('Hello, World!')).toEqual([
      2,
      id('hello'),
      id(','),
      id('wor'),
      id('##ld'),
      id('!'),
      3,
    ])
    expect(tokenizer.encode('高跟OL  猫')).toEqual([
      2,
      id('高'),
      id('跟'),
      id('ol'),
      1,
      3,
    ])
  })

  it('超长截断到 CLIP_TEXT_LENGTH（含首尾）', () => {
    const ids = tokenizer.encode('高'.repeat(200))
    expect(ids).toHaveLength(CLIP_TEXT_LENGTH)
    expect(ids.at(-1)).toBe(3)
  })

  it('从 tokenizer.json 构造；缺词表报错', () => {
    const json = JSON.stringify({
      model: { vocab: Object.fromEntries(VOCAB.map((t, i) => [t, i])) },
    })
    expect(ClipTokenizer.fromJson(json).encode('鞋')).toEqual([2, id('鞋'), 3])
    expect(() => ClipTokenizer.fromJson('{}')).toThrow()
  })
})

describe('visual-rules', () => {
  it('参与索引：第一张封面 + 剧照（去重、跳过派生图与竖版海报）', () => {
    const images = [
      { role: 'poster', path: 'https://a/p.jpg' },
      { role: 'poster', path: 'https://a/c.jpg#yingbox=poster' },
      { role: 'backdrop', path: 'https://a/c.jpg' },
      { role: 'still', path: 'https://a/1.jpg' },
      { role: 'still', path: 'https://a/1.jpg' },
      ...Array.from({ length: 40 }, (_, i) => ({
        role: 'still',
        path: `https://a/s${i}.jpg`,
      })),
    ]
    const urls = indexImages({ level: 'title', images } as never)
    expect(urls[0]).toBe('https://a/c.jpg')
    expect(urls[1]).toBe('https://a/1.jpg')
    expect(urls).toHaveLength(1 + MAX_STILLS)
    expect(indexImages(null)).toEqual([])
    expect(imageSignature('m', ['a'])).not.toBe(imageSignature('m2', ['a']))
  })

  it('按向量缩放的 int8 量化：存取往返，相似度误差千分之几', () => {
    const v = new Float32Array(CLIP_DIM).map((_, i) => Math.sin(i + 1))
    const norm = Math.hypot(...v)
    v.forEach((x, i) => (v[i] = x / norm))
    const packed = packVector(quantize(v))
    expect(packed).toHaveLength(4 + CLIP_DIM)
    const matrix = new Int8Array(2 * CLIP_DIM)
    const scale = unpackVector(packed, matrix, 1)
    expect(similarity(matrix, 1, scale, v)).toBeCloseTo(1, 2)
    expect(
      similarity(
        matrix,
        1,
        scale,
        v.map(x => -x)
      )
    ).toBeCloseTo(-1, 2)
  })

  it('像素归一化：CHW 排列，按 CLIP 均值方差', () => {
    const rgba = new Uint8Array(224 * 224 * 4).fill(255)
    const out = normalizePixels(rgba)
    expect(out).toHaveLength(3 * 224 * 224)
    expect(out[0]).toBeCloseTo((1 - 0.48145466) / 0.26862954, 4)
    expect(out[224 * 224 * 2]).toBeCloseTo((1 - 0.40821073) / 0.27577711, 4)
    expect(() => normalizePixels(new Uint8Array(4))).toThrow()
  })
})
