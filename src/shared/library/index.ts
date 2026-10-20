/**
 * 媒体库核心（纯 TS，主进程与渲染进程都可用）：文件名解析、元数据源接口、打分、识别链、引擎 IPC 契约。
 */
export * from './identify'
export * from './parser'
export * from './provider'
export * from './scoring'
export * from './ipc'
