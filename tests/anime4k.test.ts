import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  ANIME4K_FILES,
  ANIME4K_MODES,
  ANIME4K_OFF,
  ANIME4K_QUALITIES,
  anime4kLabel,
  anime4kShaders,
  anime4kSourceUrls,
  isAnimeEntry,
  parseAnime4kConfig,
  shouldApplyAnime4k,
} from '../src/shared/anime4k'
import { settingsSchema } from '../src/shared/settings/schema'

describe('模式 → 着色器列表（与官方 mpv 模板一致）', () => {
  it('模式 A 画质档', () => {
    expect(anime4kShaders('a', 'hq')).toEqual([
      'Anime4K_Clamp_Highlights.glsl',
      'Anime4K_Restore_CNN_VL.glsl',
      'Anime4K_Upscale_CNN_x2_VL.glsl',
      'Anime4K_AutoDownscalePre_x2.glsl',
      'Anime4K_AutoDownscalePre_x4.glsl',
      'Anime4K_Upscale_CNN_x2_M.glsl',
    ])
  })

  it('模式 B 性能档', () => {
    expect(anime4kShaders('b', 'fast')).toEqual([
      'Anime4K_Clamp_Highlights.glsl',
      'Anime4K_Restore_CNN_Soft_M.glsl',
      'Anime4K_Upscale_CNN_x2_M.glsl',
      'Anime4K_AutoDownscalePre_x2.glsl',
      'Anime4K_AutoDownscalePre_x4.glsl',
      'Anime4K_Upscale_CNN_x2_S.glsl',
    ])
  })

  it('模式 C 先降噪放大、不做 Restore', () => {
    expect(anime4kShaders('c', 'hq')).toEqual([
      'Anime4K_Clamp_Highlights.glsl',
      'Anime4K_Upscale_Denoise_CNN_x2_VL.glsl',
      'Anime4K_AutoDownscalePre_x2.glsl',
      'Anime4K_AutoDownscalePre_x4.glsl',
      'Anime4K_Upscale_CNN_x2_M.glsl',
    ])
    expect(anime4kShaders('c', 'fast')).toContain(
      'Anime4K_Upscale_Denoise_CNN_x2_M.glsl'
    )
  })

  it('每种组合用到的文件都有来源与校验值，清单里没有用不到的文件', () => {
    const used = new Set<string>()
    for (const mode of ANIME4K_MODES) {
      for (const quality of ANIME4K_QUALITIES) {
        const list = anime4kShaders(mode, quality)
        // 同一个文件不能挂两次（官方说明：会出错且掉性能）
        expect(new Set(list).size).toBe(list.length)
        list.forEach(name => used.add(name))
      }
    }
    expect([...used].sort()).toEqual(Object.keys(ANIME4K_FILES).sort())
    for (const [name, file] of Object.entries(ANIME4K_FILES)) {
      expect(file.path.endsWith(`/${name}`)).toBe(true)
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})

describe('是否启用', () => {
  const on = { ...ANIME4K_OFF, enabled: true }

  it('关闭时从不启用', () => {
    expect(shouldApplyAnime4k(ANIME4K_OFF, true)).toBe(false)
  })

  it('不限条目时任何条目都启用', () => {
    expect(shouldApplyAnime4k(on, undefined)).toBe(true)
    expect(shouldApplyAnime4k(on, false)).toBe(true)
  })

  it('仅动画类条目：只有确认是动画才启用', () => {
    const animeOnly = { ...on, animeOnly: true }
    expect(shouldApplyAnime4k(animeOnly, true)).toBe(true)
    expect(shouldApplyAnime4k(animeOnly, false)).toBe(false)
    expect(shouldApplyAnime4k(animeOnly, undefined)).toBe(false)
  })
})

describe('动画条目判断', () => {
  it('TMDB 类型', () => {
    expect(isAnimeEntry({ genres: ['动作', '动画'] })).toBe(true)
    expect(isAnimeEntry({ genres: ['Animation'] })).toBe(true)
    expect(isAnimeEntry({ genres: ['剧情', '犯罪'] })).toBe(false)
  })

  it('在线站点分类', () => {
    expect(isAnimeEntry({ typeName: '日韩动漫' })).toBe(true)
    expect(isAnimeEntry({ typeName: '国产动漫' })).toBe(true)
    expect(isAnimeEntry({ typeName: '番剧' })).toBe(true)
    expect(isAnimeEntry({ typeName: '国产剧' })).toBe(false)
  })

  it('什么都拿不到时不算动画', () => {
    expect(isAnimeEntry({})).toBe(false)
    expect(isAnimeEntry({ genres: [], typeName: '' })).toBe(false)
  })
})

describe('下载来源与配置校验', () => {
  it('固定在 v4.0.1，GitHub 原始文件优先，jsDelivr 兜底；路径里的 + 要编码', () => {
    const urls = anime4kSourceUrls(
      'glsl/Upscale+Denoise/Anime4K_Upscale_Denoise_CNN_x2_M.glsl'
    )
    expect(urls).toEqual([
      'https://raw.githubusercontent.com/bloc97/Anime4K/v4.0.1/glsl/Upscale%2BDenoise/Anime4K_Upscale_Denoise_CNN_x2_M.glsl',
      'https://cdn.jsdelivr.net/gh/bloc97/Anime4K@v4.0.1/glsl/Upscale%2BDenoise/Anime4K_Upscale_Denoise_CNN_x2_M.glsl',
    ])
  })

  it('配置字段齐全且取值合法才接受', () => {
    const config = { enabled: true, mode: 'b', quality: 'hq', animeOnly: true }
    expect(parseAnime4kConfig(config)).toEqual(config)
    expect(() => parseAnime4kConfig({ ...config, mode: 'd' })).toThrow()
    expect(() => parseAnime4kConfig({ ...config, quality: 'ul' })).toThrow()
    expect(() => parseAnime4kConfig({ ...config, enabled: 1 })).toThrow()
    expect(() => parseAnime4kConfig(null)).toThrow()
  })

  it('设置项的取值范围与规则一致，默认关闭', () => {
    expect(settingsSchema['player.anime4k'].default).toBe(false)
    expect(settingsSchema['player.anime4kAnimeOnly'].default).toBe(false)
    for (const mode of ANIME4K_MODES) {
      expect(settingsSchema['player.anime4kMode'].parse(mode)).toBe(mode)
    }
    for (const quality of ANIME4K_QUALITIES) {
      expect(settingsSchema['player.anime4kQuality'].parse(quality)).toBe(
        quality
      )
    }
    expect(settingsSchema['player.anime4kMode'].parse('d')).toBeUndefined()
  })

  it('提示文案', () => {
    expect(anime4kLabel('a', 'hq')).toBe('Anime4K：模式 A（画质）')
    expect(anime4kLabel('c', 'fast')).toBe('Anime4K：模式 C（性能）')
  })
})

// ── 主进程：挂载顺序与重复同步（着色器文件预先放好，不走网络） ─────────────

const fake = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => fake.dir } }))
vi.mock('../src/main/http-client', () => ({
  fetchHttp: async () => {
    throw new Error('测试里不联网')
  },
  readLimited: async () => Buffer.alloc(0),
}))

