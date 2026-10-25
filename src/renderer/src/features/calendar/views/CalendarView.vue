<template>
  <div class="calendar-page">
    <PageHeader title="追剧日历" :description="summary || undefined">
      <template #actions>
        <UiButton
          v-if="!cal.isThisWeek.value"
          class="cal-today"
          variant="plain"
          label="回到本周"
          @click="cal.goToday"
        />
        <div class="cal-nav yb-glass" role="group" aria-label="切换周">
          <UiIconButton icon="back" label="上一周" @click="prev" />
          <span class="cal-week-label">{{ weekTitle }}</span>
          <UiIconButton icon="forward" label="下一周" @click="next" />
        </div>
        <UiSegmented
          v-model="cal.mode.value"
          :options="MODE_OPTIONS"
          label="日历视图"
          size="sm"
        />
        <UiButton
          v-if="autograbAvailable"
          class="cal-pill"
          :class="{ 'is-on': showAutograb }"
          icon="download"
          label="追更"
          :aria-pressed="showAutograb"
          @click="toggleAutograb"
        />
        <UiIconButton
          class="cal-round yb-glass"
          icon="refresh"
          label="重新获取播出信息"
          :loading="cal.loading.value"
          @click="refresh"
        />
      </template>
    </PageHeader>

    <p v-if="notice" class="cal-notice">{{ notice }}</p>

    <AutograbTabs v-if="autograbAvailable && showAutograb">
      <AutograbPanel :focus-key="autograbFocus" />
    </AutograbTabs>

    <template v-if="cal.mode.value === 'week'">
      <!-- 整周无剧时只出一个整体空状态，不再叠 7 个「无更新」空列 -->
      <StatusState
        v-if="weekEmpty"
        icon="calendar"
        title="还没有在追的剧"
        hint="剧集库里已识别的剧和继续播放里的在线剧会按播出日期排在这里"
      />
      <section v-else class="cal-week" aria-label="周视图">
        <div
          v-for="day in weekBuckets"
          :key="day.date"
          class="cal-day"
          :class="{ 'is-today': day.isToday }"
          :aria-current="day.isToday ? 'date' : undefined"
        >
          <h3
            class="cal-day-head"
            :aria-label="dayLabel(day.date, cal.today.value)"
          >
            <span class="cal-day-name">{{ dayParts(day.date).weekday }}</span>
            <span class="cal-day-num">{{ dayParts(day.date).day }}</span>
          </h3>
          <ul v-if="day.items.length" class="cal-day-list">
            <li v-for="entry in day.items" :key="entry.id">
              <CalendarCard
                :entry="entry"
                compact
                :mark="markOf(entry)"
                @activate="activate"
                @mark="openAutograb"
              />
            </li>
          </ul>
          <span v-else class="cal-day-empty">无更新</span>
        </div>
      </section>
    </template>
    <section v-else class="cal-list" aria-label="列表视图">
      <div
        v-for="group in groups"
        :key="group.key"
        class="cal-group"
        :class="{ 'is-today': group.isToday }"
      >
        <h3 class="cal-group-label">{{ group.label }}</h3>
        <ul class="cal-grid">
          <li v-for="entry in group.items" :key="entry.id">
            <CalendarCard
              :entry="entry"
              :mark="markOf(entry)"
              @activate="activate"
              @mark="openAutograb"
            />
          </li>
        </ul>
      </div>
      <StatusState
        v-if="!groups.length && !cal.loading.value && !cal.error.value"
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
        <li v-for="entry in undated" :key="entry.id">
          <CalendarCard
            :entry="entry"
            :mark="markOf(entry)"
            @activate="activate"
            @mark="openAutograb"
          />
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * 追剧日历页（/calendar）：周视图（周一到周日七列剧照卡，可前后翻周，今天的日期白色圆标）与列表视图；
 * 页头右侧是玻璃周切换胶囊、视图切换、追更与刷新。
 * 数据见 use-calendar.ts；点卡片：媒体库里有本地文件就播放这一集，否则打开剧的详情；在线剧打开在线详情。
 * 带 ?autograb=1 打开（播放器播完本地最后一集时的「去追更」）时展开追更面板。
 * 追更中的集卡片上有追更小标记，点它展开追更面板并定位到那一集。
 */
import { computed, nextTick, onActivated, ref, watch } from 'vue'
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
  AutograbPanel,
  autograbAvailable,
  markKey,
  useAutograbMarks,
} from '@/features/autograb'
import { AutograbTabs } from '@/features/autograb-upgrade'
import { playLibraryEpisode } from '@/features/library'
import { requestOnlineDetail } from '@/features/online'

import { dayLabel, dayParts, groupByWeek, weekLabel } from '../calendar-dates'
import { type CalendarEntry, listGroups } from '../calendar-rules'
import CalendarCard from '../components/CalendarCard.vue'
import { type CalendarMode, useCalendar } from '../use-calendar'

const MODE_OPTIONS: SegmentedOption<CalendarMode>[] = [
  { value: 'week', label: '周' },
  { value: 'list', label: '列表' },
]

const router = useRouter()
const cal = useCalendar()
/** 追更面板展开 */
const showAutograb = ref(false)
const route = useRoute()
watch(
  () => route.query.autograb,
  flag => {
    if (flag !== '1') return
    if (autograbAvailable) showAutograb.value = true
    void router.replace({ query: { ...route.query, autograb: undefined } })
  },
  { immediate: true }
)

