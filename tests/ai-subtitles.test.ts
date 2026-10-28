import { basename, dirname, normalize } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AiSubtitleRecord } from '../src/shared/ai-subtitles/types'
import {
  SIBLING_ATTEMPTS,
  cacheSubtitlePath,
  mergeOutputs,
  ownedOutputs,
  parseRecords,
  siblingCandidates,
  siblingSubtitlePath,
  upsertRecord,
} from '../src/main/ai-subtitles/output'
import {
  type PipelineDeps,
  runPipeline,
} from '../src/main/ai-subtitles/pipeline'
import {
  createAiSubtitleQueue,
  errorText,
} from '../src/main/ai-subtitles/queue'
import {
  assertCloudSpeech,
  createCloudRecognizer,
  createLocalRecognizer,
} from '../src/main/ai-subtitles/recognize'
import {
  dominantLanguage,
  extractArgs,
  normalizeLanguage,
  parseCloudTranscription,
  parseDuration,
  parseWhisperJson,
  parseWhisperProgress,
  planChunks,
  whisperArgs,
} from '../src/main/ai-subtitles/speech-rules'
import {
  type TranslateDeps,
  composeCues,
  makeBatches,
  readBatchResult,
  translateCues,
} from '../src/main/ai-subtitles/translate'
import {
  jobOverallPercent,
  jobStatusText,
  latestJobFor,
} from '../src/renderer/src/features/player/ai-subtitle/ai-subtitle-rules'
import {
  cuesBefore,
  formatSrt,
  formatSrtTime,
  parseSrt,
  parseSrtTime,
} from '../src/shared/ai-subtitles/srt'
import type {
  AiSubtitleCue,
  AiSubtitleJob,
} from '../src/shared/ai-subtitles/types'
import { parseStartOptions } from '../src/shared/contract/ai-subtitles'

const cue = (start: number, text: string): AiSubtitleCue => ({
  start,
  end: start + 900,
  text,
})
const cues = (n: number): AiSubtitleCue[] =>
  Array.from({ length: n }, (_, i) => cue(i * 1000, `line ${i + 1}`))

/** 把 lines 原样「翻译」成 「译:原文」的 mock */
function echoDeps(overrides: Partial<TranslateDeps> = {}): TranslateDeps {
  return {
    json: vi.fn(async messages => {
      const body = JSON.parse(messages[1].content) as {
        lines: { id: number; text: string }[]
      }
      return {
        items: body.lines.map(l => ({ id: l.id, text: `译:${l.text}` })),
      }
    }),
    text: vi.fn(async messages => `单:${messages[1].content}`),
    ...overrides,
  }
}

describe('SRT', () => {
  it('时间互转', () => {
    expect(parseSrtTime('01:02:03,456')).toBe(3_723_456)
    expect(parseSrtTime('00:00:01.5')).toBe(1500)
    expect(parseSrtTime('bad')).toBeNull()
    expect(formatSrtTime(3_723_456)).toBe('01:02:03,456')
    expect(formatSrtTime(-5)).toBe('00:00:00,000')
  })

  it('解析容忍 BOM / CRLF / 缺编号，跳过坏块', () => {
    const text =
      '\uFEFF1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\nworld\r\n\r\n' +
      '00:00:03,000 --> 00:00:04,000\r\n你好\r\n\r\n3\r\nxx --> yy\r\n坏块\r\n'
    expect(parseSrt(text)).toEqual([
      { start: 1000, end: 2000, text: 'Hello\nworld' },
      { start: 3000, end: 4000, text: '你好' },
    ])
  })

  it('生成：排序、重新编号、跳过空字幕，可往返', () => {
    const out = formatSrt([cue(2000, 'b'), cue(0, 'a'), cue(5000, '  ')])
    expect(out).toBe(
      '1\n00:00:00,000 --> 00:00:00,900\na\n\n2\n00:00:02,000 --> 00:00:02,900\nb\n'
    )
    expect(parseSrt(out)).toHaveLength(2)
  })

  it('cuesBefore 只给进度之前的台词', () => {
    expect(cuesBefore(cues(5), 2.5).map(c => c.text)).toEqual([
      'line 1',
      'line 2',
      'line 3',
    ])
  })
})

