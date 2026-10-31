<template>
  <div class="match-pane" @keydown="onKeydown">
    <div v-if="loading && !node" class="match-status">正在载入…</div>
    <div v-else-if="!node" class="match-status">
      {{ error || '选择左侧条目开始确认' }}
    </div>

    <template v-else>
      <!-- 本地：文件名是判断的依据 -->
      <section class="match-local">
        <div class="match-label">本地文件</div>
        <MatchLocal :node="node" :current="current" />
      </section>

      <!-- 候选：前 3 名，左右对照 -->
      <section class="match-candidates-section">
        <div class="match-label">
          {{ searchResults ? '搜索结果' : '候选' }}
          <span class="match-hint">按 1 / 2 / 3 采用</span>
        </div>
        <div v-if="shown.length" class="match-candidates">
          <MatchCandidate
            v-for="(c, i) in shown"
            :key="`${c.kind}:${c.id}`"
            :candidate="c"
            :index="i"
            :busy="busy"
            @adopt="adopt"
          />
        </div>
        <p v-else class="match-empty">
          {{
            searchResults
              ? '没有找到匹配的条目，换个片名或直接输入 TMDB 编号'
              : '没有候选。试试用片名或 TMDB 编号手动搜索'
          }}
        </p>
      </section>

      <!-- 手动搜索 -->
      <form class="match-search" @submit.prevent="runSearch">
        <UiInput
          v-model="query"
          class="match-search-input"
          icon="search"
          clearable
          aria-label="手动搜索"
          placeholder="片名（可带年份）、TMDB 编号或 IMDb 编号"
        />
        <UiButton
          type="submit"
          label="搜索"
          :loading="busy === 'search'"
          :disabled="!query.trim() || busy !== null"
        />
      </form>

      <footer class="match-actions">
        <UiButton
          v-if="mixedLibrary"
          variant="plain"
          size="sm"
          :label="node.type === 'movie' ? '设为剧集' : '设为电影'"
          :disabled="busy !== null"
          @click="changeKind"
        />
        <UiButton
          variant="plain"
          size="sm"
          :icon="node.matchState === 'locked' ? 'lock' : 'pin'"
          :label="node.matchState === 'locked' ? '解除锁定' : '锁定当前匹配'"
          :disabled="!node.providerIds.tmdb || busy !== null"
          :loading="busy === 'lock' || busy === 'unlock'"
          @click="toggleLock"
        />
        <UiButton
          variant="plain"
          size="sm"
          icon="refresh"
          label="重新获取元数据"
          :disabled="!node.providerIds.tmdb || busy !== null"
          :loading="busy === 'refresh'"
          @click="refresh"
        />
        <AiIdentifyButton
          v-if="ai && stateSupportsAi(node.matchState)"
          :scope="{ itemIds: [node.id] }"
          label="用 AI 识别"
          :disabled="busy !== null"
          @done="reload"
        />
        <span v-if="error" class="match-error">{{ error }}</span>
      </footer>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 匹配对照面板：左边本地文件名，右边前 3 名候选（海报、年份、简介摘要、置信度），
 * 一键采用、手动搜索、锁定 / 解锁、重新获取元数据，待确认队列里还可以「用 AI 识别」。
 * 待确认队列和详情页的“修正匹配”共用。
 *
 * 本地一侧见 MatchLocal，候选卡片见 MatchCandidate，纯规则在 match-rules.ts。
 */
import { confirmDialog, toast } from '@/components/ui'
import {
  playerSession,
  replaceLibraryContinue,
  useMpvPlayer,
} from '@/features/player'
import { computed, ref, toRef, watch } from 'vue'

import type { MatchCandidateInfo } from '../../../../../shared/library/ipc'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'

import AiIdentifyButton from '../ai-scrape/AiIdentifyButton.vue'
import { stateSupportsAi } from '../ai-scrape/ai-scrape-rules'
import { libraryBridge } from '../api/bridge'
import { findLibrary } from '../state/use-libraries'
import {
  ensureProgressFlushed,
  refreshReclassifiedProgress,
} from '../progress/progress-cache'
import { refreshContinueForItem } from '../progress/continue-source'
import MatchCandidate from './MatchCandidate.vue'
import MatchLocal from './MatchLocal.vue'
import { SHOWN_CANDIDATES, candidateKeyIndex } from './match-rules'
import { type ReviewOutcome, useMatchReview } from './use-match-review'

const props = defineProps<{
  itemId: number | null
  /** 显示「用 AI 识别」（待确认队列里、非番号分区、桌面端）。 */
  ai?: boolean
}>()
const emit = defineEmits<{
  /** 条目已确认（采用 / 搜索命中 / 锁定）：队列据此跳到下一条。 */
  resolved: [itemId: number]
}>()

