/**
 * 主进程内调媒体库的接口（与宿主无关）：桌面端是引擎进程的调用口（host.ts），独立服务是同进程的 LibraryService。
 */
import type { LibraryMethod, LibraryRpcMap } from '../../shared/library/ipc'

/** 主进程内直接调引擎（如下发 TMDB 令牌）；引擎报错时抛出。 */
export interface LibraryEngineClient {
  call<M extends LibraryMethod>(
    method: M,
    params: LibraryRpcMap[M]['params']
  ): Promise<LibraryRpcMap[M]['result']>
}
