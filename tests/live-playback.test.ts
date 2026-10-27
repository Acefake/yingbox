/**
 * 直播播放链路的纯规则：流格式判定（shared/iptv/stream-kind.ts）、线路播放方案与失败文案（live/utils/line-plan.ts）、
 * 播放器错误原因（player/utils/play-errors.ts）。
 */
import { describe, expect, it } from 'vitest'

import {
  detectStreamKind,
  httpStatusText,
  isExternalOnlyUrl,
  isMulticastRelayUrl,
  kindFromContentType,
  kindFromUrl,
  playbackFor,
  sniffBytes,
} from '../src/shared/iptv/stream-kind'
import {
  failureSummary,
  isIpv6Url,
  netErrorText,
  planLine,
  probeFailureText,
} from '../src/renderer/src/features/live/utils/line-plan'
import {
  CODEC_UNSUPPORTED,
  FORMAT_UNSUPPORTED,
  hlsErrorReason,
  videoErrorReason,
} from '../src/renderer/src/features/player/utils/play-errors'
import { STREAM_SCHEME } from '../src/shared/stream-url'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
const tsPackets = (count: number): Uint8Array =>
  Uint8Array.from({ length: 188 * count }, (_, i) => (i % 188 === 0 ? 0x47 : 1))

describe('直播流格式判定', () => {
  it('按开头字节认 HLS（含 BOM 与前导空白）、FLV、TS、MP4、WebM、网页', () => {
    expect(sniffBytes(bytes('#EXTM3U\n#EXT-X-VERSION:3'))).toBe('hls')
    expect(sniffBytes(bytes('\uFEFF  \n#extm3u\n'))).toBe('hls')
    expect(sniffBytes(Uint8Array.from([0x46, 0x4c, 0x56, 1, 5]))).toBe('flv')
    expect(sniffBytes(tsPackets(2))).toBe('mpegts')
    expect(
      sniffBytes(Uint8Array.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]))
    ).toBe('mp4')
    expect(sniffBytes(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]))).toBe('webm')
    expect(sniffBytes(bytes('<!DOCTYPE html><html>'))).toBe('html')
    expect(sniffBytes(bytes('{"code":403}'))).toBe('html')
    expect(sniffBytes(new Uint8Array(0))).toBeNull()
  })

  it('0x47 开头但第二个包不对齐的不当作 TS', () => {
    const fake = tsPackets(2)
    fake[188] = 0
    expect(sniffBytes(fake)).toBeNull()
  })

  it('字节优先于 Content-Type（服务器常把 m3u8 回成 text/plain、FLV 回成 octet-stream）', () => {
    expect(
      detectStreamKind({
        head: bytes('#EXTM3U'),
        contentType: 'text/plain',
        url: 'http://a/live',
      })
    ).toBe('hls')
    expect(
      detectStreamKind({
        head: Uint8Array.from([0x46, 0x4c, 0x56]),
        contentType: 'application/octet-stream',
        url: 'http://a/live.m3u8',
      })
    ).toBe('flv')
  })

  it('字节认不出时看 Content-Type，再看扩展名，都没有就是 unknown', () => {
    expect(kindFromContentType('application/vnd.apple.mpegurl')).toBe('hls')
    expect(kindFromContentType('application/x-mpegURL; charset=utf-8')).toBe(
      'hls'
    )
    expect(kindFromContentType('video/x-flv')).toBe('flv')
    expect(kindFromContentType('video/MP2T')).toBe('mpegts')
    expect(kindFromUrl('http://a/b/index.m3u8?x=1')).toBe('hls')
    expect(kindFromUrl('http://a/live/stream.flv?k=1')).toBe('flv')
    expect(kindFromUrl('http://192.168.1.1:4022/rtp/239.3.1.241:8000')).toBe(
      'mpegts'
    )
    expect(
      detectStreamKind({
        head: bytes('\x00\x01garbage'),
        contentType: '',
        url: 'http://a/api?id=1',
      })
    ).toBe('unknown')
  })

  it('外部协议与组播网关', () => {
    for (const url of [
      'rtmp://a/live/1',
      'RTSP://a/1',
      'rtp://239.3.1.1:8000',
      'udp://@239.0.0.1:1234',
    ])
      expect(isExternalOnlyUrl(url)).toBe(true)
    expect(isExternalOnlyUrl('http://a/rtp/239.0.0.1:1234')).toBe(false)
    expect(isMulticastRelayUrl('http://a:4022/udp/239.0.0.1:1234')).toBe(true)
    expect(isMulticastRelayUrl('http://a/live/index.m3u8')).toBe(false)
  })

  it('播法：HLS 用 hls.js、MP4 用 <video>、FLV / TS / DASH 交给外部、网页判失败、未知按 HLS 试', () => {
    expect(playbackFor('hls')).toBe('hls')
    expect(playbackFor('mp4')).toBe('video')
    expect(playbackFor('flv')).toBe('external')
    expect(playbackFor('mpegts')).toBe('external')
    expect(playbackFor('dash')).toBe('external')
    expect(playbackFor('html')).toBe('none')
    expect(playbackFor('unknown')).toBe('hls')
  })

  it('HTTP 状态码文案', () => {
    expect(httpStatusText(504)).toBe('连接超时')
    expect(httpStatusText(404)).toBe('线路已失效（HTTP 404）')
    expect(httpStatusText(403)).toContain('HTTP 403')
    expect(httpStatusText(502)).toBe('服务器出错（HTTP 502）')
  })
})

