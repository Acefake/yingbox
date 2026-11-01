<template>
  <div class="calendar-page">
    <PageHeader title="追剧日历" :description="summary || undefined">
      <template v-if="pendingCount" #status>
        <UiButton
          class="cal-pending-link"
          size="sm"
          variant="plain"
          :label="`${pendingCount} 集资源待确认，去处理`"
          @click="router.push('/autograb')"
        />
      </template>
      <template #actions>
        <div class="cal-nav" role="group" aria-label="切换周">
          <UiIconButton icon="back" size="sm" label="上一周" @click="prev" />
          <span class="cal-week-label">{{ weekTitle }}</span>
          <UiButton
            v-if="!cal.isThisWeek.value"
            size="sm"
            variant="plain"
            label="今天"
            aria-label="回到本周"
            @click="cal.goToday"
          />
          <UiIconButton icon="forward" size="sm" label="下一周" @click="next" />
        </div>
        <UiSegmented
          v-model="cal.mode.value"
          :options="MODE_OPTIONS"
          label="日历视图"
        />
        <UiIconButton
          icon="refresh"
          label="重新获取播出信息"
          :loading="cal.loading.value"
          @click="refresh"
        />
      </template>
    </PageHeader>

    <p v-if="notice" class="cal-notice">{{ notice }}</p>

    <template v-if="cal.mode.value === 'week'">
      <!-- 整周无剧时只出一个整体空状态，不再叠 7 个「无更新」空列 -->
      <StatusState
        v-if="weekEmpty"
        icon="calendar"
        title="还没有在追的剧"
        hint="剧集库里已识别的剧和继续播放里的在线剧会按播出日期排在这里"
      />
      <template v-else>
        <section
          v-if="todayRows.length"
          class="cal-section"
          aria-labelledby="cal-today-title"
        >
          <div class="cal-section-head">
            <h2 id="cal-today-title" class="cal-section-title">今天</h2>
            <span class="cal-section-meta">{{ todayMeta }}</span>
          </div>
          <ul class="cal-today-grid">
            <li v-for="group in todayRows" :key="group.id">
              <TodayCard
                :group="group"
                :mark="markOf(group)"
                @activate="activate"
                @mark="openAutograb"
              />
            </li>
          </ul>
        </section>
        <section class="cal-section" aria-labelledby="cal-week-title">
          <div class="cal-section-head">
            <h2 id="cal-week-title" class="cal-section-title">
              {{ cal.isThisWeek.value ? '本周' : weekTitle }}
            </h2>
            <ul v-if="legend.length" class="cal-legend" aria-label="状态图例">
              <li
                v-for="item in legend"
                :key="item.tone"
                class="cal-status"
                :data-tone="item.tone"
              >
                {{ item.label }}
              </li>
            </ul>
          </div>
          <div class="cal-week">
            <div
              v-for="day in weekRows"
              :key="day.date"
              class="cal-day"
              :class="{ 'is-today': day.isToday }"
              :aria-current="day.isToday ? 'date' : undefined"
            >
              <h3
                class="cal-day-head"
                :aria-label="dayLabel(day.date, cal.today.value)"
              >
                <span class="cal-day-name">{{
                  day.isToday ? '今天' : dayParts(day.date).weekday
                }}</span>
                <span class="cal-day-num">{{ dayParts(day.date).day }}</span>
              </h3>
              <ul v-if="day.rows.length" class="cal-day-list">
                <li v-for="group in day.rows" :key="group.id">
                  <CalendarRow
                    :group="group"
                    compact
                    :mark="markOf(group)"
                    @activate="activate"
                    @mark="openAutograb"
                  />
                </li>
              </ul>
              <span v-else class="cal-day-empty">无更新</span>
            </div>
          </div>
        </section>
      </template>
    </template>
    <section v-else class="cal-list" aria-label="列表视图">
      <div
        v-for="group in listRows"
        :key="group.key"
        class="cal-group"
        :class="{ 'is-today': group.isToday }"
      >
        <h3 class="cal-group-label">{{ group.label }}</h3>
        <ul class="cal-grid">
          <li v-for="row in group.rows" :key="row.id">
            <CalendarRow
              :group="row"
              :mark="markOf(row)"
              @activate="activate"
              @mark="openAutograb"
            />
          </li>
        </ul>
      </div>
      <StatusState
        v-if="!listRows.length && !cal.loading.value && !cal.error.value"
        icon="calendar"
        title="这一周没有剧集更新"
        hint="剧集库里已识别的剧和继续播放里的在线剧会出现在这里"
      />
    </section>

    <section
      v-if="cal.mode.value === 'week' && undated.length"
      class="cal-group"
      aria-label="在线追剧"
    >
      <h3 class="cal-group-label">在线追剧 · 更新日期未知</h3>
      <ul class="cal-grid">
        <li v-for="row in undatedRows" :key="row.id">
          <CalendarRow
            :group="row"
            :mark="markOf(row)"
            @activate="activate"
            @mark="openAutograb"
          />
        </li>
      </ul>
    </section>

    <EpisodeGrabSheet
      v-if="autograbAvailable"
      :episode-key="sheetKey"
      @close="sheetKey = null"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 追剧日历页（/calendar）：周视图（周一到周日七列，每天一列紧凑行，同一部剧同一天的几集合并成一行，
 * 可前后翻周，今天的日期浅灰圆底）与列表视图（按天分组的同样行）；
 * 页头右侧是周切换（不在本周时胶囊里多一个「今天」）、视图切换与刷新，统一用控件高度令牌（md 36）的灰色胶囊。
 * 数据见 use-calendar.ts；点卡片：媒体库里有本地文件就播放这一集，否则打开剧的详情；在线剧打开在线详情。
 * 本周时周视图上方是「今天」一排大剧照卡（TodayCard），七列每行下面是同一套状态圆点（rowStatus），标题右侧是本周出现过的状态图例。
 * 只看不管：追更在自动追更页（/autograb）。旧深链 ?autograb=1 重定向过去；有资源待确认时页头说明下面有去处理的链接；
 * 追更中的集卡片上有追更小标记，点它从右侧滑出这一集的侧板（覆盖在页面上，日历滚动位置不动）。
 */