describe('语音识别规则', () => {
  it('10 分钟分段，短尾巴并进上一段', () => {
    expect(planChunks(1500)).toEqual([
      { index: 0, start: 0, duration: 600 },
      { index: 1, start: 600, duration: 600 },
      { index: 2, start: 1200, duration: 300 },
    ])
    expect(planChunks(1210).map(c => c.duration)).toEqual([600, 610])
    expect(planChunks(0)).toEqual([])
    expect(planChunks(NaN)).toEqual([])
  })

  it('时长：ffprobe 数字或 ffmpeg 的 Duration 行', () => {
    expect(parseDuration('5423.120000\n')).toBeCloseTo(5423.12)
    expect(parseDuration('  Duration: 01:30:05.50, start: 0')).toBeCloseTo(
      5405.5
    )
    expect(parseDuration('nothing')).toBeNull()
  })

  it('ffmpeg / whisper-cli 参数', () => {
    const ff = extractArgs(
      '/v/a.mkv',
      { index: 1, start: 600, duration: 600 },
      '/t/c.wav'
    )
    expect(ff.join(' ')).toContain('-ss 600 -t 600 -i /v/a.mkv')
    expect(ff.join(' ')).toContain('-ac 1 -ar 16000')
    const w = whisperArgs({
      model: '/m.bin',
      wav: '/t/c.wav',
      outBase: '/t/c',
      threads: 3,
    })
    expect(w).toEqual([
      '-m',
      '/m.bin',
      '-f',
      '/t/c.wav',
      '-l',
      'auto',
      '-oj',
      '-of',
      '/t/c',
      '-pp',
      '-t',
      '3',
    ])
  })

  it('whisper 进度行与 JSON 输出', () => {
    expect(
      parseWhisperProgress('whisper_print_progress_callback: progress =  45%')
    ).toBe(45)
    expect(parseWhisperProgress('main: processing')).toBeNull()
    const json = JSON.stringify({
      result: { language: 'en' },
      transcription: [
        { offsets: { from: 0, to: 1500 }, text: ' Hello there.' },
        { offsets: { from: 1500, to: 2000 }, text: ' [BLANK_AUDIO]' },
        { offsets: { from: 2000, to: 3000 }, text: '[_BEG_] Bye' },
      ],
    })
    expect(parseWhisperJson(json)).toEqual({
      language: 'en',
      cues: [
        { start: 0, end: 1500, text: 'Hello there.' },
        { start: 2000, end: 3000, text: 'Bye' },
      ],
    })
    expect(() => parseWhisperJson('oops')).toThrow('不是合法 JSON')
  })

  it('云端 verbose_json：segments 秒 → 毫秒；只有 text 时整段一条', () => {
    expect(
      parseCloudTranscription(
        {
          language: 'japanese',
          segments: [{ start: 1.2, end: 2.5, text: ' こんにちは' }],
        },
        600
      )
    ).toEqual({
      language: 'ja',
      cues: [{ start: 1200, end: 2500, text: 'こんにちは' }],
    })
    expect(parseCloudTranscription({ text: 'hi' }, 10).cues).toEqual([
      { start: 0, end: 10_000, text: 'hi' },
    ])
  })

  it('语言规范化与多数语言', () => {
    expect(normalizeLanguage('English')).toBe('en')
    expect(normalizeLanguage('auto')).toBe('')
    expect(dominantLanguage(['en', 'ja', 'en', ''])).toBe('en')
  })
})

