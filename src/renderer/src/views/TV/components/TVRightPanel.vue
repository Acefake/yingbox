<template>
  <div class="yb-media-detail tv-rp">
    <!-- ══════════════════════════════════════════
       季视图：selectedItem 是季文件夹时显示
  ═══════════════════════════════════════════ -->
    <template v-if="selectedItem.isSeasonFolder">
      <div class="tv-header flex flex-wrap items-start gap-6">
        <div class="tv-poster">
          <img
            v-if="currentSeasonPoster"
            :src="currentSeasonPoster"
            class="tv-poster-img block size-full object-cover"
            alt="季海报"
            @error="handleImageError"
          />
          <div v-else class="tv-poster-ph">
            <UiIcon name="tv" size="lg" />
          </div>
        </div>
        <div class="tv-body">
          <div class="yb-label tv-series-label">
            {{ seriesLabel }}
          </div>
          <PageTitle>
            {{ seasonDisplayTitle }}
          </PageTitle>
          <div class="tv-meta-row">
            <span v-if="currentSeasonMeta?.air_date" class="tv-tag">{{
              currentSeasonMeta.air_date.substring(0, 4)
            }}</span>
            <span class="tv-tag">{{ episodeList.length }} 集</span>
          </div>
          <div class="tv-actions">
            <UiButton
              icon="wand"
              label="刮削这季"
              @click="emit('scrape-season', selectedItem)"
            />
          </div>
          <p v-if="currentSeasonMeta?.overview" class="tv-overview">
            {{ currentSeasonMeta.overview }}
          </p>
        </div>
      </div>

      <!-- 集列表 -->
      <div class="tv-section">
        <h2 class="yb-label mb-4">
          集列表
          <span class="ml-1 yb-dim">{{ episodeList.length }}</span>
        </h2>
        <div class="space-y-2">
          <div v-for="ep in episodeList" :key="ep.path" class="tv-ep-row">
            <div
              class="w-28 h-16 rounded-lg overflow-hidden flex-shrink-0 tv-thumb"
            >
              <img
                v-if="episodeThumbs?.[ep.path]"
                :src="episodeThumbs[ep.path]"
                class="w-full h-full object-cover"
                @error="handleImageError"
              />
              <div
                v-else
                class="w-full h-full flex items-center justify-center text-sm font-bold yb-dim"
              >
                {{ episodeCode(ep.episodeNumber) }}
              </div>
            </div>
            <div class="flex-1 min-w-0">
              <div class="tv-ep-name truncate" :title="ep.name">
                {{ episodeDisplayLabel(ep) }}
              </div>
              <div class="tv-ep-sub">第 {{ ep.episodeNumber ?? '?' }} 集</div>
            </div>
            <span v-if="ep.hasNfo" class="tv-nfo-badge">NFO</span>
            <UiIconButton
              class="tv-scrape-btn"
              icon="wand"
              label="刮削本集"
              size="sm"
              @click.stop="emit('scrape-episode', selectedItem, ep)"
            />
          </div>
          <div
            v-if="episodeList.length === 0"
            class="text-xs yb-dim text-center py-6"
          >
            未找到视频文件
          </div>
        </div>
      </div>
    </template>

    <!-- ══════════════════════════════════════════
       剧集视图：selectedItem 是TV show根时显示
  ═══════════════════════════════════════════ -->
    <template v-else>
      <div class="tv-header flex flex-wrap items-start gap-6">
        <div class="tv-poster">
          <img
            v-if="posterUrl"
            :src="posterUrl"
            alt="海报"
            class="tv-poster-img block size-full object-cover"
            @error="handleImageError"
          />
          <div v-else class="tv-poster-ph">
            <UiIcon name="tv" size="lg" />
          </div>
        </div>
        <div class="tv-body">
          <PageTitle>
            {{ showDisplayTitle }}
          </PageTitle>
          <TVInfo class="tv-info-wrap" :tv-info="tvInfo" :loading="false">
            <template #actions>
              <div class="tv-actions">
                <UiButton
                  icon="refresh"
                  label="同步信息"
                  @click="$emit('search-tv', scrapeTarget)"
                />
              </div>
            </template>
          </TVInfo>
        </div>
      </div>

      <!-- 季信息卡片列表 -->
      <div v-if="seasonList.length" class="tv-section">
        <h2 class="yb-label mb-4">
          季信息 <span class="ml-1 yb-dim">{{ seasonList.length }}</span>
        </h2>
        <div class="grid grid-cols-1 gap-3">
          <div
            v-for="season in seasonList"
            :key="season.season_number"
            class="tv-season-card"
          >
            <div class="tv-season-poster">
              <img
                v-if="getSeasonPoster(season.season_number)"
                :src="getSeasonPoster(season.season_number)"
                class="w-full h-full object-cover"
                alt=""
              />
              <div
                v-else
                class="w-full h-full min-h-[120px] flex items-center justify-center tv-season-ph"
              >
                <UiIcon name="tv" />
              </div>
            </div>
            <div class="flex-1 min-w-0 py-3 pr-4">
              <div class="flex items-center gap-2 mb-1">
                <span class="font-semibold tv-ep-name text-sm">{{
                  season.name
                }}</span>
                <span v-if="season.season_number === 0" class="tv-special-badge"
                  >特辑</span
                >
              </div>
              <div class="tv-meta-row tv-season-meta">
                <span v-if="season.air_date" class="tv-tag">{{
                  season.air_date.substring(0, 4)
                }}</span>
                <span class="tv-tag"
                  >{{
                    season.episode_count ??
                    getLocalEpisodeCount(season.season_number)
                  }}
                  集</span
                >
              </div>
              <p
                v-if="season.overview"
                class="text-xs yb-muted leading-relaxed line-clamp-3"
              >
                {{ season.overview }}
              </p>
              <p v-else class="text-xs yb-dim italic">暂无简介</p>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import PageTitle from '@/components/PageTitle.vue'
