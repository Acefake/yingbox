/** 一部剧的合集阶段与阻塞原因，供追剧侧板展示。 */
import type {
  AutograbOverview,
  AutograbSeries,
} from '../../../../shared/contract/autograb'
import { prerequisites } from './autograb-rules'

interface SeriesProgress {
  title: string
  description: string
  busy: boolean
}

/** 只根据服务端实际阶段显示忙碌状态；未提供阶段的服务保留策略说明。 */
export function seriesProgress(
  data: AutograbOverview,
  series: AutograbSeries
): SeriesProgress {
  const idle = (title: string, description: string): SeriesProgress => ({
    title,
    description,
    busy: false,
  })
  if (series.pending)
    return idle(
      '确认后开始追剧',
      '设置目录、追更方式和资源偏好后，点「确认并开始追剧」，先找合集，再补缺集。'
    )
  if (!data.enabled)
    return idle('自动追更已关闭', '开启自动追更后，先找合集，再补缺集。')
  if (data.error) return idle('获取分集失败', data.error)
  const blocked = prerequisites(data)[0]
  if (blocked) return idle('等待继续追剧', blocked.text)
  const pack = data.packSearch?.find(item => item.seriesId === series.seriesId)
  if (pack?.status === 'searching')
    return {
      title: '正在查找合集',
      description: `正在为 ${pack.total} 个已播缺集匹配合集资源，只转存缺少的集。`,
      busy: true,
    }
  if (pack?.status === 'failed')
    return idle(
      '上次合集搜索未完成',
      '各集的实际处理结果见分集明细；系统会按缺集情况继续搜索。'
    )
  if (pack?.status === 'complete')
    return idle(
      pack.matched
        ? `上次合集已匹配 ${pack.matched} / ${pack.total} 个缺集`
        : '上次合集没有匹配到缺集',
      series.effectiveMode === 'auto'
        ? '符合自动转存条件的集先转存，未覆盖的集继续补搜。'
        : '匹配结果在分集明细中确认转存，未覆盖的集继续补搜。'
    )
  return idle(
    '先找合集，再补单集',
    '到点的缺集有两集及以上时先找合集；只转存缺少的集，合集未覆盖的再逐集补搜。'
  )
}
