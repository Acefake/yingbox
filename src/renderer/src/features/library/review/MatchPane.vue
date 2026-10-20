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
        <h2 class="match-local-title">
          {{ node.title }}
          <span v-if="node.year" class="match-local-year">{{ node.year }}</span>
        </h2>
        <ul class="match-files">
          <li v-for="name in shownFiles" :key="name" :title="name">
            {{ name }}
          </li>
          <li v-if="moreFiles > 0" class="match-files-more">
            另有 {{ moreFiles }} 个文件
          </li>
        </ul>
        <div class="match-state">
          <span class="match-state-pill" :class="`is-${node.matchState}`">
            {{ MATCH_STATE_LABEL[node.matchState] }}
          </span>
          <span v-if="current" class="match-current">
            当前：{{ current.title
            }}<template v-if="current.year">（{{ current.year }}）</template>
          </span>
        </div>
      </section>

      <!-- 候选：前 3 名，左右对照 -->
      <section class="match-candidates-section">
        <div class="match-label">
          {{ searchResults ? '搜索结果' : '候选' }}
          <span class="match-hint">按 1 / 2 / 3 采用</span>
        </div>
        <div v-if="shown.length" class="match-candidates">
          <article
            v-for="(c, i) in shown"
            :key="`${c.kind}:${c.id}`"
            class="match-candidate"
          >
            <div class="match-poster">
              <img
                v-if="c.poster"
                :src="c.poster"
                alt=""
                loading="lazy"
                decoding="async"
                referrerpolicy="no-referrer"
              />
              <span v-else class="match-poster-empty">无海报</span>
              <span class="match-key">{{ i + 1 }}</span>
            </div>
            <div class="match-candidate-body">
              <h3 class="match-candidate-title">{{ c.title }}</h3>
              <p class="match-candidate-sub">
                <span v-if="c.year">{{ c.year }}</span>
                <span v-if="c.originalTitle && c.originalTitle !== c.title">{{
                  c.originalTitle
                }}</span>
              </p>
              <div
                class="match-confidence"
                :class="confidenceClass(c.confidence)"
              >
                <span
                  class="match-confidence-bar"
                  :style="{ width: formatConfidence(c.confidence) }"
                />
                <span class="match-confidence-text"
                  >置信度 {{ formatConfidence(c.confidence) }}</span
                >
              </div>
              <p v-if="c.overview" class="match-overview">{{ c.overview }}</p>
              <p v-else class="match-overview is-empty">没有简介</p>
              <UiButton
                class="match-adopt"
                :variant="i === 0 ? 'primary' : 'secondary'"
                size="sm"
                label="采用"
                :loading="busy === `adopt:${c.id}`"
                :disabled="busy !== null"
                @click="adopt(c)"
              />
            </div>
          </article>
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
        <span v-if="error" class="match-error">{{ error }}</span>
      </footer>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 匹配对照面板：左边本地文件名，右边前 3 名候选（海报、年份、简介摘要、置信度），
 * 一键采用、手动搜索、锁定 / 解锁、重新获取元数据。待确认队列和详情页的“修正匹配”共用。
 */
import { message } from 'ant-design-vue'
import { computed, ref, toRef, watch } from 'vue'

import type { MatchCandidateInfo } from '../../../../../shared/library/ipc'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'

import { libraryBridge } from '../api/bridge'
import { MATCH_STATE_LABEL, formatConfidence } from '../shared/format'
import {
  type ReviewOutcome,
  localFileNames,
  useMatchReview,
} from './use-match-review'

const props = defineProps<{ itemId: number | null }>()
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
} = useMatchReview(toRef(props, 'itemId'), libraryBridge())

const query = ref('')
watch(
  () => props.itemId,
  () => {
    query.value = ''
  }
)

const MAX_FILES = 4
const files = computed(() => localFileNames(node.value))
const shownFiles = computed(() => files.value.slice(0, MAX_FILES))
const moreFiles = computed(() => files.value.length - MAX_FILES)
const current = computed(() => candidates.value?.current ?? null)
const shown = computed(() =>
  (searchResults.value ?? candidates.value?.candidates ?? []).slice(0, 3)
)