import { computed } from 'vue'
import TVInfo from '@/views/TV/components/TVInfo.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import { stripMediaExtension } from '@/utils/avid'
import type { ProcessedItem, SeasonInfo, TVShowInfoType } from '@/types'

interface Props {
  selectedItem: ProcessedItem
  /** 总是指向 TV show 根节点（点击季时由 Index.vue 传入） */
  currentTVShow?: ProcessedItem | null
  tvInfo: TVShowInfoType | null
  posterUrl: string
  seasonPosters?: Record<string, string>
  episodeThumbs?: Record<string, string>
}

const props = defineProps<Props>()

const emit = defineEmits<{
  /** 始终传入 TV show 根节点，而非季节点 */
  'search-tv': [item: ProcessedItem]
  /** 刮削整季（静默，从 tvshow.nfo 读 tmdbid） */
  'scrape-season': [seasonFolder: ProcessedItem]
  /** 刮削单集：seasonFolder + videoItem */
  'scrape-episode': [seasonFolder: ProcessedItem, videoItem: ProcessedItem]
}>()

/** 刮削目标：总是 TV show 根，不管当前选中的是 show 还是 season */
const scrapeTarget = computed(() => props.currentTVShow ?? props.selectedItem)

// ─── 季视图相关 ───────────────────────────────────────
/** 当前季对应的 TMDB 季元信息 */
const currentSeasonMeta = computed((): SeasonInfo | undefined => {
  if (!props.selectedItem.isSeasonFolder) return undefined
  return props.tvInfo?.seasons?.find(
    s => s.season_number === props.selectedItem.seasonNumber
  )
})

/** 当前季海报 data URL */
const currentSeasonPoster = computed(
  (): string => props.seasonPosters?.[props.selectedItem.path] ?? ''
)

/** 当前季的集列表（仅视频文件，按集号排序） */
const episodeList = computed(() =>
  (props.selectedItem.children || [])
    .filter(c => c.type === 'video')
    .sort((a, b) => (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0))
)

/** 系列名小标签（季视图上方） */
const seriesLabel = computed(() => {
  const fromInfo = String(props.tvInfo?.title || '').trim()
  if (fromInfo) return fromInfo
  return props.currentTVShow?.name ?? ''
})

/** 季标题：优先元数据季名，否则文件夹名 */
const seasonDisplayTitle = computed(() => {
  const fromMeta = String(currentSeasonMeta.value?.name || '').trim()
  if (fromMeta) return fromMeta
  return props.selectedItem.name
})

/** 剧集根标题：优先 tvInfo.title */
const showDisplayTitle = computed(() => {
  const fromInfo = String(props.tvInfo?.title || '').trim()
  if (fromInfo) return fromInfo
  return props.selectedItem.name
})

const episodeCode = (n?: number | null): string => {
  if (n == null) return '??'
  return `E${String(n).padStart(2, '0')}`
}

/** 集显示：有元数据标题则 E01 · title；否则去扩展名的文件名 */
const episodeDisplayLabel = (ep: ProcessedItem): string => {
  const code = episodeCode(ep.episodeNumber)
  const metaTitle = currentSeasonMeta.value?.episodes?.find(
    e => e.episode_number === ep.episodeNumber
  )?.name
  const cleanedMeta = String(metaTitle || '').trim()
  if (cleanedMeta) return `${code} · ${cleanedMeta}`
  const stripped = stripMediaExtension(ep.name || '')
  return stripped || ep.name
}

// ─── 剧集视图相关 ─────────────────────────────────────
/** 季列表：优先用 tvInfo.seasons（含 TMDB 简介），否则从本地文件结构生成 */
const seasonList = computed((): SeasonInfo[] => {
  const root = props.currentTVShow ?? props.selectedItem
  if (props.tvInfo?.seasons?.length) {
    return [...props.tvInfo.seasons].sort(
      (a, b) => a.season_number - b.season_number
    )
  }
  return (root.children || [])
    .filter(c => c.isSeasonFolder)
    .map(c => ({
      season_number: c.seasonNumber ?? 0,
      name: c.name,
      episode_count: c.children?.length ?? 0,
    }))
    .sort((a, b) => a.season_number - b.season_number)
})

