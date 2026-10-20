/**
 * 去码（lada）插件的公共出口。
 *
 * 职责拆分：rules（纯规则）/ tools（工具定位）/ temp（临时目录与清扫）/ lock（机器级锁）/
 * job（整片任务）/ cache + resume（暂停续跑）/ range（区间去码）/ live + live-media（边跑边看）。
 */
import { registerPlugin } from '../host'
import { jobHealth, stopForQuit } from './job'
import { sweepOrphans } from './temp'
import { loadOverrides } from './tools'

export { cacheSize, clearCache } from './cache'
export { cancelCurrentJob, playablePath, snapshot, startTask } from './job'
export { initLadaLive, liveStatus, startLive, stopLive } from './live'
export { startRange } from './range'
export { adoptPartial, initLadaResume, resume, resumeInfo } from './resume'
export { otherInstanceJob } from './temp'
export { ladaPaths, setPathOverrides } from './tools'

/** 启动时加载路径覆盖、清扫上次遗留的临时文件，并登记为插件（退出时取消任务并等进程退出）。 */
export async function initLada(): Promise<void> {
  await loadOverrides()
  sweepOrphans()
  registerPlugin({ id: 'lada', stop: stopForQuit, health: jobHealth })
}