describe('分批与合并', () => {
  it('每批 40 条，前后各带 2 条上下文', () => {
    const batches = makeBatches(85)
    expect(batches.map(b => b.ids.length)).toEqual([40, 40, 5])
    expect(batches[0].before).toEqual([])
    expect(batches[0].after).toEqual([40, 41])
    expect(batches[1].before).toEqual([38, 39])
    expect(batches[2].after).toEqual([])
  })

  it('composeCues：中文 / 双语（中文在上）/ 原文', () => {
    const list = [cue(0, 'Hi'), cue(1000, 'OK')]
    expect(composeCues(list, ['嗨', ''], 'zh').map(c => c.text)).toEqual([
      '嗨',
      'OK',
    ])
    expect(
      composeCues(list, ['嗨', 'OK'], 'bilingual').map(c => c.text)
    ).toEqual(['嗨\nHi', 'OK'])
    expect(
      composeCues(list, ['嗨', '好'], 'original').map(c => c.text)
    ).toEqual(['Hi', 'OK'])
  })
})

describe('翻译结果校验与降级', () => {
  const batch = makeBatches(3)[0]

  it('条数、编号一致才通过', () => {
    const ok = { items: [1, 2, 3].map(id => ({ id, text: `t${id}` })) }
    expect(readBatchResult(ok, batch)?.get(2)).toBe('t3')
    expect(readBatchResult(ok.items, batch)).not.toBeNull()
    expect(readBatchResult({ items: ok.items.slice(0, 2) }, batch)).toBeNull()
    expect(
      readBatchResult(
        { items: [...ok.items.slice(0, 2), { id: 9, text: 'x' }] },
        batch
      )
    ).toBeNull()
    expect(
      readBatchResult({ items: [ok.items[0], ok.items[0], ok.items[1]] }, batch)
    ).toBeNull()
    expect(
      readBatchResult(
        {
          items: [
            { id: '1', text: 'a' },
            { id: 2, text: 'b' },
            { id: 3, text: ' ' },
          ],
        },
        batch
      )
    ).toBeNull()
  })

  it('正常分批翻译并报告进度', async () => {
    const deps = echoDeps()
    const progress: number[] = []
    const out = await translateCues(cues(45), {
      deps,
      onProgress: p => progress.push(p),
    })
    expect(out[0]).toBe('译:line 1')
    expect(out[44]).toBe('译:line 45')
    expect(deps.json).toHaveBeenCalledTimes(2)
    expect(progress).toEqual([50, 100])
  })

  it('条数不符先重试，仍不符降级逐条；逐条失败保留原文', async () => {
    const json = vi.fn(async () => ({ items: [{ id: 1, text: 'only one' }] }))
    const text = vi
      .fn()
      .mockResolvedValueOnce('“一”')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('三')
    const warn = vi.fn()
    const out = await translateCues(cues(3), {
      deps: { json, text },
      onWarn: warn,
    })
    expect(json).toHaveBeenCalledTimes(2)
    expect(out).toEqual(['一', 'line 2', '三'])
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('重试后成功就不降级', async () => {
    const good = echoDeps()
    const json = vi
      .fn()
      .mockRejectedValueOnce(new Error('bad_json'))
      .mockImplementation(good.json)
    const out = await translateCues(cues(2), {
      deps: { json, text: good.text },
    })
    expect(out).toEqual(['译:line 1', '译:line 2'])
    expect(good.text).not.toHaveBeenCalled()
  })

  it('没配置 / 私密拦截 / 取消直接失败，不降级', async () => {
    const err = Object.assign(new Error('x'), { code: 'private_blocked' })
    const deps = echoDeps({ json: vi.fn().mockRejectedValue(err) })
    await expect(translateCues(cues(2), { deps })).rejects.toBe(err)
    expect(deps.text).not.toHaveBeenCalled()
  })
})

describe('输出位置与记录', () => {
  it('视频旁边：.zh / .zh.<语言> / .<语言>，被占用时加 .ai', () => {
    const free = (): boolean => false
    expect(siblingSubtitlePath('/v/Movie.mkv', 'zh', 'en', free)).toBe(
      '/v/Movie.zh.srt'
    )
    expect(siblingSubtitlePath('/v/Movie.mkv', 'bilingual', 'ja', free)).toBe(
      '/v/Movie.zh.ja.srt'
    )
    expect(siblingSubtitlePath('/v/Movie.mkv', 'original', '', free)).toBe(
      '/v/Movie.ai.srt'
    )
    expect(
      siblingSubtitlePath('/v/Movie.mkv', 'zh', 'en', p =>
        p.endsWith('Movie.zh.srt')
      )
    ).toBe('/v/Movie.zh.ai.srt')
  })

  it('.zh.srt 与 .zh.ai.srt 都被占用时选下一个未占用的编号名', () => {
    const taken = new Set(['/v/Movie.zh.srt', '/v/Movie.zh.ai.srt'])
    expect(
      siblingSubtitlePath('/v/Movie.mkv', 'zh', 'en', p => taken.has(p))
    ).toBe('/v/Movie.zh.ai.2.srt')
    taken.add('/v/Movie.zh.ai.2.srt')
    expect(
      siblingSubtitlePath('/v/Movie.mkv', 'zh', 'en', p => taken.has(p))
    ).toBe('/v/Movie.zh.ai.3.srt')
  })

  it('候选名全部被占用时返回 null（改写字幕缓存），候选数有上限', () => {
    const list = siblingCandidates('/v/Movie.mkv', 'zh', 'en')
    expect(list).toHaveLength(SIBLING_ATTEMPTS + 1)
    expect(list.at(-1)).toBe(`/v/Movie.zh.ai.${SIBLING_ATTEMPTS}.srt`)
    expect(siblingSubtitlePath('/v/Movie.mkv', 'zh', 'en', () => true)).toBe(
      null
    )
  })

  it('只有本功能为这个视频记录过的文件可以覆盖', () => {
    const previous: AiSubtitleRecord = {
      videoPath: '/v/Movie.mkv',
      path: '/v/Movie.zh.ai.srt',
      mode: 'zh',
      language: 'en',
      updatedAt: 1,
      outputs: ['/v/Movie.zh.ai.srt', '/v/Movie.zh.ja.srt'],
    }
    const owned = new Set(ownedOutputs(previous))
    const onDisk = new Set(['/v/Movie.zh.srt', '/v/Movie.zh.ai.srt'])
    const occupied = (p: string): boolean => onDisk.has(p) && !owned.has(p)
    // 用户的 .zh.srt 跳过，本功能写过的 .zh.ai.srt 覆盖
    expect(siblingSubtitlePath('/v/Movie.mkv', 'zh', 'en', occupied)).toBe(
      '/v/Movie.zh.ai.srt'
    )
    // 旧记录没有 outputs 时只认 path
    expect(ownedOutputs({ ...previous, outputs: undefined })).toEqual([
      '/v/Movie.zh.ai.srt',
    ])
    expect(ownedOutputs(null)).toEqual([])
    // 已写文件列表：新的在前、去重
    expect(mergeOutputs(previous, '/v/Movie.zh.ja.srt')).toEqual([
      '/v/Movie.zh.ja.srt',
      '/v/Movie.zh.ai.srt',
    ])
    expect(mergeOutputs(null, '/c/a.srt')).toEqual(['/c/a.srt'])
    expect(parseRecords(JSON.stringify([previous]))).toEqual([previous])
    expect(
      parseRecords(JSON.stringify([{ ...previous, outputs: [1] }]))
    ).toEqual([])
  })

  it('缓存路径按视频路径哈希，同视频同模式稳定', () => {
    const a = cacheSubtitlePath('/c', '/v/片 名.mkv', 'zh')
    expect(a).toBe(cacheSubtitlePath('/c', '/v/片 名.mkv', 'zh'))
    expect(a).not.toBe(cacheSubtitlePath('/c', '/w/片 名.mkv', 'zh'))
    expect(dirname(a)).toBe(normalize('/c'))
    expect(basename(a)).toMatch(/^片_名\.[0-9a-f]{16}\.zh\.srt$/)
  })

  it('记录：每个视频一条、坏文件当空', () => {
    const r = (videoPath: string, t: number): AiSubtitleRecord => ({
      videoPath,
      path: `${videoPath}.srt`,
      mode: 'zh' as const,
      language: 'en',
      updatedAt: t,
    })
    const list = upsertRecord(upsertRecord([], r('/a', 1)), r('/a', 2))
    expect(list).toEqual([r('/a', 2)])
    expect(parseRecords(JSON.stringify(list))).toEqual(list)
    expect(parseRecords('{bad')).toEqual([])
  })
})

/** 流程依赖的 mock：两段音频，每段一条英文台词 */
function pipelineDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    probeDuration: vi.fn(async () => 1000),
    makeTempDir: vi.fn(async () => '/tmp/x'),
    removeTempDir: vi.fn(async () => {}),
    extract: vi.fn(async () => {}),
    recognize: vi.fn(async (_wav, chunk, options) => {
      options.onProgress(50)
      return { language: 'en', cues: [cue(1000, `chunk ${chunk.index}`)] }
    }),
    checkTranslate: vi.fn(),
    translate: echoDeps(),
    write: vi.fn(async () => '/v/a.zh.srt'),
    ...overrides,
  }
}

