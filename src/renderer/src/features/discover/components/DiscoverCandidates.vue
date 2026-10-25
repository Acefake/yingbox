<template>
  <section class="discover-cands" :aria-label="`${target.title} 的 115 资源`">
    <header class="discover-cands-head">
      <span class="discover-cands-title">
        {{ target.title
        }}<template v-if="target.year"> · {{ target.year }}</template>
      </span>
      <span class="discover-cands-phase" :data-phase="entry?.phase ?? 'none'">
        {{ phaseLabel(entry) }}
      </span>
    </header>

    <UiLoadingDots
      v-if="stage === 'checking' || stage === 'searching'"
      :label="
        stage === 'checking' ? '正在检查 115 与 PanSou…' : '正在找 115 资源…'
      "
    />

    <p v-else-if="message" class="discover-cands-note" role="status">
      {{ message }}
    </p>

    <ul v-if="stage === 'list'" class="discover-cands-list">
      <li
        v-for="(cand, index) in candidates"
        :key="`${index}:${cand.fileName}`"
        class="discover-cand"
      >
        <div class="discover-cand-main">
          <span class="discover-cand-file" :title="cand.fileName">
            {{ cand.fileName }}
          </span>
          <span class="discover-cand-meta">
            {{ cand.score }} 分 · {{ sizeText(cand.size) }} ·
            {{ cand.reasons.join(' · ') }}
          </span>
          <span class="discover-cand-meta" :title="cand.shareTitle">
            来自「{{ cand.shareTitle }}」
          </span>
        </div>
        <UiButton
          size="sm"
          variant="primary"
          label="转存"
          :loading="saving === index"
          :disabled="saving !== null"
          @click="save(index)"
        />
      </li>
    </ul>

    <div class="discover-cands-actions">
      <UiButton
        v-if="stage === 'setup'"
        size="sm"
        variant="primary"
        icon="settings"
        label="去设置"
        @click="openNetdiskSettings"
      />
      <UiButton
        v-if="stage === 'empty' || stage === 'error' || stage === 'setup'"
        size="sm"
        variant="plain"
        icon="refresh"
        label="重新找"
        @click="search"
      />
      <UiButton
        v-if="entry?.phase === 'done' && entry.itemId !== null"
        size="sm"
        variant="primary"
        icon="play"
        label="播放"
        @click="play(entry.itemId)"
      />
      <span v-if="stage === 'list'" class="discover-cands-folder">
        存到 115「{{ folder }}」
      </span>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * 「找 115 资源」候选面板（助手卡片下方与首页豆瓣卡弹窗共用）：
 * 打开即检查前提并搜索；列出前 3 个候选（文件名、分数、体积、加分理由、来源分享），点「转存」才只存那一个文件；
 * 前提缺失时提示去设置 · 网盘；转存后显示「已转存，等待入库」，入库后出现「播放」。
 */
import { computed, onMounted } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiLoadingDots from '@/components/ui/UiLoadingDots.vue'
import { toast } from '@/components/ui/toast'
import { playLibraryItem } from '@/features/library'

import { openNetdiskSettings } from '../api'
import { type DiscoverTitle, sizeText } from '../discover-rules'
import { discoverEntry, phaseLabel } from '../discover-state'
import { useDiscoverCandidates } from '../use-discover-candidates'

const props = defineProps<{ target: DiscoverTitle }>()
const emit = defineEmits<{ played: [] }>()

const { stage, message, candidates, folder, saving, search, save } =
  useDiscoverCandidates(() => props.target)
const entry = computed(() => discoverEntry(props.target))

async function play(itemId: number): Promise<void> {
  if (await playLibraryItem(itemId)) emit('played')
  else toast.warning('没有找到能播放的文件')
}

onMounted(search)
</script>

<style scoped>
.discover-cands {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.discover-cands-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.discover-cands-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.discover-cands-phase,
.discover-cands-note,
.discover-cands-folder,
.discover-cand-meta {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.discover-cands-phase[data-phase='saved'],
.discover-cands-phase[data-phase='done'] {
  color: var(--success);
}

.discover-cands-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.discover-cand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--bg-fill-secondary);
}

.discover-cand-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.discover-cand-file {
  overflow: hidden;
  font-size: var(--text-sm);
  color: var(--text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.discover-cand-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.discover-cands-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.discover-cands-actions:empty {
  display: none;
}
</style>
