import { call, defineDomain, optStr, str, strs } from './define'

/** 路径运算：由主进程的 node:path 计算，保证与文件系统所在平台一致。 */
export const path = defineDomain('path', {
  /** path.join */
  join: call<string[], string>(a => strs(a, 'paths')),
  /** path.resolve */
  resolve: call<string[], string>(a => strs(a, 'paths')),
  /** path.dirname */
  dirname: call<[filePath: string], string>(a => [str(a[0], 'filePath')]),
  /** path.basename */
  basename: call<[filePath: string, ext?: string], string>(a => [
    str(a[0], 'filePath'),
    optStr(a[1], 'ext'),
  ]),
  /** path.extname */
  extname: call<[filePath: string], string>(a => [str(a[0], 'filePath')]),
})
