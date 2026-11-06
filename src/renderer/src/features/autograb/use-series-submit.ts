/** 追剧设置的最终确认、放弃草稿与取消。 */
import { type Ref, ref } from 'vue'
import { confirmDialog } from '@/components/ui'
import { toast } from '@/components/ui/toast'
import type {
  AutograbSeries,
  AutograbSeriesPatch,
} from '../../../../shared/contract/autograb'
import type { AutograbPanelState } from './use-autograb'
import { prefsOverrideOf } from '../../../../shared/contract/autograb-prefs'

interface SubmitContext {
  series(): AutograbSeries | null
  patch(): AutograbSeriesPatch
  ag: Pick<AutograbPanelState, 'setSeries' | 'startSeries' | 'reload'>
  prepare(): Promise<boolean>
  close(): void
}

/** 统一提交设置，阻止重复确认或取消。 */
export function useSeriesSubmit(ctx: SubmitContext): {
  saving: Ref<boolean>
  confirm(): Promise<void>
  close(): Promise<void>
  cancelTracking(): Promise<void>
} {
  const saving = ref(false)

  async function confirm(): Promise<void> {
    if (!ctx.series() || saving.value) return
    saving.value = true
    try {
      if (!(await ctx.prepare())) return
      const item = ctx.series()
      if (!item) return
      const draft = ctx.patch()
      // IPC 只接收普通数据，偏好解析同时复制其中的响应式词组数组。
      const patch = {
        ...draft,
        ...(draft.prefs ? { prefs: prefsOverrideOf(draft.prefs) } : {}),
      }
      if (!(await ctx.ag.setSeries(item.seriesId, patch))) return
      if (
        item.pending &&
        item.effectiveMode !== 'off' &&
        !(await ctx.ag.startSeries(item.seriesId))
      )
        return
      await ctx.ag.reload()
      ctx.close()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      saving.value = false
    }
  }

  async function close(): Promise<void> {
    if (saving.value) return
    const item = ctx.series()
    saving.value = true
    try {
      if (item?.pending) {
        if (!(await ctx.ag.setSeries(item.seriesId, { mode: 'off' }))) return
        await ctx.ag.reload()
      }
      ctx.close()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      saving.value = false
    }
  }

  async function cancelTracking(): Promise<void> {
    const item = ctx.series()
    if (!item || saving.value) return
    if (item.pending) return close()
    saving.value = true
    try {
      if (
        !(await confirmDialog({
          title: `取消追「${item.title}」？`,
          content: '移除追剧任务及追更记录，已转存的 115 网盘文件保留。',
          okText: '取消追剧',
        }))
      )
        return
      if (await ctx.ag.setSeries(item.seriesId, { mode: 'off' })) {
        await ctx.ag.reload()
        ctx.close()
      }
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      saving.value = false
    }
  }

  return { saving, confirm, close, cancelTracking }
}
