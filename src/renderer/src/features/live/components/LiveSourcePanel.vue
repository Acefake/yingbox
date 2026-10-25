<template>
  <section class="live-sources" aria-label="直播源">
    <form class="live-sources-form" @submit.prevent="submitUrl">
      <UiInput
        v-model="url"
        class="live-sources-url"
        icon="link"
        placeholder="播放列表地址（m3u / m3u8 / txt）"
        aria-label="播放列表地址"
      />
      <UiInput
        v-model="epgUrl"
        class="live-sources-epg"
        placeholder="节目单地址（可选，XMLTV / .xml.gz）"
        aria-label="节目单地址"
      />
      <UiButton
        type="submit"
        variant="primary"
        icon="plus"
        label="添加"
        :loading="adding"
        :disabled="!url.trim()"
      />
      <UiButton icon="file" label="本地文件" @click="addFile" />
    </form>
    <p v-if="formError" class="live-sources-error" role="alert">
      {{ formError }}
    </p>

    <p v-if="!sources.length" class="live-sources-empty">
      还没有直播源。添加 m3u / m3u8 播放列表地址、选择本地 m3u / txt
      文件，或订阅下面的推荐源。
    </p>

    <section class="live-presets" aria-labelledby="live-presets-title">
      <h3 id="live-presets-title" class="live-presets-title">推荐源</h3>
      <ul class="live-presets-list">
        <li v-for="preset in LIVE_PRESETS" :key="preset.id" class="live-preset">
          <div class="live-preset-text">
            <p class="live-preset-name">
              {{ preset.name }}
              <span class="live-preset-tag">{{
                networkLabel(preset.network)
              }}</span>
            </p>
            <p class="live-preset-desc">{{ preset.description }}</p>
          </div>
          <UiButton
            v-if="isPresetSubscribed(preset, sources)"
            size="sm"
            variant="plain"
            label="已订阅"
            disabled
          />
          <UiButton
            v-else
            size="sm"
            label="订阅"
            :loading="subscribing === preset.id"
            :disabled="Boolean(subscribing) && subscribing !== preset.id"
            @click="subscribe(preset)"
          />
        </li>
      </ul>
      <p class="live-presets-note">源来自公开项目，可用性随网络而变。</p>
    </section>

    <ul v-if="sources.length" class="live-sources-list">
      <li v-for="source in sources" :key="source.id" class="live-source">
        <UiSwitch
          :model-value="source.enabled"
          :label="source.enabled ? '禁用直播源' : '启用直播源'"
          @update:model-value="value => setEnabled(source.id, value)"
        />
        <div class="live-source-text">
          <p class="live-source-name">{{ source.name }}</p>
          <p
            class="live-source-meta"
            :class="{ 'is-error': errors[source.id] }"
          >
            {{ describe(source) }}
          </p>
          <UiInput
            :value="source.epgUrl"
            class="live-source-epg"
            size="sm"
            variant="filled"
            :placeholder="epgPlaceholder(source)"
            aria-label="节目单地址"
            @change="onEpgChange(source, $event)"
          />
        </div>
        <UiIconButton
          icon="refresh"
          label="刷新"
          :loading="loading[source.id]"
          @click="refresh(source.id)"
        />
        <UiIconButton
          icon="trash"
          label="删除直播源"
          danger
          @click="confirmRemove(source)"
        />
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
/**
 * 直播源管理：添加远程地址或本地文件，订阅推荐源，逐个启用 / 禁用、手动刷新、填节目单地址、删除。
 * 推荐源（utils/live-presets）一点即订阅，走与手动添加相同的 addUrl；地址已在列表里的显示「已订阅」。
 * 状态在 useLiveSources（模块单例），这里只是表单与列表。
 */
import { ref } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import { confirmDialog } from '@/components/ui/confirm'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import { toast } from '@/components/ui/toast'