import { computed, nextTick, onActivated, onDeactivated, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import PageHeader from '@/components/PageHeader.vue'
import StatusState from '@/components/StatusState.vue'
import {
  type SegmentedOption,
  UiButton,
  UiIconButton,
  UiSegmented,
  toast,
} from '@/components/ui'
import {
  type AutograbMark,
  EpisodeGrabSheet,
  autograbAvailable,
  markKey,
  useAutograbBadge,
  useAutograbMarks,
} from '@/features/autograb'
import { playLibraryEpisode, seriesPagePath } from '@/features/library'
import type { SeriesCategory } from '../../../../../shared/contract/series-category'
import { requestOnlineDetail } from '@/features/online'

import { dayLabel, dayParts, groupByWeek, weekLabel } from '../calendar-dates'
import { type CalendarEntry, listGroups, weekSummary } from '../calendar-rules'
import {
  type ShowDayGroup,
  groupShowsByDay,
  legendOf,
  rowStatus,
} from '../calendar-rows'
import CalendarRow from '../components/CalendarRow.vue'
import TodayCard from '../components/TodayCard.vue'
import { type CalendarMode, useCalendar } from '../use-calendar'

const MODE_OPTIONS: SegmentedOption<CalendarMode>[] = [
  { value: 'week', label: '周' },
  { value: 'list', label: '列表' },
]

const router = useRouter()
const cal = useCalendar()
const route = useRoute()
// 旧深链 /calendar?autograb=1 → 自动追更页
watch(
  () => route.query.autograb,
  flag => {
    if (flag === '1' && autograbAvailable) void router.replace('/autograb')
  },
  { immediate: true }
)

/** 侧板里打开的追更集；null = 关着 */
const sheetKey = ref<string | null>(null)
const marks = useAutograbMarks()
const pendingCount = useAutograbBadge()

/** 一行的追更小标记：行里第一集有标记的媒体库条目 */
function markOf(group: ShowDayGroup): AutograbMark | null {
  for (const entry of group.entries) {
    const lib = entry.library
    if (!lib) continue
    const mark = marks.value.get(markKey(lib.seriesId, lib.season, lib.episode))
    if (mark) return mark
  }
  return null
}

/** 点小标记：从右侧滑出这一集的追更侧板 */
function openAutograb(key: string): void {
  sheetKey.value = key
}

const weekTitle = computed(() => weekLabel(cal.start.value, cal.today.value))
const weekBuckets = computed(() =>
  groupByWeek(cal.entries.value, cal.start.value, cal.today.value)
)
const groups = computed(() =>
  listGroups(cal.entries.value, cal.start.value, cal.today.value)
)
/** 页头说明：当前显示的这一周有几部剧、几集更新（按剧的唯一标识去重） */
const summary = computed(() =>
  weekSummary(
    weekBuckets.value.flatMap(day => day.items),
    cal.start.value,
    cal.today.value
  )
)
const undated = computed(() =>
  cal.entries.value.filter(entry => entry.airDate === null)
)
/** 周视图每天的行（同剧同日合并） */
const weekRows = computed(() =>
  weekBuckets.value.map(day => ({ ...day, rows: groupShowsByDay(day.items) }))
)
/** 列表视图每组的行 */
const listRows = computed(() =>
  groups.value.map(group => ({ ...group, rows: groupShowsByDay(group.items) }))
)
const undatedRows = computed(() => groupShowsByDay(undated.value))
/** 周视图上方「今天」一排大卡（只在本周出现） */
const todayRows = computed(() =>
  cal.isThisWeek.value
    ? (weekRows.value.find(day => day.isToday)?.rows ?? [])
    : []
)
/** 「今天」标题旁的一句：11月1日 周日 · 3 部剧 */
const todayMeta = computed(() => {
  const [, month, day] = cal.today.value.split('-').map(Number)
  const { weekday } = dayParts(cal.today.value)
  return `${month}月${day}日 ${weekday} · ${todayRows.value.length} 部剧`
})
/** 周视图的图例：这一周出现过的状态 */
const legend = computed(() =>
  legendOf(
    weekRows.value.flatMap(day =>
      day.rows.map(group => rowStatus(group, markOf(group)))
    )
  )
)
/** 周视图整体为空：这一周没有任何条目，且不在加载中、也没有出错（出错由顶部说明提示） */
const weekEmpty = computed(
  () => !cal.entries.value.length && !cal.loading.value && !cal.error.value
)

/** 顶部一行说明：没配 TMDB 令牌、部分剧获取失败、请求出错 */
const notice = computed(() => {
  if (cal.error.value) return `播出信息获取失败：${cal.error.value}`
  const result = cal.result.value
  if (result && !result.configured)
    return '未配置 TMDB 令牌，剧集库的播出日期暂不可用（设置 → 刮削）'
  if (result?.failed) return `有 ${result.failed} 部剧的播出信息暂时没取到`
  return ''
})

// 打开页面、换周、过了零点（同一周内也算）都按当前区间的缓存键加载（同一天已加载过的不再请求）
watch(cal.rangeKey, () => void cal.load(), { immediate: true })
onActivated(() => void cal.load())
onDeactivated(() => (sheetKey.value = null))

function prev(): void {
  cal.shift(-1)
}

function next(): void {
  cal.shift(1)
}

function refresh(): void {
  void cal.load(true)
}

/** 打开片库里这部剧的详情：按分类直接去剧集 / 动漫 / 综艺 / 纪录片页 */
function openLibraryDetail(seriesId: number, category?: SeriesCategory): void {
  void router.push({
    path: seriesPagePath(category),
    query: { item: String(seriesId) },
  })
}

/** 点卡片：本地有文件就播放，否则打开详情 */
async function activate(entry: CalendarEntry): Promise<void> {
  if (entry.library) {
    const { seriesId, season, episode, playable, category } = entry.library
    if (playable && (await playLibraryEpisode(seriesId, season, episode)))
      return
    if (playable) toast.error('无法播放这一集，已打开详情')
    openLibraryDetail(seriesId, category)
    return
  }
  if (entry.online?.detail) {
    await router.push('/')
    // 等在线页处理完路由变化（切标签会关掉详情层）再请它打开详情
    await nextTick()
    requestOnlineDetail(entry.online.detail)
    return
  }
  toast.info('这部剧没有保存详情，请在在线页重新搜索')
}
</script>

<style scoped src="../components/row-status.css"></style>
<style scoped src="./calendar-view.css"></style>
