/**
 * 整理模板：渲染、缺值清理、非法字符、保留名、长度截断、模板校验；原子写与内容未变跳过。
 */
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_MOVIE_TEMPLATE,
  DEFAULT_TV_TEMPLATE,
  renderTemplate,
  safeSegment,
  validateTemplate,
} from '../../../src/shared/library/writer'
import {
  movePath,
  writeIfChanged,
} from '../../../src/main/library/writer/fs/file-ops'
import {
  DEFAULT_WRITER_SETTINGS,
  parseWriterSettings,
} from '../../../src/shared/library/ipc'

const segments = (
  template: string,
  values: Parameters<typeof renderTemplate>[1]
): string[] => {
  const r = renderTemplate(template, values)
  if (!r.ok) throw new Error(r.error)
  return r.segments
}

describe('模板渲染', () => {
  it('默认电影 / 剧集模板', () => {
    expect(
      segments(DEFAULT_MOVIE_TEMPLATE, {
        title: '流浪地球',
        year: 2019,
        ext: 'mkv',
      })
    ).toEqual(['流浪地球 (2019)', '流浪地球 (2019).mkv'])
    expect(
      segments(DEFAULT_TV_TEMPLATE, {
        series: '请回答1988',
        year: 2015,
        season: 1,
        episode: 5,
        episodeTitle: '再见，初恋',
        ext: 'mp4',
      })
    ).toEqual([
      '请回答1988 (2015)',
      'Season 01',
      '请回答1988 - S01E05 - 再见，初恋.mp4',
    ])
  })

  it('缺值：空括号与悬空分隔符被清掉；多集渲染成 01-E02', () => {
    expect(
      segments(DEFAULT_MOVIE_TEMPLATE, { title: 'Heat', ext: 'mkv' })
    ).toEqual(['Heat', 'Heat.mkv'])
    expect(
      segments(DEFAULT_TV_TEMPLATE, {
        series: 'Show',
        season: 0,
        episode: [1, 2],
        ext: 'mkv',
      })
    ).toEqual(['Show', 'Season 00', 'Show - S00E01-E02.mkv'])
  })

  it('非法字符、路径分隔符、冒号、结尾的点与 Windows 保留名', () => {
    expect(
      segments(DEFAULT_MOVIE_TEMPLATE, {
        title: 'Mission: Impossible / Fallout? <3> "x" a|b * ',
        year: 2018,
        ext: 'mkv',
      })
    ).toEqual([
      "Mission - Impossible - Fallout 3 'x' a-b (2018)",
      "Mission - Impossible - Fallout 3 'x' a-b (2018).mkv",
    ])
    expect(segments('{title}.{ext}', { title: 'CON', ext: 'mkv' })).toEqual([
      'CON_.mkv',
    ])
    expect(
      segments('{title}/{title}.{ext}', { title: 'Dr.', ext: 'mkv' })
    ).toEqual(['Dr', 'Dr.mkv'])
    expect(safeSegment('nul')).toBe('nul_')
    expect(safeSegment('a\u0001b')).toBe('ab')
  })

  it('超长文件名按 UTF-8 字节截断，保留扩展名，不切断汉字', () => {
    const [, file] = segments(DEFAULT_MOVIE_TEMPLATE, {
      title: '长'.repeat(200),
      year: 2000,
      ext: 'mkv',
    })
    expect(Buffer.byteLength(file)).toBeLessThanOrEqual(255)
    expect(file.endsWith('.mkv')).toBe(true)
    expect(file).not.toContain('\ufffd')
  })

  it('片名为空时报错而不是生成空文件名', () => {
    expect(
      renderTemplate(DEFAULT_MOVIE_TEMPLATE, { title: '???', ext: 'mkv' })
    ).toMatchObject({ ok: false })
  })

  it('模板校验', () => {
    expect(validateTemplate(DEFAULT_MOVIE_TEMPLATE, 'movie')).toBeNull()
    expect(validateTemplate(DEFAULT_TV_TEMPLATE, 'tv')).toBeNull()
    expect(validateTemplate('{title}/{foo}.{ext}', 'movie')).toBe(
      '未知变量 {foo}'
    )
    expect(validateTemplate('{title}/{title}', 'movie')).toMatch(/\.\{ext\}/)
    expect(validateTemplate('/abs/{title}.{ext}', 'movie')).toMatch(/相对路径/)
    expect(validateTemplate('C:/x/{title}.{ext}', 'movie')).toMatch(/相对路径/)
    expect(validateTemplate('../{title}.{ext}', 'movie')).toMatch(/\.\./)
    expect(validateTemplate('{title.{ext}', 'movie')).toMatch(/大括号/)
    expect(validateTemplate('{series}.{ext}', 'tv')).toMatch(/\{episode\}/)
    expect(validateTemplate('{year}.{ext}', 'movie')).toMatch(/\{title\}/)
  })

  it('设置校验：字段齐全才通过，模板错误带字段名', () => {
    expect(parseWriterSettings(DEFAULT_WRITER_SETTINGS)).toEqual(
      DEFAULT_WRITER_SETTINGS
    )
    expect(() =>
      parseWriterSettings({
        ...DEFAULT_WRITER_SETTINGS,
        nfo: { enabled: true },
      })
    ).toThrow(/nfo.mode/)
    expect(() =>
      parseWriterSettings({
        ...DEFAULT_WRITER_SETTINGS,
        organize: {
          ...DEFAULT_WRITER_SETTINGS.organize,
          movieTemplate: '{x}.{ext}',
        },
      })
    ).toThrow(/organize.movieTemplate/)
  })
})

describe('文件操作', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'yingbox-writer-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('原子写：不留临时文件；内容相同跳过且不改 mtime', async () => {
    const file = join(dir, 'sub', 'movie.nfo')
    const first = await writeIfChanged(file, '<movie/>')
    expect(first.changed).toBe(true)
    const mtime = statSync(file).mtimeMs
    const second = await writeIfChanged(file, '<movie/>')
    expect(second).toMatchObject({ changed: false, hash: first.hash })
    expect(statSync(file).mtimeMs).toBe(mtime)
    expect(readdirSync(join(dir, 'sub'))).toEqual(['movie.nfo'])
    const third = await writeIfChanged(file, '<movie>2</movie>')
    expect(third.changed).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('<movie>2</movie>')
  })

  it('移动：目标已存在拒绝；跨盘（EXDEV）走复制 + 校验 + 删除，保留 mtime', async () => {
    const a = join(dir, 'a.mkv')
    const b = join(dir, 'x', 'b.mkv')
    writeFileSync(a, 'video-bytes')
    writeFileSync(join(dir, 'taken.mkv'), '')
    await expect(movePath(a, join(dir, 'taken.mkv'))).rejects.toThrow(
      '目标已存在'
    )
    const mtime = statSync(a).mtimeMs
    const exdev = Object.assign(new Error('cross-device'), { code: 'EXDEV' })
    const result = await movePath(a, b, { rename: () => Promise.reject(exdev) })
    expect(result.crossDevice).toBe(true)
    expect(readFileSync(b, 'utf8')).toBe('video-bytes')
    expect(Math.abs(statSync(b).mtimeMs - mtime)).toBeLessThan(1)
    expect(readdirSync(dir).sort()).toEqual(['taken.mkv', 'x'])
    expect(readdirSync(join(dir, 'x'))).toEqual(['b.mkv'])
  })
})
