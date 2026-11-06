/** 将更新窗口放到安装目录外，避免占用待替换的程序文件。 */
import { app } from 'electron'
import { spawn } from 'node:child_process'
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { BrandColor } from '../../shared/brand'

async function copyTree(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    if (entry.isDirectory()) await copyTree(from, to)
    else await writeFile(to, await readFile(from))
  }
}

/** 清理已退出的历史更新窗口运行时；未知状态和仍存活的进程均保留。 */
export async function pruneUpdateCompanions(
  base: string,
  current: string
): Promise<void> {
  const directory = resolve(base)
  await mkdir(directory, { recursive: true })
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      entry.name === current ||
      !/^\d+\.\d+\.\d+$/.test(entry.name)
    )
      continue
    const target = resolve(directory, entry.name)
    if (dirname(target) !== directory) continue
    try {
      const pid = Number(
        await readFile(join(target, 'resources', 'app', 'helper.pid'), 'utf8')
      )
      if (!Number.isSafeInteger(pid) || pid <= 0) continue
      try {
        process.kill(pid, 0)
        continue
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !('code' in error) ||
          error.code !== 'ESRCH'
        )
          continue
      }
      await rm(target, { recursive: true, force: true })
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      )
        console.warn('[Updater] 无法清理历史运行时', error)
    }
  }
}

async function prepare(root: string): Promise<string> {
  const executable = join(root, 'yingbox-update-ui.exe')
  const marker = join(root, 'prepared')
  try {
    await access(marker)
    return executable
  } catch {
    /* 首次更新准备独立运行时。 */
  }
  await mkdir(root, { recursive: true })
  const installed = dirname(process.execPath)
  for (const entry of await readdir(installed, { withFileTypes: true })) {
    if (entry.isFile() && /\.(dll|pak|dat|bin)$/i.test(entry.name))
      await copyFile(join(installed, entry.name), join(root, entry.name))
  }
  await copyFile(process.execPath, executable)
  await copyTree(join(installed, 'locales'), join(root, 'locales'))
  const helper = join(root, 'resources', 'app')
  await copyTree(join(process.resourcesPath, 'update-companion'), helper)
  await copyTree(
    join(app.getAppPath(), 'out', 'renderer'),
    join(helper, 'renderer')
  )
  await writeFile(
    join(helper, 'package.json'),
    JSON.stringify({ name: 'yingbox-update-companion', main: 'main.cjs' })
  )
  await writeFile(marker, 'ready')
  return executable
}

/** 独立窗口完成首屏后才允许旧进程退出；准备失败向调用方报错。 */
export async function launchUpdateCompanion(
  installer: string,
  args: string[],
  color: BrandColor
): Promise<void> {
  await pruneUpdateCompanions(
    join(app.getPath('userData'), 'update-companion'),
    app.getVersion()
  )
  const root = join(
    app.getPath('userData'),
    'update-companion',
    app.getVersion()
  )
  const executable = await prepare(root)
  const helper = join(root, 'resources', 'app')
  const ready = join(helper, 'ready')
  await rm(ready, { force: true })
  await writeFile(
    join(helper, 'config.json'),
    JSON.stringify({ installer, args, color, parentPid: process.pid })
  )
  const child = spawn(executable, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  })
  let failure: Error | undefined
  child.once('error', error => {
    failure = error
  })
  child.once('exit', code => {
    failure ??= new Error(`更新窗口退出：${code}`)
  })
  for (let attempt = 0; attempt < 300; attempt++) {
    if (failure) throw failure
    try {
      await access(ready)
      child.unref()
      return
    } catch {
      await delay(100)
    }
  }
  child.kill()
  throw new Error('更新窗口启动超时，请重试')
}
