import { call, defineDomain, optStr, record, str } from './define'

/** 一个 WebDAV / Alist 源（给渲染层的视图：没有密码，只说有没有）。 */
export interface WebDavSourceInfo {
  /** 源 id（小写字母数字），出现在远程媒体库路径 yingbox-dav://<id>/… 里 */
  id: string
  name: string
  /** 源地址，如 http://192.168.1.5:5244/dav */
  url: string
  username: string
  /** 是否保存了密码 */
  hasPassword: boolean
}

/** 新建 / 修改源；id 缺省为新建；password 缺省（或空串且已有 id）时保留原密码。 */
export interface WebDavSourceInput {
  id?: string
  name: string
  url: string
  username: string
  password?: string
}

/** 测试连接 / 列目录的结果。 */
export interface WebDavProbe {
  ok: boolean
  /** 给人看的结果（成功时如「连接成功，根目录下 12 项」） */
  message: string
  /** 列出的子目录名（按名字排序）；失败时为空 */
  dirs: string[]
}

/**
 * WebDAV / Alist 媒体库源（主进程 src/main/webdav）。源的地址、用户名存在主进程，
 * 密码经 safeStorage 加密落盘，渲染层只写不读；远程文件经主进程的 yingbox-dav 协议播放。
 */
export const webdav = defineDomain('webdav', {
  /** 全部源 */
  list: call<WebDavSourceInfo[]>(),
  /** 新建或修改源，返回保存后的视图 */
  save: call<[input: WebDavSourceInput], WebDavSourceInfo>(a => {
    const input = record<Record<string, unknown>>(a[0], 'input')
    return [
      {
        id: optStr(input.id, 'input.id'),
        name: str(input.name, 'input.name'),
        url: str(input.url, 'input.url'),
        username: str(input.username, 'input.username'),
        password: optStr(input.password, 'input.password'),
      },
    ]
  }),
  /** 删除源（使用它的媒体库要先从媒体库里移除） */
  remove: call<[id: string], void>(a => [str(a[0], 'id')]),
  /** 用表单里的值测试连接（有 id 且没填密码时用已保存的密码），并列出根目录下的文件夹 */
  test: call<[input: WebDavSourceInput], WebDavProbe>(a => {
    const input = record<Record<string, unknown>>(a[0], 'input')
    return [
      {
        id: optStr(input.id, 'input.id'),
        name: optStr(input.name, 'input.name') ?? '',
        url: str(input.url, 'input.url'),
        username: optStr(input.username, 'input.username') ?? '',
        password: optStr(input.password, 'input.password'),
      },
    ]
  }),
  /** 列一个已保存源里某个目录下的文件夹（选媒体库文件夹用） */
  listDirs: call<[id: string, path: string], WebDavProbe>(a => [
    str(a[0], 'id'),
    str(a[1], 'path'),
  ]),
})
