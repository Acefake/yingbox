<template>
  <section class="live-stage" aria-label="正在观看">
    <LivePlayer
      class="live-stage-player"
      :channel="channel"
      :lines="lines"
      :status="status"
      :mpv-available="mpvAvailable"
      @open-mpv="openInMpv"
    />

    <aside class="live-stage-side">
      <div v-if="channel" class="live-stage-head">
        <LiveLogo :name="channel.name" :logo="channel.logo" />
        <div class="live-stage-text">
          <h2 class="live-stage-name">{{ channel.name }}</h2>
          <p class="live-stage-sub">{{ subText }}</p>
        </div>
        <UiIconButton
          v-if="mpvAvailable"
          icon="externalLink"
          variant="secondary"
          label="用 mpv 打开（有画面没声音、卡顿时可试）"
          @click="openInMpv"
        />
        <UiIconButton
          class="live-stage-fav"
          :class="{ 'is-on': favorite }"
          icon="star"
          variant="secondary"
          :filled="favorite"
          :active="favorite"
          :label="favorite ? '取消收藏' : '收藏频道'"
          @click="emit('toggle-favorite', channel.id)"
        />
      </div>

      <div
        v-if="channel && channel.urls.length > 1"
        class="live-stage-lines"
        role="group"
        aria-label="线路"
      >
        <UiChip
          v-for="(_, index) in channel.urls"
          :key="index"
          :label="`线路 ${index + 1}`"
          :selected="index === line && !failed"
          :title="reasons[index]"
          @click="pickLine(index)"
        />
      </div>

      <LiveSchedule
        class="live-stage-schedule"
        :programmes="channel ? programmes : undefined"
        :now="now"
        :empty-text="channel ? scheduleEmptyText : '选择频道后显示节目单'"
      />
    </aside>
  </section>
</template>

<script setup lang="ts">
/**
 * 直播页上半区：左侧 16:9 大画面（LivePlayer），右侧栏是频道台标、名称、「分组 · 线路状态」、mpv 打开与收藏，
 * 多线路时一排线路胶囊（悬停看失败原因），下面是今日节目单。右侧栏高度跟随画面；本区宽度不够时节目单落到画面下方。
 * 线路的探测、换线与失败原因在 useLiveLine；全部失败时可一键改用 mpv。
 */
import { computed, toRef } from 'vue'

import UiChip from '@/components/ui/UiChip.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import { toast } from '@/components/ui/toast'
import { useMpvPlayer } from '@/features/player'

import { useLiveLine } from '../composables/use-live-line'
import { nowPlaying } from '../utils/epg-rules'
import type { LiveChannel } from '../utils/playlist-parse'
import LiveLogo from './LiveLogo.vue'
import LivePlayer from './LivePlayer.vue'
import LiveSchedule from './LiveSchedule.vue'
import type { EpgProgramme } from '../../../../../shared/contract/iptv'

const props = defineProps<{
  channel: LiveChannel | null
  programmes: EpgProgramme[] | undefined
  now: number
  favorite: boolean
  scheduleEmptyText: string
}>()

const emit = defineEmits<{ 'toggle-favorite': [id: string] }>()

const lines = useLiveLine(toRef(props, 'channel'))
const { line, failed, plan, probing, reasons, url, pickLine } = lines

const mpv = useMpvPlayer()
const mpvAvailable = mpv.canUseMpv()

const status = computed(() => nowPlaying(props.programmes, props.now))

/** 「分组 · 线路状态」 */
const subText = computed(() => {
  const channel = props.channel
  if (!channel) return ''
  const n = line.value + 1
  const state = failed.value
    ? '线路都不可用'
    : probing.value
      ? `线路 ${n} 连接中`
      : plan.value
        ? `线路 ${n} 正常`
        : `线路 ${n}`
  return [channel.group, state].filter(Boolean).join(' · ')
})

/** 当前线路交给 mpv（FLV / TS / 组播、HEVC、MP2 / AC3 音频都能播） */
async function openInMpv(): Promise<void> {
  const target = url.value
  if (!target) return
  const ok = await mpv.openMpv({ url: target, title: props.channel?.name })
  if (!ok)
    toast.warning('未检测到 mpv 播放器，可在「设置 → 播放器」安装或指定路径')
}
</script>

<style scoped>
.live-stage {
  /* 画面最高约占窗口 66% 高度，超宽窗口里右侧栏分走多出的宽度 */
  --live-player-max: calc(66vh * 16 / 9);
  display: grid;
  grid-template-columns: minmax(0, var(--live-player-max)) minmax(280px, 1fr);
  gap: var(--space-5);
  align-items: start;
}

.live-stage-side {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: var(--space-4);
  /* 不让节目单撑高这一行：右侧栏高度取画面高度 */
  align-self: stretch;
  contain: size;
}

.live-stage-head {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-3);
}

.live-stage-text {
  flex: 1;
  min-width: 0;
}

.live-stage-name {
  margin: 0;
  overflow: hidden;
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.live-stage-sub {
  margin: var(--space-0_5) 0 0;
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.live-stage-fav.is-on {
  color: var(--rating);
}

.live-stage-lines {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.live-stage-schedule {
  flex: 1;
  min-height: 0;
}

/* 页面内容区窄时（容器 live-page 在 LiveView）：节目单落到画面下方，给一个固定高度 */
@container live-page (max-width: 760px) {
  .live-stage {
    grid-template-columns: minmax(0, var(--live-player-max));
  }

  .live-stage-side {
    contain: none;
    height: 360px;
  }
}
</style>