describe('线路播放方案', () => {
  const hlsUrl = 'http://gmxw.7766.org:808/hls/93/index.m3u8'

  it('HLS 用原地址交给 hls.js（加载器自己走代理）', () => {
    expect(planLine(hlsUrl, { ok: true, kind: 'hls' })).toMatchObject({
      mode: 'hls',
      src: hlsUrl,
    })
  })

  it('认不出格式的接口地址按 HLS 试', () => {
    expect(
      planLine('http://a/live?id=1', { ok: true, kind: 'unknown' }).mode
    ).toBe('hls')
  })

  it('MP4 经 yingbox-stream 代理交给 <video>（没有 CORS 头、http 也能播）', () => {
    const plan = planLine('http://a/v.mp4', { ok: true, kind: 'mp4' })
    expect(plan.mode).toBe('video')
    expect(plan.src.startsWith(`${STREAM_SCHEME}://fetch/?src=`)).toBe(true)
    expect(decodeURIComponent(plan.src)).toContain('http://a/v.mp4')
  })

  it('FLV / TS / 组播协议判为内置播放器不支持，原因带格式名', () => {
    expect(
      planLine('https://live.metshop.top/huya/1', { ok: true, kind: 'flv' })
    ).toMatchObject({
      mode: 'external',
      reason: 'FLV 直播流，内置播放器不支持',
    })
    expect(
      planLine('http://r:4022/rtp/239.0.0.1:1', { ok: true, kind: 'mpegts' })
        .reason
    ).toBe('MPEG-TS 直播流，内置播放器不支持')
    expect(planLine('rtmp://a/live', null).mode).toBe('external')
  })

  it('探测失败与网页都判失败，并写明原因', () => {
    expect(
      planLine(hlsUrl, { ok: false, failure: 'http', status: 404 })
    ).toMatchObject({ mode: 'fail', reason: '线路已失效（HTTP 404）' })
    expect(planLine(hlsUrl, { ok: true, kind: 'html' }).reason).toContain(
      '网页'
    )
  })

  it('没有探测能力时按扩展名猜', () => {
    expect(planLine(hlsUrl, null).mode).toBe('hls')
    expect(planLine('https://a/v.mp4', null)).toMatchObject({
      mode: 'video',
      src: 'https://a/v.mp4',
    })
  })

  it('IPv6 线路连不上时提示需要 IPv6 网络；HTTP 错误不加', () => {
    const v6 = 'http://[2409:8087:8:21::18]:6610/a/1.m3u8?'
    expect(isIpv6Url(v6)).toBe(true)
    expect(isIpv6Url(hlsUrl)).toBe(false)
    expect(
      probeFailureText(v6, {
        ok: false,
        failure: 'network',
        error: 'net::ERR_ADDRESS_UNREACHABLE',
      })
    ).toBe('网络不可达（IPv6 线路，需要本机有 IPv6 网络）')
    expect(probeFailureText(v6, { ok: false, failure: 'timeout' })).toBe(
      '连接超时（IPv6 线路，需要本机有 IPv6 网络）'
    )
    expect(
      probeFailureText(v6, { ok: false, failure: 'http', status: 403 })
    ).not.toContain('IPv6')
  })

  it('网络错误码与内网拦截的文案', () => {
    expect(netErrorText('net::ERR_NAME_NOT_RESOLVED')).toBe('域名解析失败')
    expect(netErrorText('无法解析主机：a.b')).toBe('域名解析失败')
    expect(netErrorText('net::ERR_CONNECTION_REFUSED')).toBe('连接被拒绝')
    expect(netErrorText('net::ERR_CERT_DATE_INVALID')).toBe('HTTPS 证书无效')
    expect(netErrorText('boom')).toBe('网络错误（boom）')
    expect(
      probeFailureText('http://192.168.1.2/a.m3u8', {
        ok: false,
        failure: 'blocked',
      })
    ).toBe('内网地址不能在内置播放器打开')
  })

  it('全部失败的汇总：逐条列原因，超过 4 条只列前 4 条', () => {
    expect(failureSummary([])).toContain('稍后重试')
    expect(failureSummary(['连接超时', undefined, 'FLV 直播流'])).toBe(
      '线路 1：连接超时；线路 3：FLV 直播流'
    )
    expect(failureSummary(Array(6).fill('x'))).toBe(
      '线路 1：x；线路 2：x；线路 3：x；线路 4：x；等 6 条'
    )
  })
})

describe('播放器错误原因', () => {
  it('hls.js：超时、HTTP 状态码、无响应、清单无效、编码不支持', () => {
    expect(hlsErrorReason({ details: 'manifestLoadTimeOut' })).toBe('连接超时')
    expect(
      hlsErrorReason({ details: 'manifestLoadError', response: { code: 404 } })
    ).toBe('线路已失效（HTTP 404）')
    expect(
      hlsErrorReason({ details: 'fragLoadError', response: { code: 504 } })
    ).toBe('连接超时')
    expect(
      hlsErrorReason({ details: 'levelLoadError', response: { code: 0 } })
    ).toBe('网络错误，连不上服务器')
    expect(hlsErrorReason({ details: 'manifestParsingError' })).toBe(
      '返回的不是有效的 HLS 清单'
    )
    expect(hlsErrorReason({ details: 'bufferAddCodecError' })).toBe(
      CODEC_UNSUPPORTED
    )
    expect(hlsErrorReason({ details: 'internalException' })).toBe(
      '播放出错（internalException）'
    )
    expect(hlsErrorReason({})).toBe('播放出错')
  })

  it('<video> MediaError', () => {
    expect(videoErrorReason(2)).toBe('网络错误，连不上服务器')
    expect(videoErrorReason(3)).toBe(CODEC_UNSUPPORTED)
    expect(videoErrorReason(4)).toBe(FORMAT_UNSUPPORTED)
    expect(videoErrorReason(undefined)).toBe('播放出错')
  })
})
