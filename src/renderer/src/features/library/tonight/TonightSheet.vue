<template>
  <LibrarySheet
    :open="open"
    title="今晚看什么"
    icon="sparkle"
    size="lg"
    @close="close"
  >
    <div class="tonight">
      <div class="tonight-filters">
        <div class="tonight-chips" role="group" aria-label="心情">
          <UiChip
            v-for="m in TONIGHT_MOODS"
            :key="m.id"
            :label="m.label"
            :selected="mood === m.id"
            @click="toggleMood(m.id)"
          />
        </div>
        <div class="tonight-chips" role="group" aria-label="可用时长">
          <UiChip
            v-for="t in TONIGHT_TIMES"
            :key="t.id"
            :label="t.label"
            :selected="time === t.id"
            @click="setTime(t.id)"
          />
        </div>
      </div>
      <UiInput
        v-model="note"
        v-enter="pickFresh"
        class="tonight-note"
        clearable
        :maxlength="NOTE_CHARS"
        placeholder="还想补充一句？比如：想看老片、不要太压抑"
        aria-label="补充一句"
        @clear="note = ''"
      />

      <p v-if="notice" class="tonight-notice">
        {{ notice.text }}
        <UiButton
          v-if="notice.configure"
          variant="plain"
          size="sm"
          label="去配置 AI"
          @click="openAiSettings"
        />
      </p>

      <div v-if="picks.length" class="tonight-cards">
        <TonightCard
          v-for="p in picks"
          :key="p.candidate.id"
          :pick="p"
          :playing="playingId === p.candidate.id"
          @play="playPick"
          @detail="openPick"
        />
      </div>
      <p v-else-if="empty" class="tonight-empty">
        这个时长里没有能看的片子，换个时长试试。
      </p>
      <p v-else class="tonight-empty">
        选好心情和时长，从你的电影和在追的剧里挑三部。
      </p>
    </div>

    <template #footer>
      <UiButton
        v-if="picks.length"
        icon="refresh"
        label="换一批"
        :loading="busy === 'shuffle'"
        @click="pickMore"
      />
      <UiButton
        variant="primary"
        icon="sparkle"
        label="帮我挑"
        :loading="busy === 'fresh'"
        @click="pickFresh"
      />
    </template>
  </LibrarySheet>
</template>

<script setup lang="ts">
/**
 * 「今晚看什么」面板：心情 chips（可不选）+ 可用时长 + 可选一句话 → 三张推荐卡，可「换一批」。
 * 候选与推荐规则见 tonight-rules.ts / tonight-picks.ts，状态见 use-tonight.ts。
 * 播放：在看的走继续播放记录续播，其余取详情后按条目主播放；详情交回页面打开。
 */
import { ref } from 'vue'

import { UiButton, UiChip, UiInput, toast } from '@/components/ui'
import { vEnter } from '@/directives/enter'

import TonightCard from './TonightCard.vue'
import { NOTE_CHARS, type TonightPick } from './tonight-picks'
import { TONIGHT_MOODS, TONIGHT_TIMES, type TonightTime } from './tonight-rules'
import { playTonightPick } from './tonight-play'
import { useTonight } from './use-tonight'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; 'open-item': [itemId: number] }>()

const {
  mood,
  time,
  note,
  picks,
  busy,
  notice,
  empty,
  toggleMood,
  recommend,
  cancel,
} = useTonight()

const playingId = ref<number | null>(null)

function setTime(next: TonightTime): void {
  time.value = next
}

function pickFresh(): void {
  void recommend(true)
}

function pickMore(): void {
  void recommend(false)
}

function close(): void {
  cancel()
  emit('close')
}

function openAiSettings(): void {
  window.dispatchEvent(new CustomEvent('app:open-settings', { detail: 'ai' }))
}

function openPick(pick: TonightPick): void {
  close()
  emit('open-item', pick.candidate.id)
}

async function playPick(pick: TonightPick): Promise<void> {
  if (playingId.value !== null) return
  playingId.value = pick.candidate.id
  try {
    if (await playTonightPick(pick)) close()
    else toast.warning('没有找到能播放的文件')
  } catch {
    toast.error('无法打开播放器')
  } finally {
    playingId.value = null
  }
}
</script>

<style>
.tonight {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.tonight-filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-6);
}
.tonight-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.tonight-chips .ui-chip {
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-sm);
}
.tonight-notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
.tonight-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-4);
}
.tonight-empty {
  margin: 0;
  padding: var(--space-8) 0;
  font-size: var(--text-sm);
  text-align: center;
  color: var(--text-tertiary);
}
@media (max-width: 720px) {
  .tonight-cards {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
