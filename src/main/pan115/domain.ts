/**
 * pan115 域的处理函数：契约方法一一转给网盘服务。桌面端（index.ts）与独立服务（src/server/netdisk）共用。
 */
import { pan115 } from '../../shared/contract/pan115'
import type { ModuleHost } from '../module-host'
import type { Pan115Service } from './service'

/** 登记 pan115 域 */
export function implementPan115(
  host: Pick<ModuleHost, 'implement'>,
  service: Pan115Service
): void {
  host.implement(pan115, {
    search: (_, keyword) => service.search(keyword),
    account: () => service.account(),
    loginStart: () => service.loginStart(),
    loginPoll: () => service.loginPoll(),
    logout: () => service.logout(),
    snap: (_, url, password) => service.snap(url, password),
    receive: (_, url, password) => service.receive(url, password),
    dirs: (_, cid) => service.dirs(cid),
  })
}