describe('流程', () => {
  const signal = new AbortController().signal

  it('分段识别 → 平移时间轴 → 翻译 → 写出 SRT', async () => {
    const deps = pipelineDeps()
    const progress: string[] = []
    const result = await runPipeline(
      { videoPath: '/v/a.mkv', mode: 'bilingual', title: 'A' },
      deps,
      { signal, onProgress: (phase, p) => progress.push(`${phase}:${p}`) }
    )
    expect(result.language).toBe('en')
    expect(result.cues.map(c => [c.start, c.text])).toEqual([
      [1000, '译:chunk 0\nchunk 0'],
      [601_000, '译:chunk 1\nchunk 1'],
    ])
    const srt = vi.mocked(deps.write).mock.calls[0][3]
    expect(parseSrt(srt)).toHaveLength(2)
    expect(progress).toContain('recognizing:25')
    expect(progress).toContain('recognizing:100')
    expect(progress.at(-1)).toBe('translating:100')
    expect(deps.removeTempDir).toHaveBeenCalledWith('/tmp/x')
  })

  it('识别出中文不翻译；原文模式不检查翻译模型', async () => {
    const deps = pipelineDeps({
      recognize: vi.fn(async () => ({
        language: 'zh',
        cues: [cue(0, '你好')],
      })),
    })
    const result = await runPipeline({ videoPath: '/v', mode: 'zh' }, deps, {
      signal,
      onProgress: () => {},
    })
    expect(result.cues[0].text).toBe('你好')
    expect(deps.translate.json).not.toHaveBeenCalled()
    const original = pipelineDeps()
    await runPipeline({ videoPath: '/v', mode: 'original' }, original, {
      signal,
      onProgress: () => {},
    })
    expect(original.checkTranslate).not.toHaveBeenCalled()
    expect(original.translate.json).not.toHaveBeenCalled()
  })

  it('翻译不可用时识别前就失败；没识别到台词时失败并清理临时目录', async () => {
    const blocked = pipelineDeps({
      checkTranslate: () => {
        throw new Error('没配置')
      },
    })
    await expect(
      runPipeline({ videoPath: '/v', mode: 'zh' }, blocked, {
        signal,
        onProgress: () => {},
      })
    ).rejects.toThrow('没配置')
    expect(blocked.extract).not.toHaveBeenCalled()
    const empty = pipelineDeps({
      recognize: vi.fn(async () => ({ language: '', cues: [] })),
    })
    await expect(
      runPipeline({ videoPath: '/v', mode: 'zh' }, empty, {
        signal,
        onProgress: () => {},
      })
    ).rejects.toThrow('没有识别到台词')
    expect(empty.removeTempDir).toHaveBeenCalled()
  })
})

