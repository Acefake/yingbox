import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import type { LadaJob } from '../src/shared/lada'
import {
  SEGMENT_SECONDS,
  applyProgress,
  buildPlaylist,
  classifyTempEntry,
  durationMismatch,
  exitError,
  fmtClock,
  foreignJobMessage,
  isResumeProgressFile,
  isServableName,
  ladaArgs,
  parseDuration,
  parseSegmentProbe,
  rangeOutputName,
  rangeStart,
  rangeStop,
  sanitizeOverrides,
  segmentName,
  segmentVerdict,
  sidecarVideo,
  sortParts,
  splitProgress,
  tempVideoFor,
  videoExtProblem,
} from '../src/main/plugins/lada/rules'

describe('lada 输入与参数', () => {
  it('只接受白名单扩展名（大小写不敏感）', () => {
    expect(videoExtProblem('C:\\a\\b.MKV')).toBeNull()
    expect(videoExtProblem('/a/b.m2ts')).toBeNull()
    expect(videoExtProblem('/a/b.txt')).toBe('不支持的格式：.txt')
    expect(videoExtProblem('noext')).toBe('不支持的格式：未知')
  })
  it('路径覆盖只保留绝对路径字符串', () => {
    expect(sanitizeOverrides({ cli: '/x/lada-cli', ffmpeg: 'ffmpeg' })).toEqual({ cli: '/x/lada-cli' })
    expect(sanitizeOverrides({ cli: 3 })).toEqual({})
    expect(sanitizeOverrides(null)).toBeNull()
    expect(sanitizeOverrides('x')).toBeNull()
  })
  it('半成品路径与 lada 的命名一致：<名>.tmp.<扩展名>', () => {
    expect(tempVideoFor('/tmp/yl', 'D:\\v\\a.b.restored.mp4')).toBe(join('/tmp/yl', 'a.b.restored.tmp.mp4'))
  })
  it('命令行带上编码预设与快速起播', () => {
    expect(ladaArgs('in.mp4', 'out.mp4', '/t')).toEqual([
      '--input', 'in.mp4', '--output', 'out.mp4', '--temporary-directory', '/t',
      '--encoding-preset', 'hevc-nvidia-gpu-hq', '--mp4-fast-start',
    ])
  })
  it('别的实例占锁时提示带文件名', () => {
    expect(foreignJobMessage('C:\\v\\a.mp4')).toContain('在跑：a.mp4（')
    expect(foreignJobMessage()).toBe('已有一个去码任务在跑（可能来自另一个影盒窗口），请等它结束')
  })
  it('非零退出带上最后一条进度文字', () => {
    expect(exitError(1, '显存不足')).toBe('lada 退出（代码 1）：显存不足')
    expect(exitError(null, '')).toBe('lada 退出（代码 null）')
  })
})

describe('lada 进度', () => {
  it('\\r 与 \\n 都是分隔符，半行留到下一次', () => {
    expect(splitProgress('a\rb\nc')).toEqual({ lines: ['a', 'b'], rest: 'c' })
    expect(splitProgress('x')).toEqual({ lines: [], rest: 'x' })
  })
  it('只覆盖解析到的字段', () => {
    const job = { percent: 5, fps: 1, frames: 2, message: 'old' } as LadaJob
    applyProgress(job, { percent: 0, fps: undefined, message: '' })
    expect(job).toEqual({ percent: 0, fps: 1, frames: 2, message: 'old' })
    applyProgress(job, { frames: 9, message: 'new' })
    expect([job.frames, job.message]).toEqual([9, 'new'])
  })
})

describe('lada 临时目录归类', () => {
  it('归属记录优先于半成品判断', () => {
    expect(classifyTempEntry('a.tmp.mp4.owner.json')).toBe('sidecar')
    expect(classifyTempEntry('a.TMP.mp4')).toBe('partial')
    expect(classifyTempEntry('job.lock')).toBe('other')
    expect(sidecarVideo('a.tmp.mp4.owner.json')).toBe('a.tmp.mp4')
  })
})