const {
  node,
  candidates,
  searchResults,
  loading,
  busy,
  error,
  adopt: adoptCandidate,
  search,
  setLocked,
  refreshMetadata,
  reload,
} = useMatchReview(toRef(props, 'itemId'), libraryBridge())

const query = ref('')
const mpv = useMpvPlayer()
watch(
  () => props.itemId,
  () => {
    query.value = ''
  }
)
const current = computed(() => candidates.value?.current ?? null)
const mixedLibrary = computed(
  () => node.value && findLibrary(node.value.libraryId)?.mixed
)
const shown = computed(() =>
  (searchResults.value ?? candidates.value?.candidates ?? []).slice(
    0,
    SHOWN_CANDIDATES
  )
)

function finish(outcome: ReviewOutcome, done: string): void {
  if (outcome.kind === 'matched' && props.itemId !== null) {
    toast.success(done)
    emit('resolved', props.itemId)
  } else if (outcome.kind === 'candidates') {
    toast.info(`找到 ${outcome.count} 个候选，请选择`)
  } else if (outcome.kind === 'unmatched') {
    toast.warning('没有找到匹配的条目')
  }
}

async function adopt(candidate: MatchCandidateInfo): Promise<void> {
  finish(
    await adoptCandidate(candidate),
    `已匹配为「${candidate.title}」并锁定`
  )
}

async function runSearch(): Promise<void> {
  if (!query.value.trim()) return
  finish(await search(query.value), '已匹配并锁定')
}

async function toggleLock(): Promise<void> {
  const locked = node.value?.matchState === 'locked'
  const outcome = await setLocked(!locked)
  if (outcome.kind === 'matched') {
    toast.success(locked ? '已解除锁定' : '已锁定')
    if (!locked && props.itemId !== null) emit('resolved', props.itemId)
  }
}

async function refresh(): Promise<void> {
  const outcome = await refreshMetadata()
  if (outcome.kind === 'matched') toast.info('已开始重新获取元数据')
}

function changeKind(): void {
  const item = node.value
  if (!item) return
  const kind = item.type === 'movie' ? 'tv' : 'movie'
  const collectIds = (node: typeof item): number[] => [
    node.id,
    ...node.children.flatMap(collectIds),
  ]
  const oldIds = collectIds(item)
  const label = kind === 'movie' ? '电影' : '剧集'
  void confirmDialog({
    title: `设为${label}？`,
    content:
      '请先停止播放此条目。操作会清除当前匹配并保留已保存的观看进度，之后可重新匹配。',
    okText: '确认修改',
    onOk: async () => {
      if (playerSession().value || mpv.isRunning.value)
        throw new Error('请先关闭播放器，再纠正类型')
      await ensureProgressFlushed()
      if (playerSession().value || mpv.isRunning.value)
        throw new Error('请先关闭播放器，再纠正类型')
      await libraryBridge()!.reclassifyItem(item.id, kind)
      replaceLibraryContinue(item.id, kind === 'movie' ? 'movie' : 'tv', null)
      try {
        await Promise.all([
          refreshReclassifiedProgress(item.id, oldIds),
          refreshContinueForItem(item.id),
        ])
      } catch {
        toast.warning('类型已更新，播放进度刷新失败，请重新打开页面')
      }
      toast.success(`已设为${label}`)
      emit('resolved', item.id)
    },
  })
}

/** 1 / 2 / 3 采用对应候选（焦点在输入框里时不拦截）。 */
function onKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement
  if (target.closest('input, textarea, select')) return
  const index = candidateKeyIndex(event.key)
  if (index < 0 || busy.value) return
  const candidate = shown.value[index]
  if (candidate) {
    event.preventDefault()
    void adopt(candidate)
  }
}
</script>

<style scoped>
.match-pane {
  display: flex;
  flex-direction: column;
  gap: var(--space-7);
  min-width: 0;
  outline: none;
}
.match-status {
  display: grid;
  min-height: 240px;
  place-items: center;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}
.match-label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: var(--space-3);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
}
.match-hint {
  color: var(--text-quaternary);
  font-weight: var(--font-weight-regular);
}
.match-candidates {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-5);
}
.match-empty {
  margin: 0;
  padding: var(--space-6) 0;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}
.match-search {
  display: flex;
  gap: var(--space-2);
}
.match-search-input {
  flex: 1 1 auto;
}
.match-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding-top: var(--space-4);
  border-top: 1px solid var(--separator);
}
.match-error {
  color: var(--danger);
  font-size: var(--text-xs);
}
</style>
