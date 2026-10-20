/**
 * opencc-js 的子路径类型声明：包本身只给根入口写了 types，node10 解析找不到子路径。
 */
declare module 'opencc-js/t2cn' {
  /** 创建一个繁 → 简转换函数。 */
  export function Converter(options: {
    from: 't' | 'tw' | 'twp' | 'hk'
    to: 'cn'
  }): (text: string) => string
}