describe('任务队列', () => {
  const tick = (): Promise<unknown> =>
    new Promise(resolve => setTimeout(resolve, 0))

  it('一次一个，进度只在整数变化时推送，完成后记输出', async () => {
    const events: string[] = []
    let release!: () => void
    const run = vi.fn(async (_job, ctx) => {
      ctx.onProgress('recognizing', 10.2)
      ctx.onProgress('recognizing', 10.7)
      await new Promise<void>(resolve => (release = resolve))
      return { outputPath: '/o.srt', language: 'en' }
    })
    const queue = createAiSubtitleQueue({
      run,
      emit: job => events.push(`${job.id}:${job.phase}:${job.percent}`),
    })
    const a = queue.add('local://a', '/a', { mode: 'zh' })
    const b = queue.add('local://b', '/b', { mode: 'zh' })
    expect(queue.add('local://a', '/a', { mode: 'zh' }).id).toBe(a.id)
    await tick()
    expect(run).toHaveBeenCalledTimes(1)
    expect(
      events.filter(e => e.startsWith(`${a.id}:recognizing:10`))
    ).toHaveLength(1)
    release()
    await tick()
    await tick()
    expect(run).toHaveBeenCalledTimes(2)
    release()
    await queue.idle()
    const done = queue.list().find(job => job.id === a.id)
    expect(done).toMatchObject({
      phase: 'done',
      outputPath: '/o.srt',
      language: 'en',
    })
    expect(queue.list().find(job => job.id === b.id)?.phase).toBe('done')
  })

  it('取消进行中与排队中的任务；失败记原因', async () => {
    const run = vi.fn(
      (_job, ctx: { signal: AbortSignal }) =>
        new Promise<never>((_, reject) =>
          ctx.signal.addEventListener('abort', () =>
            reject(new Error('aborted'))
          )
        )
    )
    const queue = createAiSubtitleQueue({ run, emit: () => {} })
    const a = queue.add('s', '/a', { mode: 'zh' })
    const b = queue.add('s2', '/b', { mode: 'zh' })
    await tick()
    expect(queue.cancel(b.id)).toBe(true)
    expect(queue.cancel(a.id)).toBe(true)
    await queue.idle()
    expect(queue.list().map(j => j.phase)).toEqual(['cancelled', 'cancelled'])
    expect(run).toHaveBeenCalledTimes(1)
    const failing = createAiSubtitleQueue({
      run: async () => {
        throw new Error('[ai:http] 请求太频繁')
      },
      emit: () => {},
    })
    failing.add('s', '/c', { mode: 'zh' })
    await failing.idle()
    expect(failing.list()[0]).toMatchObject({
      phase: 'failed',
      error: '请求太频繁',
    })
    expect(
      errorText(new Error('Error invoking remote method: [ai:timeout] 超时'))
    ).toBe('超时')
  })
})