describe('ffprobe 解析', () => {
  it('读正时长，读不到或为 0 返回 null', () => {
    expect(parseDuration('duration=12.5\n')).toBe(12.5)
    expect(parseDuration('duration=0')).toBeNull()
    expect(parseDuration('N/A')).toBeNull()
  })
  it('分片起点与时长都要有', () => {
    expect(parseSegmentProbe('start_time=1.4\nduration=10.0')).toEqual({ start: 1.4, duration: 10 })
    expect(parseSegmentProbe('duration=10')).toBeNull()
    expect(parseSegmentProbe('start_time=0\nduration=0')).toBeNull()
  })
  it('时长偏差超过 5% 才算异常', () => {
    expect(durationMismatch(100, 105)).toBe(false)
    expect(durationMismatch(100, 106)).toBe(true)
    expect(durationMismatch(null, 100)).toBe(false)
  })
})

describe('区间去码', () => {
  it('fmtClock 给人看的时长', () => {
    expect(fmtClock(65)).toBe('1m05s')
    expect(fmtClock(3723)).toBe('1h02m03s')
    expect(fmtClock(-3)).toBe('0m00s')
  })
  it('起点必须是非负数', () => {
    expect(rangeStart('12.5')).toBe(12.5)
    expect(() => rangeStart(-1)).toThrow('起点不合法')
    expect(() => rangeStart('x')).toThrow('起点不合法')
  })
  it('终点：<=0 到片尾、超出片长截断、片长未知用请求值', () => {
    expect(rangeStop(10, 0, 100)).toBe(100)
    expect(rangeStop(10, 200, 100)).toBe(100)
    expect(rangeStop(10, 50, 100)).toBe(50)
    expect(rangeStop(10, 50, null)).toBe(50)
  })
  it('起点落在片尾 1 秒内、终点不大于起点都报错', () => {
    expect(() => rangeStop(99, 0, 100)).toThrow('起点已经超出片长')
    expect(() => rangeStop(10, 5, 100)).toThrow('终点要大于起点')
    expect(() => rangeStop(10, 0, null)).toThrow('终点要大于起点')
  })
  it('产物名带区间', () => {
    expect(rangeOutputName(join('/v', 'abc.mkv'), 60, 125)).toBe('abc.1m00s-2m05s.restored.mp4')
  })
})

describe('续跑缓存', () => {
  it('分段按序号排序而不是字典序', () => {
    expect(sortParts(['part10.mp4', 'progress.json', 'part2.mp4', 'part0.mp4'])).toEqual(['part0.mp4', 'part2.mp4', 'part10.mp4'])
  })
  it('清缓存时保留分段与进度', () => {
    expect(isResumeProgressFile('part3.mp4')).toBe(true)
    expect(isResumeProgressFile('progress.json')).toBe(true)
    expect(isResumeProgressFile('joined.mp4')).toBe(false)
    expect(isResumeProgressFile('part3.mp4.ts')).toBe(false)
  })
})

describe('边跑边看', () => {
  it('分片名补零到 5 位', () => {
    expect(segmentName(7)).toBe('seg00007.ts')
  })
  it('HTTP 服务只放行安全文件名', () => {
    expect(isServableName('seg00001.ts')).toBe(true)
    expect(isServableName('../x')).toBe(false)
    expect(isServableName('a b')).toBe(false)
  })
  it('EVENT 播放列表：EXTINF 写实测时长，结束时加 ENDLIST', () => {
    const body = buildPlaylist([{ name: 'seg00000.ts', duration: 9.8765 }], false)
    expect(body).toBe('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:12\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:EVENT\n#EXTINF:9.877,\nseg00000.ts\n')
    expect(buildPlaylist([], true).endsWith('#EXT-X-ENDLIST\n')).toBe(true)
  })
  it('分片判定：够长就发布；lada 在跑时短片等下一轮；结束后短片当片尾，太短收尾', () => {
    expect(segmentVerdict(SEGMENT_SECONDS * 0.95, true)).toBe('publish')
    expect(segmentVerdict(SEGMENT_SECONDS * 0.9, true)).toBe('retry')
    expect(segmentVerdict(3, false)).toBe('publish')
    expect(segmentVerdict(0.4, false)).toBe('finish')
  })
})
