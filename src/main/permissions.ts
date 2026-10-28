/** 仅应用主框架可使用产品需要的权限；外部页面与子框架默认拒绝。 */
import type { Session, WebContents } from 'electron'

const appContents = new WeakSet<WebContents>()

/** 登记装有应用导航限制的窗口。 */
export function trustAppPermissions(contents: WebContents): void {
  appContents.add(contents)
}

/** 同时安装权限检查与请求处理，避免 Electron 默认放行。 */
export function installPermissionPolicy(target: Session): void {
  const trusted = (contents: WebContents | null, mainFrame: boolean): boolean =>
    !!contents && appContents.has(contents) && mainFrame
  const allowed = (permission: string): boolean =>
    permission === 'fullscreen' || permission === 'clipboard-sanitized-write'
  target.setPermissionCheckHandler(
    (contents, permission, _origin, details) =>
      trusted(contents, details.isMainFrame) &&
      (allowed(permission) ||
        (permission === 'media' && details.mediaType === 'audio'))
  )
  target.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      const audioOnly =
        'mediaTypes' in details &&
        details.mediaTypes?.length === 1 &&
        details.mediaTypes[0] === 'audio'
      callback(
        trusted(contents, details.isMainFrame) &&
          (allowed(permission) || (permission === 'media' && audioOnly))
      )
    }
  )
}
