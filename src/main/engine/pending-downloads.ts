/**
 * 启动时续下：引擎按需启动，上次没下完的任务若不主动拉起引擎，要等用户打开下载页才继续。
 * 主进程只读一眼队列文件（不解析下载细节），有未完成任务就调用一次 download.list 唤醒引擎，
 * 引擎加载队列后自动从断点续传。
 */
import { readFile } from 'node:fs/promises'

/** 队列文件里是否有等待中 / 进行中的任务；文件不存在或损坏视为没有。 */
export async function hasPendingDownloads(stateFile: string): Promise<boolean> {
  try {
    const raw = JSON.parse(await readFile(stateFile, 'utf-8')) as {
      tasks?: Array<{ status?: string }>
    }
    return (raw.tasks ?? []).some(
      t => t.status === 'queued' || t.status === 'active'
    )
  } catch {
    return false
  }
}

/** 有未完成任务时唤醒引擎；唤醒失败只记日志（下次调用仍会拉起）。 */
export async function resumePendingDownloads(
  stateFile: string,
  wake: () => Promise<unknown>
): Promise<boolean> {
  if (!(await hasPendingDownloads(stateFile))) return false
  await wake().catch(error => console.error('[download] 唤醒引擎失败', error))
  return true
}