/** 通过 season_number 查找对应本地文件夹，返回季海报 data URL */
const getSeasonPoster = (seasonNumber: number): string => {
  const root = props.currentTVShow ?? props.selectedItem
  const folder = root.children?.find(c => c.seasonNumber === seasonNumber)
  return props.seasonPosters?.[folder?.path ?? ''] ?? ''
}

/** 从本地文件结构获取集数（TMDB 数据缺失时用） */
const getLocalEpisodeCount = (seasonNumber: number): number => {
  const root = props.currentTVShow ?? props.selectedItem
  const folder = root.children?.find(c => c.seasonNumber === seasonNumber)
  return folder?.children?.length ?? 0
}

const handleImageError = (event: Event): void => {
  const target = event.target as HTMLImageElement
  if (target) target.style.display = 'none'
}
</script>

<style scoped>
.tv-rp {
  color: var(--text-primary);
}
.tv-header {
  display: flex;
  align-items: flex-start;
  gap: var(--space-6);
  margin-bottom: var(--space-6);
}
.tv-poster {
  width: 200px;
  flex-shrink: 0;
  aspect-ratio: 2 / 3;
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow-md);
  outline: 1px solid var(--border-subtle);
  background: var(--bg-fill-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
}
.tv-poster-img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  object-position: center;
}
.tv-poster-ph {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-fill-secondary);
  color: var(--text-quaternary);
}
.tv-season-ph {
  color: var(--text-quaternary);
}
.tv-body {
  flex: 1;
  min-width: 0;
}
.tv-series-label {
  margin-bottom: var(--space-1);
}
.tv-meta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-3) 0 var(--space-5);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
.tv-tag {
  white-space: nowrap;
}
.tv-tag + .tv-tag::before {
  content: '·';
  margin-right: var(--space-2);
  color: var(--text-quaternary);
}
.tv-season-meta {
  margin: 0 0 var(--space-2);
  font-size: var(--text-xs);
}
.tv-overview {
  max-width: 64ch;
  margin: 0 0 var(--space-5);
  color: var(--text-secondary);
  font-size: var(--text-md);
  line-height: 1.65;
}
.tv-info-wrap {
  margin-top: var(--space-3);
}
.tv-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-6);
}
.tv-section {
  background: transparent;
  border: 0;
  border-radius: 0;
  padding: var(--space-5) 0;
  box-shadow: none;
  margin-bottom: var(--space-5);

  border-top: 1px solid var(--border-default);
}
.tv-ep-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 72px;
  padding: var(--space-3) 0;
  border-radius: 0;
  background: transparent;
  border: 0;
  transition: var(--transition-fast);

  border-bottom: 1px solid var(--border-subtle);
}
.tv-ep-row:hover {
  background: var(--bg-fill-secondary);
  border-color: var(--border-subtle);
}
.tv-ep-row:active {
  transform: scale(0.99);
}
.tv-thumb {
  background: var(--bg-fill-secondary);
  box-shadow: inset 0 0 0 1px var(--border-subtle);
}
.tv-ep-name {
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
}
.tv-nfo-badge {
  font-size: var(--text-2xs);
  padding: var(--space-0_5) var(--space-2);
  border-radius: var(--radius-sm);
  font-weight: 700;
  flex-shrink: 0;
  background: color-mix(in srgb, var(--success) 16%, transparent);
  color: var(--success);
}
.tv-ep-sub {
  margin-top: var(--space-0_5);
  color: var(--text-tertiary);
  font-size: var(--text-2xs);
}
.tv-scrape-btn {
  opacity: 0;
}
.tv-ep-row:hover .tv-scrape-btn,
.tv-ep-row:focus-within .tv-scrape-btn {
  opacity: 1;
}
.tv-season-card {
  display: flex;
  gap: var(--space-4);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: transparent;
  border: 1px solid var(--border-default);
  transition: var(--transition-fast);
}
.tv-season-card:hover {
  background: var(--bg-fill-secondary);
  border-color: var(--border-subtle);
}
.tv-season-poster {
  width: 84px;
  flex-shrink: 0;
  align-self: stretch;
  aspect-ratio: 2 / 3;
  background: var(--bg-fill-secondary);
  box-shadow: inset 0 0 0 1px var(--border-subtle);
}
.tv-special-badge {
  font-size: var(--text-2xs);
  padding: var(--space-0_5) var(--space-2);
  border-radius: var(--radius-sm);
  font-weight: 700;
  background: color-mix(in srgb, var(--warning) 16%, transparent);
  color: var(--warning);
}
.line-clamp-3 {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
@media (max-width: 720px) {
  .tv-header {
    flex-direction: column;
    align-items: stretch;
  }
  .tv-poster {
    width: 160px;
    margin: 0 auto;
  }
}
@media (prefers-reduced-motion: reduce) {
  .tv-ep-row:active {
    transform: none;
  }
}
</style>