/** 追更面板里要定位的一集 */
const autograbFocus = ref<string | null>(null)
const marks = useAutograbMarks()

/** 媒体库条目的追更小标记 */
function markOf(entry: CalendarEntry): AutograbMark | null {
  const lib = entry.library
  if (!lib) return null
  return marks.value.get(markKey(lib.seriesId, lib.season, lib.episode)) ?? null
}

/** 顶部「追更」按钮：开关面板（不定位） */
function toggleAutograb(): void {
  autograbFocus.value = null
  showAutograb.value = !showAutograb.value
}

/** 点小标记：展开追更面板并定位到这一集 */
function openAutograb(key: string): void {
  autograbFocus.value = key
  showAutograb.value = true
}

const weekTitle = computed(() => weekLabel(cal.start.value, cal.today.value))
const weekBuckets = computed(() =>
  groupByWeek(cal.entries.value, cal.start.value, cal.today.value)
)
const groups = computed(() =>
  listGroups(cal.entries.value, cal.start.value, cal.today.value)
)
/** 页头说明：本周（当前显示的这一周）有几集、几部剧更新 */
const summary = computed(() => {
  const items = weekBuckets.value.flatMap(day => day.items)
  if (!items.length) return ''
  const shows = new Set(items.map(entry => entry.title)).size
  return `本周 ${shows} 部剧 · ${items.length} 集更新`
})
const undated = computed(() =>
  cal.entries.value.filter(entry => entry.airDate === null)
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
    return '未配置 TMDB 令牌，剧集库的播出日期暂不可用（设置 → 服务）'
  if (result?.failed) return `有 ${result.failed} 部剧的播出信息暂时没取到`
  return ''
})

// 打开页面、换周、过了零点（同一周内也算）都按当前区间的缓存键加载（同一天已加载过的不再请求）
watch(cal.rangeKey, () => void cal.load(), { immediate: true })
onActivated(() => void cal.load())

function prev(): void {
  cal.shift(-1)
}

function next(): void {
  cal.shift(1)
}

function refresh(): void {
  void cal.load(true)
}

/** 打开剧集库里这部剧的详情 */
function openLibraryDetail(seriesId: number): void {
  void router.push({ path: '/tv', query: { item: String(seriesId) } })
}

/** 点卡片：本地有文件就播放，否则打开详情 */
async function activate(entry: CalendarEntry): Promise<void> {
  if (entry.library) {
    const { seriesId, season, episode, playable } = entry.library
    if (playable && (await playLibraryEpisode(seriesId, season, episode)))
      return
    if (playable) toast.error('无法播放这一集，已打开详情')
    openLibraryDetail(seriesId)
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

<style scoped>
.calendar-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  height: 100%;
  padding: var(--content-padding-y) var(--content-padding-x) var(--space-8);
  overflow-y: auto;
}

.cal-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-1);
  min-width: 260px;
  height: 44px;
  padding: 0 var(--space-1);
  border-radius: var(--radius-full);
}
.cal-nav :deep(.yb-icon-button) {
  border-radius: var(--radius-full);
}
.cal-week-label {
  min-width: 0;
  color: var(--text-primary);
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.cal-pill {
  border-radius: var(--radius-full);
}
.cal-pill.is-on {
  background: var(--text-primary);
  color: var(--bg-content);
}
/* 图标按钮基类是透明底，玻璃底色在这里补上（模糊与阴影来自 .yb-glass） */
.cal-round {
  border-radius: var(--radius-full);
  background: var(--glass-bg);
}

.cal-notice {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}

/* ── 周视图：七列剧照卡；最小窗口（1200 宽）也放得下，更窄时横向滚动 ── */
.cal-week {
  display: grid;
  grid-template-columns: repeat(7, minmax(112px, 1fr));
  gap: var(--space-3);
  overflow-x: auto;
}
.cal-day {
  display: flex;
  flex-direction: column;
  gap: var(--space-2_5);
  min-width: 0;
}
.cal-day-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 var(--space-1_5) 0 var(--space-1);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-regular);
}
.cal-day-num {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: var(--text-primary);
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
  line-height: 32px;
  text-align: center;
}
.cal-day.is-today .cal-day-name {
  color: var(--text-primary);
  font-weight: var(--font-weight-semibold);
}
.cal-day.is-today .cal-day-num {
  background: var(--text-primary);
  color: var(--bg-content);
}
/* 今天的卡：白色细圈画在卡内侧的伪元素上（压在剧照与模糊层之上，不被横向滚动的容器裁掉） */
.cal-day.is-today .cal-day-list :deep(.cal-card)::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: inset 0 0 0 2px var(--text-primary);
  pointer-events: none;
}
.cal-day-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2_5);
}
.cal-day-empty {
  display: grid;
  place-items: center;
  aspect-ratio: 8 / 9;
  border: 1px dashed var(--border-glass-light);
  border-radius: var(--radius-card);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}

/* ── 列表视图与「更新日期未知」：自适应网格 ── */
.cal-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-7);
}
.cal-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.cal-group-label {
  color: var(--text-primary);
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-tight);
}
.cal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--space-4);
}
</style>