/** 置信度分档：≥ 0.8 高，≥ 0.6 中，其余低（颜色提示，阈值与引擎自动匹配线接近）。 */
function confidenceClass(confidence: number): string {
  if (confidence >= 0.8) return 'is-high'
  if (confidence >= 0.6) return 'is-mid'
  return 'is-low'
}

function finish(outcome: ReviewOutcome, done: string): void {
  if (outcome.kind === 'matched' && props.itemId !== null) {
    message.success(done)
    emit('resolved', props.itemId)
  } else if (outcome.kind === 'candidates') {
    message.info(`找到 ${outcome.count} 个候选，请选择`)
  } else if (outcome.kind === 'unmatched') {
    message.warning('没有找到匹配的条目')
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
    message.success(locked ? '已解除锁定' : '已锁定')
    if (!locked && props.itemId !== null) emit('resolved', props.itemId)
  }
}

async function refresh(): Promise<void> {
  const outcome = await refreshMetadata()
  if (outcome.kind === 'matched') message.info('已开始重新获取元数据')
}

/** 1 / 2 / 3 采用对应候选（焦点在输入框里时不拦截）。 */
function onKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement
  if (target.closest('input, textarea, select')) return
  const index = ['1', '2', '3'].indexOf(event.key)
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
.match-local-title {
  margin: 0 0 var(--space-3);
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-tight);
}
.match-local-year {
  margin-left: var(--space-2);
  color: var(--text-tertiary);
  font-weight: var(--font-weight-regular);
}
.match-files {
  margin: 0 0 var(--space-3);
  padding: 0;
  list-style: none;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.8;
}
.match-files li {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.match-files-more {
  color: var(--text-tertiary);
  font-family: var(--font-sans);
}
.match-state {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.match-state-pill {
  padding: var(--space-0_5) var(--space-2);
  border-radius: var(--radius-xs);
  background: var(--bg-fill-secondary);
  color: var(--text-secondary);
  font-weight: var(--font-weight-medium);
}
.match-state-pill.is-review {
  background: color-mix(in srgb, var(--warning) 18%, transparent);
  color: var(--warning);
}
.match-state-pill.is-locked {
  background: var(--accent-soft);
  color: var(--accent-text);
}
.match-candidates {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-5);
}
.match-candidate {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}
.match-poster {
  position: relative;
  aspect-ratio: 2 / 3;
  max-height: 260px;
  overflow: hidden;
  border-radius: var(--radius-md);
  background: var(--bg-fill-secondary);
  box-shadow: var(--shadow-sm);
}
.match-poster img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.match-poster-empty {
  display: grid;
  height: 100%;
  place-items: center;
  color: var(--text-quaternary);
  font-size: var(--text-xs);
}
.match-key {
  position: absolute;
  top: var(--space-2);
  left: var(--space-2);
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  border-radius: var(--radius-xs);
  background: var(--overlay-scrim);
  color: var(--media-text);
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
}
.match-candidate-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}
.match-candidate-title {
  margin: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.match-candidate-sub {
  display: flex;
  gap: var(--space-2);
  margin: 0;
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  white-space: nowrap;
}
.match-confidence {
  position: relative;
  height: 18px;
  overflow: hidden;
  border-radius: var(--radius-xs);
  background: var(--bg-fill-secondary);
}
.match-confidence-bar {
  position: absolute;
  inset: 0 auto 0 0;
  opacity: 0.28;
}
.match-confidence.is-high .match-confidence-bar {
  background: var(--success);
}
.match-confidence.is-mid .match-confidence-bar {
  background: var(--warning);
}
.match-confidence.is-low .match-confidence-bar {
  background: var(--danger);
}
.match-confidence-text {
  position: relative;
  padding: 0 var(--space-2);
  color: var(--text-secondary);
  font-size: var(--text-2xs);
  line-height: 18px;
  font-variant-numeric: tabular-nums;
}
.match-overview {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  line-clamp: 4;
}
.match-overview.is-empty {
  color: var(--text-quaternary);
}
.match-adopt {
  align-self: flex-start;
  margin-top: auto;
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
