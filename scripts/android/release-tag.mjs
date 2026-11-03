import { execFileSync } from 'node:child_process'

/** 创建不可变发布标签；本地和远端已有标签均必须解引用到指定提交。 */
export function ensureRemoteTag(cwd, tag, head) {
  const git = args =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  const ref = `refs/tags/${tag}`
  const remoteCommit = () => {
    const refs = git(['ls-remote', '--tags', 'origin', ref, `${ref}^{}`])
      .split('\n')
      .filter(Boolean)
      .map(line => line.split(/\s+/))
    return (
      refs.find(([, name]) => name === `${ref}^{}`)?.[0] ||
      refs.find(([, name]) => name === ref)?.[0]
    )
  }
  const remote = remoteCommit()
  if (remote && remote !== head)
    throw new Error(`远端标签 ${tag} 指向其他提交，不能覆盖`)
  const local = git(['tag', '--list', tag])
  if (local && git(['rev-parse', `${ref}^{commit}`]) !== head)
    throw new Error(`本地标签 ${tag} 指向其他提交，不能覆盖`)
  if (!remote) {
    if (!local) git(['tag', tag, head])
    git(['push', 'origin', `${ref}:${ref}`])
  }
  if (remoteCommit() !== head) throw new Error(`远端标签 ${tag} 核对失败`)
}
