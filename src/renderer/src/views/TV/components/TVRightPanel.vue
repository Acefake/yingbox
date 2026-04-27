<template>
  <div>
    <!-- ══════════════════════════════════════════
       季视图：selectedItem 是季文件夹时显示
  ═══════════════════════════════════════════ -->
    <template v-if="selectedItem.isSeasonFolder">
      <!-- 季头部 glass card -->
      <div class="glass-card p-5 mb-5">
        <div class="flex items-start gap-6">
          <div class="flex flex-col items-center">
            <div
              class="w-40 rounded-xl overflow-hidden flex-shrink-0 shadow-lg ring-1 ring-white/10"
            >
              <img
                v-if="currentSeasonPoster"
                :src="currentSeasonPoster"
                class="w-full object-cover"
                @error="handleImageError"
              />
              <div
                v-else
                class="w-full aspect-[2/3] bg-white/5 flex items-center justify-center"
              >
                <svg
                  class="w-12 h-12 text-gray-500"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z"
                  />
                </svg>
              </div>
            </div>
            <button
              @click="emit('scrape-season', selectedItem)"
              class="glass-btn mt-3 w-full"
            >
              刮削这季
            </button>
          </div>

          <div class="flex-1 min-w-0">
            <div
              class="text-[11px] text-gray-400/80 uppercase tracking-widest mb-1 font-medium"
            >
              {{ currentTVShow?.name ?? '' }}
            </div>
            <h1
              class="text-2xl font-bold text-white mb-3 leading-tight drop-shadow"
            >
              {{ selectedItem.name }}
            </h1>
            <div class="flex items-center gap-4 text-xs text-gray-400 mb-3">
              <span
                v-if="currentSeasonMeta?.air_date"
                class="bg-white/5 px-2 py-0.5 rounded"
                >{{ currentSeasonMeta.air_date.substring(0, 4) }}</span
              >
              <span class="bg-white/5 px-2 py-0.5 rounded"
                >{{ episodeList.length }} 集</span
              >
            </div>
            <p
              v-if="currentSeasonMeta?.overview"
              class="text-xs text-gray-300/90 leading-relaxed"
            >
              {{ currentSeasonMeta.overview }}
            </p>
          </div>
        </div>
      </div>

      <!-- 集列表 -->
      <div class="glass-card p-5">
        <h2
          class="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4"
        >
          集列表
          <span class="ml-1 text-gray-500">{{ episodeList.length }}</span>
        </h2>
        <div class="space-y-2">
          <div
            v-for="ep in episodeList"
            :key="ep.path"
            class="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.04] hover:bg-white/[0.07] hover:border-white/[0.08] transition-all duration-200"
          >
            <div
              class="w-28 h-16 rounded-lg overflow-hidden flex-shrink-0 ring-1 ring-white/10 bg-white/5"
            >
              <img
                v-if="episodeThumbs?.[ep.path]"
                :src="episodeThumbs[ep.path]"
                class="w-full h-full object-cover"
                @error="handleImageError"
              />
              <div
                v-else
                class="w-full h-full flex items-center justify-center text-sm font-bold text-gray-500/60"
              >
                {{
                  ep.episodeNumber != null
                    ? 'E' + String(ep.episodeNumber).padStart(2, '0')
                    : '??'
                }}
              </div>
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-[13px] text-gray-200 truncate">
                {{ ep.name }}
              </div>
              <div class="text-[10px] text-gray-500 mt-0.5">
                第 {{ ep.episodeNumber ?? '?' }} 集
              </div>
            </div>
            <span
              v-if="ep.hasNfo"
              class="text-[9px] bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded-md font-bold flex-shrink-0"
              >NFO</span
            >
            <button
              class="flex-shrink-0 text-[10px] px-2 py-1 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/40 transition-colors"
              @click.stop="emit('scrape-episode', selectedItem, ep)"
            >
              刮削
            </button>
          </div>
          <div
            v-if="episodeList.length === 0"
            class="text-xs text-gray-500 text-center py-6"
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
      <!-- 详情头部 glass card -->
      <div class="p-5 mb-5">
        <div class="flex items-start gap-6">
          <div class="flex flex-col items-center">
            <div
              class="w-44 rounded-xl overflow-hidden flex-shrink-0 shadow-lg ring-1 ring-white/10"
            >
              <img
                v-if="posterUrl"
                :src="posterUrl"
                alt="海报"
                class="w-full object-cover"
                @error="handleImageError"
              />
              <div
                v-else
                class="w-full aspect-[2/3] bg-white/5 flex items-center justify-center"
              >
                <svg
                  class="w-16 h-16 text-gray-500"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fill-rule="evenodd"
                    d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
                    clip-rule="evenodd"
                  />
                </svg>
              </div>
            </div>
            <button
              @click="$emit('search-tv', scrapeTarget)"
              class="glass-btn mt-3 w-full"
            >
              同步信息
            </button>
          </div>

          <div class="flex-1 min-w-0">
            <h1
              class="text-3xl font-bold text-white mb-2 drop-shadow-lg leading-tight"
            >
              {{ selectedItem.name }}
            </h1>
            <TVInfo :tv-info="tvInfo" :loading="false" />
          </div>
        </div>
      </div>

      <!-- 季信息卡片列表 -->
      <div v-if="seasonList.length" class="p-5">
        <h2
          class="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4"
        >
          季信息 <span class="ml-1 text-gray-500">{{ seasonList.length }}</span>
        </h2>
        <div class="grid grid-cols-1 gap-3">
          <div
            v-for="season in seasonList"
            :key="season.season_number"
            class="flex gap-4 rounded-xl overflow-hidden bg-white/[0.03] border border-white/[0.05] hover:bg-white/[0.06] hover:border-white/[0.1] transition-all duration-200"
          >
            <div class="w-24 flex-shrink-0 self-stretch bg-white/[0.02]">
              <img
                v-if="getSeasonPoster(season.season_number)"
                :src="getSeasonPoster(season.season_number)"
                class="w-full h-full object-cover"
                alt=""
              />
              <div
                v-else
                class="w-full h-full min-h-[120px] flex items-center justify-center"
              >
                <svg
                  class="w-7 h-7 text-gray-600"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z"
                  />
                </svg>
              </div>
            </div>
            <div class="flex-1 min-w-0 py-3 pr-4">
              <div class="flex items-center gap-2 mb-1">
                <span class="font-semibold text-white text-sm">{{
                  season.name
                }}</span>
                <span
                  v-if="season.season_number === 0"
                  class="text-[10px] bg-yellow-500/15 text-yellow-400 px-1.5 py-0.5 rounded-md font-bold"
                  >特辑</span
                >
              </div>
              <div
                class="flex items-center gap-3 text-[11px] text-gray-400 mb-2"
              >
                <span
                  v-if="season.air_date"
                  class="bg-white/5 px-1.5 py-0.5 rounded"
                  >{{ season.air_date.substring(0, 4) }}</span
                >
                <span class="bg-white/5 px-1.5 py-0.5 rounded"
                  >{{
                    season.episode_count ??
                    getLocalEpisodeCount(season.season_number)
                  }}
                  集</span
                >
              </div>
              <p
                v-if="season.overview"
                class="text-xs text-gray-300/80 leading-relaxed line-clamp-3"
              >
                {{ season.overview }}
              </p>
              <p v-else class="text-xs text-gray-600 italic">暂无简介</p>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import TVInfo from '@/views/tv/components/TVInfo.vue'
import type { ProcessedItem, TVShowInfoType, SeasonInfo } from '@/types'

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
.glass-card {
  background: rgba(17, 24, 39, 0.35);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
}

.glass-btn {
  padding: 7px 16px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 500;
  color: #fff;
  background: rgba(59, 130, 246, 0.5);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(59, 130, 246, 0.3);
  transition: all 0.2s ease;
  cursor: pointer;
}
.glass-btn:hover {
  background: rgba(59, 130, 246, 0.7);
  border-color: rgba(59, 130, 246, 0.5);
  box-shadow: 0 4px 16px rgba(59, 130, 246, 0.25);
}

.line-clamp-3 {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
