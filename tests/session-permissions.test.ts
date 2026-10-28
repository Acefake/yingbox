import type { Session, WebContents } from 'electron'
import { expect, it, vi } from 'vitest'
import {
  installPermissionPolicy,
  trustAppPermissions,
} from '../src/main/permissions'

it('拒绝外部窗口、子框架和非必要权限，保留应用的麦克风、全屏与复制', () => {
  const check = vi.fn()
  const request = vi.fn()
  installPermissionPolicy({
    setPermissionCheckHandler: check,
    setPermissionRequestHandler: request,
  } as unknown as Session)
  const app = {} as WebContents
  const remote = {} as WebContents
  trustAppPermissions(app)
  const checkPermission = check.mock.calls[0][0]
  const requestPermission = request.mock.calls[0][0]
  for (const contents of [app, remote]) {
    for (const isMainFrame of [true, false]) {
      for (const permission of [
        'media',
        'fullscreen',
        'clipboard-sanitized-write',
        'geolocation',
        'notifications',
      ]) {
        const expected =
          contents === app &&
          isMainFrame &&
          ['media', 'fullscreen', 'clipboard-sanitized-write'].includes(
            permission
          )
        expect(
          checkPermission(contents, permission, 'https://example.com', {
            isMainFrame,
            mediaType: 'audio',
          })
        ).toBe(expected)
        const callback = vi.fn()
        requestPermission(contents, permission, callback, {
          isMainFrame,
          mediaTypes: ['audio'],
        })
        expect(callback).toHaveBeenCalledWith(expected)
      }
    }
  }
  expect(
    checkPermission(app, 'media', '', { isMainFrame: true, mediaType: 'video' })
  ).toBe(false)
  const callback = vi.fn()
  requestPermission(app, 'media', callback, {
    isMainFrame: true,
    mediaTypes: ['audio', 'video'],
  })
  expect(callback).toHaveBeenCalledWith(false)
})
