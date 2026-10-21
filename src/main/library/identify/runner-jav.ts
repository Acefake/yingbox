/**
 * 番号库的识别：番号在扫描时已从文件名解析出来（files.parsed.code），这里直接按番号查番号站点，
 * 不走片名搜索与打分。查到就是匹配（番号唯一），查不到记为未匹配。
 *
 * 手动匹配时用户输入的“片名”当作番号：先按番号规则归一（ssis00497 → SSIS-497），认不出就原样查。
 */
import { LibraryError } from '../../../shared/library/ipc'
import type { ApplyMatchRequest } from '../../../shared/library/ipc'
import type { MediaRef } from '../../../shared/library/provider'
import { ItemChanges } from '../catalog/catalog-store'
import { transaction } from '../db/database'
import { codeOf } from '../providers/jav/jav-provider'
import type { IdentifyTarget } from './identify-store'
import type { ManualMatchResult } from './runner-manual'
import type { Outcome, RunnerContext } from './runner-types'

/** 番号 → 元数据源引用。 */
export const javRef = (code: string): MediaRef => ({
  provider: 'jav',
  kind: 'movie',
  id: code,
})

/** 条目文件里解析出的番号（同一条目的文件番号相同，取第一个）。 */
export function targetCode(
  ctx: RunnerContext,
  target: IdentifyTarget
): string | undefined {
  for (const file of ctx.deps.store.files(target.id)) {
    const parsed = file.parsed
    if (parsed?.type === 'movie' && parsed.code) return parsed.code
  }
  return undefined
}

/** 按番号应用匹配；站点都查不到时返回 false（applyRef 抛 not-found）。 */
async function applyCode(
  ctx: RunnerContext,
  target: IdentifyTarget,
  code: string,
  state: 'auto' | 'locked',
  changes: ItemChanges,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    await ctx.applyRef(target, javRef(code), state, undefined, changes, signal)
    return true
  } catch (error) {
    if (error instanceof LibraryError && error.code === 'not-found')
      return false
    throw error
  }
}

/** 识别一个番号库条目。 */
export async function identifyJav(
  ctx: RunnerContext,
  target: IdentifyTarget,
  changes: ItemChanges,
  signal?: AbortSignal
): Promise<Outcome> {
  const code = targetCode(ctx, target)
  if (!code || !ctx.deps.jav) return ctx.writeUndecided(target, [], changes)
  return (await applyCode(ctx, target, code, 'auto', changes, signal))
    ? 'matched'
    : ctx.writeUndecided(target, [], changes)
}

/** 番号库的手动匹配：只接受“搜索词”，当作番号查。 */
export async function applyManualJav(
  ctx: RunnerContext,
  target: IdentifyTarget,
  request: ApplyMatchRequest,
  signal?: AbortSignal
): Promise<ManualMatchResult> {
  if (!request.query) {
    throw new LibraryError('invalid-params', '番号库请直接输入番号')
  }
  const changes = new ItemChanges()
  const code = codeOf(request.query.title).code
  const state = request.lock === false ? 'auto' : 'locked'
  const ok = await applyCode(
    ctx,
    { ...target, matchState: 'unmatched' },
    code,
    state,
    changes,
    signal
  )
  if (!ok) return { status: 'unmatched', candidates: [], changes }
  if (state === 'auto') {
    transaction(ctx.deps.db, () =>
      ctx.deps.store.setMatchState(target.id, 'auto', ctx.now())
    )
  }
  return { status: 'matched', candidates: [], changes }
}
