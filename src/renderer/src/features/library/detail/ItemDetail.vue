<template>
  <div ref="root" class="lib-detail custom-scrollbar" tabindex="-1">
    <div v-if="!node && loading" class="lib-detail-status">正在载入…</div>
    <div v-else-if="!node" class="lib-detail-status">
      {{ error || '条目不存在或已被移除' }}
      <UiButton label="返回" variant="secondary" @click="emit('close')" />
    </div>

    <template v-else>
      <DetailHero
        :node="node"
        :backdrop="backdrop"
        :logo="logo"
        :tagline="tagline"
        :meta-line="metaLine"
        :play-label="playLabel"
        :can-play="Boolean(primaryPlay)"
        :jav="jav"
        :matched="matched"
        :busy="busy"
        :writer-available="writerAvailable"
        :restorable="restore.available.value"
        :restore-running="restore.running.value"
        @close="emit('close')"
        @play="playPrimary"
        @fix-match="emit('fix-match', $event)"
        @toggle-lock="toggleLock"
        @refresh="refreshMetadata"
        @write="writeOut"
        @organize="emit('organize', $event)"
        @restore="restore.start"
      />
      <DetailSeasons
        v-if="seasons.length"
        :node="node"
        :seasons="seasons"
        @play-episode="playEpisode"
      />
      <DetailStills v-if="stills.length" :stills="stills" />
      <DetailPeople
        v-if="people.length"
        :people="people"
        @open-actor="emit('open-actor', $event)"
      />
      <DetailVersions
        v-if="showVersions(node)"
        v-model="versionChoice"
        :node="node"
        @split="splitMember"
        @join="joinMember"
      />
      <DetailInfo :info-rows="infoRows" :files="files" />
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 条目详情（Apple TV 风格）：780w 背景图渐隐、标志或片名、年份 · 时长 · 分级 · 评分、简介，
 * 剧集按季分段与集列表，剧照横滑（点开灯箱），演职员横滑，信息与文件。播放接 openMediaPlayer（播放弹窗 / mpv），
 * 去码接 features/lada（use-restore）。
 *
 * 同一作品在几个文件夹里时引擎已合并成一棵树，DetailVersions 选播放哪个版本 / 来源、拆出误合并的。
 *
 * 本组件管载入、播放与操作；各区块在 DetailHero / DetailSeasons / DetailVersions / DetailPeople / DetailInfo，
 * 纯规则在 detail-rules.ts / version-rules.ts。
 */
import { toast } from '@/components/ui'
import { computed, nextTick, ref, shallowRef, watch } from 'vue'

import type {
  ActorSummary,
  LibraryItemNode,
} from '../../../../../shared/library/ipc'
import UiButton from '@/components/ui/UiButton.vue'

import { errorText, libraryBridge } from '../api/bridge'
import { heroImage, itemImage, tmdbImage } from '../api/images'
import { onLibraryEvent } from '../state/library-events'
import type { LibrarySection } from '../state/library-section'
import { useWriter } from '../writer/use-writer'
import DetailHero from './DetailHero.vue'
import DetailInfo from './DetailInfo.vue'
import DetailPeople from './DetailPeople.vue'
import DetailStills from './DetailStills.vue'
import DetailSeasons from './DetailSeasons.vue'
import DetailVersions from './DetailVersions.vue'
import {
  type ActorLink,
  allVideoFiles,
  infoRowsOf,
  metaLineOf,
  peopleOf,
  personKey,
  playLabelOf,
  sortedSeasons,
  stillsOf,
  titleMetaOf,
} from './detail-rules'
import {
  type PlayRequest,
  episodePlayRequest,
  play,
  primaryPlayRequest,
} from './playback'
import { useRestore } from './use-restore'
import { showVersions } from './version-rules'

const props = defineProps<{
  itemId: number
  /** 所在分区：番号区显示去码、隐藏锁定（见 DetailHero） */
  section?: LibrarySection
}>()
const emit = defineEmits<{
  close: []
  'fix-match': [itemId: number]
  organize: [itemIds: number[]]
  'open-actor': [actorId: number]
}>()

const bridge = libraryBridge()
const { available: writerAvailable, write } = useWriter()
const root = ref<HTMLElement | null>(null)
const node = shallowRef<LibraryItemNode | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const busy = ref<string | null>(null)
/** 选中的版本 / 来源（见 version-rules.ts）；换条目时回到默认 */
const versionChoice = ref<string | null>(null)
/** 合并展示的本地条目 id（含自身）：任何一个变了都要重取，写出 / 刷新也对它们全部做 */
const memberIds = computed(() =>
  node.value
    ? (node.value.merge?.members.map(m => m.itemId) ?? [node.value.id])
    : []
)

