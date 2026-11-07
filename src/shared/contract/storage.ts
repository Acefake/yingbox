import { call, defineDomain, optStr, record, str } from './define'

/** 系统已认证或挂载的 SMB 共享；凭据由操作系统管理。 */
export interface StorageMount {
  id: string
  name: string
  path: string
}

/** 新建或编辑共享连接；不传 id 时添加或更新同路径记录。 */
export interface StorageMountInput {
  id?: string
  name: string
  path: string
}

/** 桌面端共享存储管理，只验证和记录目录，不修改共享中的文件。 */
export const storage = defineDomain('storage', {
  list: call<StorageMount[]>(),
  save: call<[input: StorageMountInput], StorageMount>(args => {
    const input = record<Record<string, unknown>>(args[0], 'input')
    return [
      {
        id: optStr(input.id, 'id'),
        name: str(input.name, 'name'),
        path: str(input.path, 'path'),
      },
    ]
  }),
  remove: call<[id: string], void>(args => [str(args[0], 'id')]),
  /** 检查已保存的共享是否仍是可读目录；失败时抛出具体原因。 */
  check: call<[id: string], void>(args => [str(args[0], 'id')]),
})