describe('识别器', () => {
  const chunk = { index: 0, start: 0, duration: 600 }
  const signal = new AbortController().signal

  it('本地 whisper：转发进度、读 JSON、删临时输出', async () => {
    const run = vi.fn(async (_bin, _args, options) => {
      options.onLine?.('progress = 30%')
      return { code: 0, tail: [] }
    })
    const remove = vi.fn(async () => {})
    const recognize = createLocalRecognizer({
      bin: 'whisper-cli',
      model: '/m.bin',
      run,
      exists: () => true,
      remove,
      readText: async () =>
        JSON.stringify({
          result: { language: 'en' },
          transcription: [{ offsets: { from: 0, to: 10 }, text: 'Hi' }],
        }),
    })
    const seen: number[] = []
    const out = await recognize('/t/c.wav', chunk, {
      signal,
      onProgress: p => seen.push(p),
    })
    expect(out.cues[0].text).toBe('Hi')
    expect(seen).toEqual([30])
    expect(remove).toHaveBeenCalledWith('/t/c.json')
  })

  it('本地 whisper：没有模型 / 非 0 退出给出可读错误', async () => {
    const base = {
      bin: 'w',
      model: '/m.bin',
      run: vi.fn(async () => ({ code: 1, tail: ['bad model'] })),
      readText: async () => '',
      remove: async () => {},
    }
    await expect(
      createLocalRecognizer({ ...base, exists: () => false })('/c.wav', chunk, {
        signal,
        onProgress: () => {},
      })
    ).rejects.toThrow('找不到 Whisper 模型文件')
    await expect(
      createLocalRecognizer({ ...base, exists: () => true })('/c.wav', chunk, {
        signal,
        onProgress: () => {},
      })
    ).rejects.toThrow('bad model')
  })

  it('云端转写：multipart + Bearer，解析 verbose_json；私密遇非本地接口拒绝', async () => {
    const config = {
      engine: 'cloud' as const,
      model: 'whisper-1',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
    }
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            language: 'english',
            segments: [{ start: 0, end: 1, text: 'Hi' }],
          })
        )
    )
    const recognize = createCloudRecognizer({
      config,
      isPrivate: false,
      privateLocalOnly: true,
      fetch,
      readFile: async () => new Uint8Array(4),
    })
    const out = await recognize('/c.wav', chunk, {
      signal,
      onProgress: () => {},
      language: 'en',
    })
    expect(out).toEqual({
      language: 'en',
      cues: [{ start: 0, end: 1000, text: 'Hi' }],
    })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/audio/transcriptions')
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer k'
    )
    const form = init.body as FormData
    expect(form.get('response_format')).toBe('verbose_json')
    expect(form.get('language')).toBe('en')
    expect(() => assertCloudSpeech(config, true, true)).toThrow(
      '[ai:private_blocked]'
    )
    expect(() =>
      assertCloudSpeech(
        { ...config, baseUrl: 'http://127.0.0.1:8080/v1', apiKey: '' },
        true,
        true
      )
    ).not.toThrow()
    const failing = createCloudRecognizer({
      config,
      isPrivate: false,
      privateLocalOnly: true,
      fetch: async () =>
        new Response('{"error":{"message":"no"}}', { status: 401 }),
      readFile: async () => new Uint8Array(1),
    })
    await expect(
      failing('/c.wav', chunk, { signal, onProgress: () => {} })
    ).rejects.toThrow('API Key 无效')
  })
})