async function load(resetView: boolean): Promise<void> {
  if (!bridge) return
  const id = props.itemId
  loading.value = true
  try {
    const item = await bridge.getItem(id)
    if (id !== props.itemId) return
    node.value = item
    error.value = null
    if (resetView) {
      await nextTick()
      root.value?.scrollTo({ top: 0 })
      root.value?.focus({ preventScroll: true })
    }
  } catch (e) {
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}

watch(
  () => props.itemId,
  () => {
    versionChoice.value = null
    void load(true)
  },
  { immediate: true }
)

// 识别 / 刷新元数据完成后，引擎推送 items-changed，详情跟着更新
onLibraryEvent(event => {
  if (
    event.type === 'items-changed' &&
    (event.reset ||
      event.updated.some(
        id => id === props.itemId || memberIds.value.includes(id)
      ))
  ) {
    void load(false)
  }
})

const titleMeta = computed(() => titleMetaOf(node.value))
/** 番号库条目：在番号区打开，或元数据来自番号刮削 */
const jav = computed(
  () => props.section === 'jav' || titleMeta.value?.ref.provider === 'jav'
)
/** 已有匹配：TMDB 条目有 tmdb id，番号条目有番号元数据 */
const matched = computed(() =>
  Boolean(
    node.value?.providerIds.tmdb || titleMeta.value?.ref.provider === 'jav'
  )
)
const restore = useRestore(node, jav)
const stills = computed(() => stillsOf(titleMeta.value))

const backdrop = computed(() => heroImage(node.value?.backdrop ?? null))
const logo = computed(() => node.value?.logo ?? null)
const tagline = computed(() => titleMeta.value?.tagline ?? '')
const seasons = computed(() => sortedSeasons(node.value))
const metaLine = computed(() => metaLineOf(node.value, seasons.value))

// —— 播放 ——
const primaryPlay = computed<PlayRequest | null>(() =>
  node.value ? primaryPlayRequest(node.value, versionChoice.value) : null
)

const playLabel = computed(() => {
  const request = primaryPlay.value
  return playLabelOf(
    node.value?.type,
    request ? request.playlist[request.index].name : null
  )
})

async function startPlayback(request: PlayRequest): Promise<void> {
  const ok = await play(
    request,
    itemImage(node.value?.poster ?? null, 780) ?? undefined
  )
  if (!ok) toast.warning('当前环境无法播放本地文件')
}

function playPrimary(): void {
  if (primaryPlay.value) void startPlayback(primaryPlay.value)
}

function playEpisode(season: LibraryItemNode, ep: LibraryItemNode): void {
  const n = node.value
  if (!n) return
  const request = episodePlayRequest(n, season, ep, versionChoice.value)
  if (request) void startPlayback(request)
}

// 番号库条目：演员库里的演员可点开详情，头像换成本地缓存的；后台查到资料（actors-changed）时重取
const actorLinks = shallowRef<ReadonlyMap<string, ActorLink>>(new Map())
const javItemId = computed(() =>
  titleMeta.value?.ref.provider === 'jav' ? node.value?.id : undefined
)

async function loadActorLinks(): Promise<void> {
  const id = javItemId.value
  if (!id || !bridge?.actors) {
    actorLinks.value = new Map()
    return
  }
  const actors = await bridge.actors.forItem(id).catch((): ActorSummary[] => [])
  if (id !== javItemId.value) return
  actorLinks.value = new Map(
    actors.map((a): [string, ActorLink] => [
      personKey(a.name),
      { id: a.id, photo: itemImage(a.photo, 300) },
    ])
  )
}

watch(javItemId, () => void loadActorLinks(), { immediate: true })
onLibraryEvent(event => {
  if (event.type === 'actors-changed' && javItemId.value) void loadActorLinks()
})
const people = computed(() =>
  peopleOf(titleMeta.value, path => tmdbImage(path), actorLinks.value)
)
const infoRows = computed(() => infoRowsOf(node.value))
const files = computed(() => allVideoFiles(node.value))

// —— 操作 ——
async function run(name: string, task: () => Promise<unknown>): Promise<void> {
  busy.value = name
  try {
    await task()
  } catch (e) {
    toast.error(errorText(e))
  } finally {
    busy.value = null
  }
}

function toggleLock(): void {
  const n = node.value
  if (!n || !bridge) return
  void run('lock', async () => {
    await (n.matchState === 'locked'
      ? bridge.unlockMatch(n.id)
      : bridge.lockMatch(n.id))
    await load(false)
  })
}

function refreshMetadata(): void {
  const n = node.value
  if (!n || !bridge) return
  void run('refresh', async () => {
    await bridge.refreshMetadata({ itemIds: memberIds.value })
    toast.info('已开始重新获取元数据')
  })
}

/** 拆出误合并的一处 / 恢复合并：引擎推送 items-changed 后详情与海报墙重取。 */
function splitMember(itemId: number): void {
  if (!bridge) return
  void run('merge', async () => {
    await bridge.merge.split(itemId)
    versionChoice.value = null
    toast.info('已拆出，单独显示在片库里')
  })
}

function joinMember(itemId: number): void {
  if (!bridge) return
  void run('merge', async () => {
    await bridge.merge.join(itemId)
    toast.info('已恢复合并')
  })
}

function writeOut(): void {
  const n = node.value
  if (!n) return
  void run('write', async () => {
    const failure = await write(memberIds.value)
    if (failure) throw new Error(failure)
    toast.info('已开始写出 NFO 与图片')
  })
}
</script>

<style scoped>
.lib-detail {
  position: absolute;
  inset: 0;
  z-index: var(--z-float);
  overflow-y: auto;
  background: var(--bg-content);
  outline: none;
}
.lib-detail-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  height: 100%;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}
</style>