import { useLiveSources } from '../composables/use-live-sources'
import {
  LIVE_PRESETS,
  type LivePreset,
  isPresetSubscribed,
  networkLabel,
} from '../utils/live-presets'
import type { LiveSource } from '../utils/live-rules'

const live = useLiveSources()
const { sources, errors, loading, parsed } = live

const url = ref('')
const epgUrl = ref('')
const adding = ref(false)
const formError = ref('')
/** 正在订阅的推荐源 id（一次只订阅一个） */
const subscribing = ref('')

async function submitUrl(): Promise<void> {
  if (adding.value) return
  adding.value = true
  formError.value = ''
  try {
    const error = await live.addUrl(url.value, epgUrl.value)
    if (error) {
      formError.value = error
      return
    }
    url.value = ''
    epgUrl.value = ''
  } finally {
    adding.value = false
  }
}

async function subscribe(preset: LivePreset): Promise<void> {
  if (subscribing.value) return
  subscribing.value = preset.id
  formError.value = ''
  try {
    const error = await live.addUrl(preset.url, preset.epgUrl, preset.name)
    if (error) formError.value = error
  } finally {
    subscribing.value = ''
  }
}

async function addFile(): Promise<void> {
  formError.value = (await live.addFile()) ?? ''
}

function setEnabled(id: string, enabled: boolean): void {
  live.setEnabled(id, enabled)
}

function refresh(id: string): void {
  void live.refresh(id).then(ok => {
    if (ok) toast.success('直播源已刷新')
  })
}

function describe(source: LiveSource): string {
  const error = errors.value[source.id]
  if (error) return `加载失败：${error}`
  const playlist = parsed.value[source.id]
  const where = source.kind === 'file' ? '本地文件' : source.location
  if (!playlist) return source.enabled ? `${where} · 加载中` : where
  return `${where} · ${playlist.channels.length} 个频道`
}

function epgPlaceholder(source: LiveSource): string {
  const header = parsed.value[source.id]?.epgUrls[0]
  return header ? `节目单：使用播放列表自带（${header}）` : '节目单地址（可选）'
}

function onEpgChange(source: LiveSource, event: Event): void {
  const value = (event.target as HTMLInputElement | null)?.value ?? ''
  if (value.trim() !== source.epgUrl) live.update(source.id, { epgUrl: value })
}

async function confirmRemove(source: LiveSource): Promise<void> {
  const ok = await confirmDialog({
    title: '删除直播源',
    content: `删除「${source.name}」？收藏的频道会保留。`,
    okText: '删除',
    danger: true,
  })
  if (ok) live.remove(source.id)
}
</script>

<style scoped>
.live-sources {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
}

.live-sources-form {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.live-sources-url {
  flex: 2 1 280px;
}

.live-sources-epg {
  flex: 1 1 220px;
}

.live-sources-error,
.live-source-meta.is-error {
  color: var(--danger);
}

.live-sources-error,
.live-sources-empty {
  margin: 0;
  font-size: var(--text-sm);
}

.live-sources-empty {
  color: var(--text-tertiary);
}

.live-sources-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.live-source {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  border-top: 1px solid var(--separator);
}

.live-source:first-child {
  border-top: 0;
}

.live-source-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  gap: var(--space-1);
}

.live-source-name {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
}

.live-source-meta {
  margin: 0;
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.live-source-epg {
  max-width: 480px;
}

.live-presets {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.live-presets-title {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
}

.live-presets-list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.live-preset {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  border-top: 1px solid var(--separator);
}

.live-preset:first-child {
  border-top: 0;
}

.live-preset-text {
  flex: 1;
  min-width: 0;
}

.live-preset-name,
.live-preset-desc,
.live-presets-note {
  margin: 0;
}

.live-preset-name {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
}

.live-preset-tag {
  padding: 0 var(--space-1);
  border-radius: var(--radius-sm);
  background: var(--bg-fill-secondary);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-regular);
}

.live-preset-desc,
.live-presets-note {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
</style>