describe('面板规则与 IPC 参数', () => {
  const job = (patch: Partial<AiSubtitleJob>): AiSubtitleJob => ({
    id: 'j',
    source: 'local://a',
    videoPath: '/a',
    title: '',
    mode: 'zh',
    private: false,
    phase: 'recognizing',
    percent: 50,
    language: '',
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  })

  it('状态文案与总进度', () => {
    expect(jobStatusText(job({}))).toBe('识别 50%')
    expect(jobStatusText(job({ phase: 'translating', percent: 20 }))).toBe(
      '翻译 20%'
    )
    expect(jobStatusText(job({ phase: 'failed', error: '没模型' }))).toBe(
      '生成失败：没模型'
    )
    expect(jobOverallPercent(job({}))).toBe(35)
    expect(jobOverallPercent(job({ phase: 'translating', percent: 50 }))).toBe(
      85
    )
    expect(jobOverallPercent(job({ mode: 'original' }))).toBe(50)
  })

  it('按视频取最新任务', () => {
    const list = [
      job({ id: '1', createdAt: 1 }),
      job({ id: '2', createdAt: 5 }),
      job({ id: '3', source: 'x', createdAt: 9 }),
    ]
    expect(latestJobFor(list, 'local://a')?.id).toBe('2')
    expect(latestJobFor(list, 'none')).toBeNull()
  })

  it('start 选项只保留认识的字段', () => {
    expect(
      parseStartOptions({
        mode: 'bilingual',
        private: true,
        title: ' T ',
        language: 'en',
        extra: 1,
      })
    ).toEqual({
      mode: 'bilingual',
      private: true,
      title: 'T',
      language: 'en',
    })
    expect(() => parseStartOptions({ mode: 'x' })).toThrow('mode')
  })
})