describe('Anime4kSync：经 glsl-shaders 挂载 / 清除', () => {
  beforeAll(async () => {
    fake.dir = await mkdtemp(join(tmpdir(), 'a4k-'))
    const dir = join(fake.dir, 'anime4k', 'v4.0.1')
    await mkdir(dir, { recursive: true })
    // 测试用内容：改写清单里的校验值，与预置文件对应
    for (const [name, file] of Object.entries(ANIME4K_FILES)) {
      const body = `// ${name}`
      await writeFile(join(dir, name), body)
      ;(file as { sha256: string }).sha256 = createHash('sha256')
        .update(body)
        .digest('hex')
    }
  })
  afterAll(() => rm(fake.dir, { recursive: true, force: true }))

  interface Harness {
    sync: import('../src/main/mpv-anime4k').Anime4kSync
    sent: unknown[][]
    shaderCommands: () => unknown[][]
  }

  const setup = async (running = true): Promise<Harness> => {
    const { Anime4kSync } = await import('../src/main/mpv-anime4k')
    const sent: unknown[][] = []
    const sync = new Anime4kSync(
      async (...args) => {
        sent.push(args)
      },
      () => running,
      () => {}
    )
    const shaderCommands = (): unknown[][] =>
      sent.filter(c => c[0] === 'change-list').map(c => [c[2], c[3]])
    return { sync, sent, shaderCommands }
  }

  it('先清空再按顺序追加，并在 mpv 窗口提示模式', async () => {
    const { sync, sent, shaderCommands } = await setup()
    await sync.setConfig({ ...ANIME4K_OFF, enabled: true, mode: 'b' })
    await sync.apply(false)
    const expected = anime4kShaders('b', 'fast').map(name =>
      join(fake.dir, 'anime4k', 'v4.0.1', name)
    )
    expect(shaderCommands()).toEqual([
      ['clr', ''],
      ...expected.map(path => ['append', path]),
    ])
    expect(sent.some(c => c[0] === 'show-text')).toBe(true)
  })

  it('列表没变不重复发；关闭时清空', async () => {
    const { sync, shaderCommands } = await setup()
    const on = { ...ANIME4K_OFF, enabled: true }
    await sync.setConfig(on)
    const count = shaderCommands().length
    await sync.apply(true)
    expect(shaderCommands().length).toBe(count)
    await sync.setConfig(ANIME4K_OFF)
    expect(shaderCommands().at(-1)).toEqual(['clr', ''])
  })

  it('仅动画类条目：非动画不挂；mpv 没在运行时什么都不发', async () => {
    const animeOnly = { ...ANIME4K_OFF, enabled: true, animeOnly: true }
    const a = await setup()
    await a.sync.setConfig(animeOnly)
    await a.sync.apply(false)
    expect(a.shaderCommands().filter(c => c[0] === 'append')).toEqual([])
    const b = await setup(false)
    await b.sync.setConfig(animeOnly)
    await b.sync.apply(true)
    expect(b.sent).toEqual([])
  })
})
