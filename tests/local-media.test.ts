import { describe, expect, it } from 'vitest'
import { localUrlToFilePath, parseRange } from '../src/main/local-media'

describe('parseRange', () => {
  it('parses explicit byte ranges', () => {
    expect(parseRange('bytes=0-499', 1000)).toEqual({ start: 0, end: 499 })
  })

  it('parses open-ended ranges', () => {
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 })
  })

  it('parses suffix ranges', () => {
    expect(parseRange('bytes=-500', 1000)).toEqual({ start: 500, end: 999 })
  })

  it('clamps the end to size - 1', () => {
    expect(parseRange('bytes=0-5000', 1000)).toEqual({ start: 0, end: 999 })
  })

  it('rejects malformed or unsatisfiable ranges', () => {
    expect(parseRange('items=0-1', 1000)).toBeNull()
    expect(parseRange('bytes=-', 1000)).toBeNull()
    expect(parseRange('bytes=1000-', 1000)).toBeNull()
    expect(parseRange('bytes=0-1', 0)).toBeNull()
    expect(parseRange('bytes=500-100', 1000)).toBeNull()
  })
})

describe('localUrlToFilePath', () => {
  it('maps a windows drive host back to a path', () => {
    expect(localUrlToFilePath('local://f/Movies/a.mp4')).toBe('F:/Movies/a.mp4')
  })

  it('decodes percent-encoded path segments', () => {
    expect(localUrlToFilePath('local://f/Movies/%E4%BD%A0%E5%A5%BD.mp4')).toBe(
      'F:/Movies/你好.mp4'
    )
  })

  it('maps a posix absolute path', () => {
    expect(localUrlToFilePath('local:///home/u/a.mp4')).toBe('/home/u/a.mp4')
  })

  it('rejects non-drive hosts and invalid URLs', () => {
    expect(localUrlToFilePath('local://evil.example/a.mp4')).toBeNull()
    expect(localUrlToFilePath('not a url')).toBeNull()
  })
})
