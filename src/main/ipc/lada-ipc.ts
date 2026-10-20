import {
  adoptPartial,
  cacheSize,
  cancelCurrentJob,
  clearCache,
  initLada,
  initLadaLive,
  initLadaResume,
  ladaPaths,
  liveStatus,
  otherInstanceJob,
  playablePath,
  resume,
  resumeInfo,
  setPathOverrides,
  snapshot,
  startLive,
  startRange,
  startTask,
  stopLive,
} from '../plugins/lada'
import { implement } from '../rpc'
import { lada } from '../../shared/contract/lada'

/**
 * 初始化去码三个子模块（整片 / 边跑边看 / 续跑与区间）并实现 lada 域。
 * 顺序有依赖：续跑认领半成品要用到整片模块加载好的路径覆盖。
 */
export async function registerLadaIpc(): Promise<void> {
  await initLada()
  initLadaLive()
  initLadaResume()

  implement(lada, {
    paths: () => ladaPaths(),
    setPaths: (_, changes) => setPathOverrides(changes),
    start: (_, filePath) => startTask(filePath),
    cancel: () => {
      cancelCurrentJob()
      return { success: true }
    },
    status: () => snapshot(),
    otherJob: () => otherInstanceJob(),
    playablePath: (_, filePath) => playablePath(filePath),
    startLive: (_, filePath) => startLive(filePath),
    stopLive: () => {
      stopLive()
      return { success: true }
    },
    liveStatus: () => liveStatus(),
    resumeInfo: (_, filePath) => resumeInfo(filePath),
    resume: (_, filePath) => resume(filePath),
    adoptPartial: (_, filePath, partialPath) =>
      adoptPartial(filePath, partialPath),
    clearCache: () => clearCache(),
    cacheSize: () => cacheSize(),
    startRange: (_, filePath, start, end) => startRange(filePath, start, end),
  })
}
