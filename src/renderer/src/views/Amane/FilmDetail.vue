<template>
  <article class="amane-film-detail" aria-labelledby="amane-film-title">
    <div class="amane-film-poster">
      <img
        v-if="cover"
        :src="amaneImage(cover.url)"
        alt="影片海报"
        @error="failedCovers = [...failedCovers, cover.url]"
      />
      <span v-else>{{ film.number }}</span>
    </div>
    <div class="amane-film-content">
      <div class="amane-film-summary">
        <p class="amane-film-number">{{ film.number }}</p>
        <h2 id="amane-film-title" :title="film.title || film.number">
          {{ film.title || film.number }}
        </h2>
        <p class="amane-film-meta">
          <span v-if="film.release">{{ film.release.slice(0, 10) }}</span>
          <span
            v-if="film.release && film.runtime"
            class="amane-film-meta-dot"
            aria-hidden="true"
            >·</span
          >
          <span v-if="film.runtime"
            >{{ Math.floor(film.runtime / 60) }}h {{ film.runtime % 60 }}m</span
          >
          <span v-if="film.score != null" class="amane-film-score"
            ><UiIcon name="star" size="sm" filled />{{
              film.score.toFixed(1)
            }}</span
          >
        </p>
        <div class="amane-film-actions">
          <UiButton
            v-if="detail.files.length"
            :disabled="busy"
            icon="play"
            label="播放"
            variant="primary"
            @click="$emit('play', detail.files[0].id)"
          />
          <UiIconButton
            icon="refresh"
            label="重新刮削"
            :disabled="busy"
            variant="secondary"
            @click="$emit('scrape', film.id)"
          />
          <UiIconButton
            v-if="detail.files.length"
            icon="sparkle"
            label="去码"
            :disabled="busy"
            variant="secondary"
            @click="$emit('restore', detail.files[0].id)"
          />
          <UiIconButton
            v-if="detail.files.length"
            :disabled="busy"
            icon="range"
            label="去码一段"
            variant="secondary"
            @click="$emit('range', detail.files[0].id)"
          />
          <UiIconButton
            v-if="detail.files.length"
            :disabled="busy"
            icon="folder"
            label="整理到媒体库目录（写出封面与海报）"
            variant="secondary"
            @click="$emit('organize', detail.files[0].id)"
          />
          <UiIconButton
            v-if="detail.files.length"
            :disabled="busy"
            icon="livePlay"
            label="边跑边看"
            variant="secondary"
            @click="$emit('live', detail.files[0].id)"
          />
        </div>
      </div>

      <dl v-if="facts.length" class="amane-film-facts">
        <div v-for="fact in facts" :key="fact.field">
          <dt>
            {{ fact.label }}
            <span
              v-if="locked(fact.field)"
              v-tooltip="'已锁定，刮削时保留'"
              class="amane-field-lock"
              role="img"
              aria-label="已锁定"
              ><UiIcon name="lock" size="sm"
            /></span>
          </dt>
          <dd>{{ fact.value }}</dd>
        </div>
      </dl>
      <section v-if="film.directors?.length" class="amane-film-section">
        <h3>
          导演
          <span
            v-if="locked('directors')"
            v-tooltip="'已锁定，刮削时保留'"
            class="amane-field-lock"
            role="img"
            aria-label="已锁定"
            ><UiIcon name="lock" size="sm"
          /></span>
        </h3>
        <div class="amane-film-chips">
          <span
            v-for="name in film.directors"
            :key="name"
            class="amane-film-chip director"
            >{{ name }}</span
          ><span v-if="!film.directors?.length" class="amane-muted"
            >暂无导演资料</span
          >
        </div>
      </section>
      <section class="amane-film-section">
        <h3>
          演员
          <span
            v-if="locked('actors')"
            v-tooltip="'已锁定，刮削时保留'"
            class="amane-field-lock"
            role="img"
            aria-label="已锁定"
            ><UiIcon name="lock" size="sm"
          /></span>
        </h3>
        <div class="amane-film-chips">
          <UiChip
            v-for="name in film.actors"
            :key="name"
            class="amane-film-chip actor"
            :disabled="!detail.actor_ids[name]"
            @click="$emit('actor', { id: detail.actor_ids[name], name })"
          >
            <template #leading
              ><span
                v-if="detail.actor_genders?.[name] === 'female'"
                aria-label="女"
                >♀</span
              ><span
                v-else-if="detail.actor_genders?.[name] === 'male'"
                aria-label="男"
                >♂</span
              ></template
            >
            {{ name }}</UiChip
          ><span v-if="!film.actors.length" class="amane-muted"
            >暂无演员资料</span
          >
        </div>
      </section>
      <section class="amane-film-section">
        <h3>
          标签
          <span
            v-if="locked('tags')"
            v-tooltip="'已锁定，刮削时保留'"
            class="amane-field-lock"
            role="img"
            aria-label="已锁定"
            ><UiIcon name="lock" size="sm"
          /></span>
        </h3>
        <div class="amane-film-chips">
          <UiChip
            v-for="name in film.tags"
            :key="name"
            class="amane-film-chip"
            :label="name"
            :disabled="!detail.tag_ids[name]"
            @click="$emit('tag', name, detail.tag_ids[name])"
          /><span v-if="!film.tags.length" class="amane-muted">暂无标签</span>
        </div>
      </section>
      <section class="amane-film-section">
        <h3>用户标签</h3>
        <div class="amane-film-chips">
          <span
            v-for="tag in detail.user_tags"
            :key="tag.id"
            class="amane-film-chip user-tag"
            >{{ tag.name
            }}<UiIconButton
              icon="close"
              size="sm"
              :label="`移除标签 ${tag.name}`"
              :disabled="tagBusy"
              @click="removeTag(tag.id)"
          /></span>
          <UiIconButton
            :icon="editingTags ? 'close' : 'plus'"
            :label="editingTags ? '收起标签编辑' : '添加用户标签'"
            :aria-expanded="editingTags"
            @click="editingTags = !editingTags"
          />
        </div>
        <form
          v-if="editingTags"
          class="amane-tag-form"
          @submit.prevent="addTag"
        >
          <UiInput
            v-model="tagName"
            aria-label="用户标签名称"
            placeholder="输入标签名称"
            maxlength="100"
          /><UiButton
            type="submit"
            label="添加"
            :disabled="tagBusy || !tagName.trim()"
          />
        </form>
        <p v-if="tagError" class="amane-task-error" role="alert">
          {{ tagError }}
        </p>
      </section>
      <section class="amane-film-section">
        <h3>来源链接</h3>
        <div class="amane-film-chips">
          <a
            v-for="link in sources"
            :key="link.name"
            class="amane-film-source"
            :href="link.url"
            target="_blank"
            rel="noopener noreferrer"
            >{{ link.name }} <UiIcon name="externalLink" size="sm" /></a
          ><span v-if="!sources.length" class="amane-muted">暂无来源链接</span>
        </div>
      </section>
      <section v-if="film.plot" class="amane-film-section">
        <h3>
          简介
          <span
            v-if="locked('plot')"
            v-tooltip="'已锁定，刮削时保留'"
            class="amane-field-lock"
            role="img"
            aria-label="已锁定"
            ><UiIcon name="lock" size="sm"
          /></span>
        </h3>
        <p class="amane-film-plot">{{ film.plot }}</p>
      </section>
      <section class="amane-film-section amane-film-gallery">
        <h3>
          剧照 <span class="amane-section-count">{{ stills.length }}</span>
          <span
            v-if="locked('extrafanart')"
            v-tooltip="'已锁定，刮削时保留'"
            class="amane-field-lock"
            role="img"
            aria-label="已锁定"
            ><UiIcon name="lock" size="sm"
          /></span>
        </h3>
        <div v-if="stills.length" class="amane-film-stills">
          <UiPressable
            v-for="(image, index) in stills"
            :key="image"
            block
            class="amane-still-open"
            :label="`放大剧照 ${index + 1}`"
            @click="openPreview(index)"
          >
            <img
              :src="amaneImage(image)"
              :alt="`剧照 ${index + 1}`"
              loading="lazy"
              @error="hideBrokenImage"
            />
          </UiPressable>
        </div>
        <p v-else class="amane-muted">暂无剧照</p>
      </section>
    </div>
    <dialog
      ref="previewDialog"
      class="amane-still-preview"
      aria-label="剧照预览"
      @cancel.prevent="closePreview"
      @keydown.stop="previewKeydown"
      @click.self="closePreview"
    >
      <template v-if="previewIndex !== null">
        <DialogTitlebar
          :title="`剧照 ${previewIndex + 1} / ${stills.length}`"
          icon="image"
          @close="closePreview"
        >
          <template #actions
            ><UiIconButton
              icon="fullscreen"
              label="原图尺寸"
              :active="originalSize"
              @click="originalSize = !originalSize"
          /></template>
        </DialogTitlebar>
        <div
          class="amane-still-preview-stage"
          :class="{ 'original-size': originalSize }"
          @click.self="closePreview"
        >
          <p v-if="previewError" role="alert">图片加载失败，请关闭后重试。</p>
          <img
            v-else
            :key="stills[previewIndex]"
            :src="amaneImage(stills[previewIndex])"
            :alt="`剧照 ${previewIndex + 1}`"
            @error="previewError = true"
          />
        </div>
        <footer v-if="stills.length > 1" class="amane-still-preview-navigation">
          <UiIconButton
            icon="back"
            label="上一张剧照"
            variant="overlay"
            size="lg"
            @click="stepPreview(-1)"
          />
          <UiIconButton
            icon="forward"
            label="下一张剧照"
            variant="overlay"
            size="lg"
            @click="stepPreview(1)"
          />
        </footer>
      </template>
    </dialog>
  </article>
</template>

<script setup lang="ts">
import DialogTitlebar from '@/components/DialogTitlebar.vue'
import { computed, nextTick, ref, watch } from 'vue'
import {
  UiButton,
  UiChip,
  UiIcon,
  UiIconButton,
  UiInput,
  UiPressable,
  vTooltip,
} from '@/components/ui'
import {
  type AmaneDetail,
  type AmaneUserTag,
  amaneImage,
  amaneRequest,
} from '@/api/amane'

const props = defineProps<{ detail: AmaneDetail; busy: boolean }>()
const emit = defineEmits<{
  play: [id: number]
  restore: [id: number]
  range: [id: number]
  organize: [id: number]
  live: [id: number]
  scrape: [id: number]
  actor: [actor: { id: number; name: string }]
  tag: [name: string, id: number]
  tagsChanged: [id: number, tags: AmaneUserTag[]]
}>()
const film = computed(() => props.detail.metadata)
const failedCovers = ref<string[]>([])
const cover = computed(() => {
  const posters = [film.value.poster_url, ...(film.value.poster_urls || [])]
  const url = posters.find(url => url && !failedCovers.value.includes(url))
  return url ? { url } : null
})
watch(
  () => film.value.id,
  () => {
    failedCovers.value = []
  }
)
const locked = (field: string): boolean =>
  Boolean(film.value.locked_fields?.includes(field))
const facts = computed(() =>
  [
    { field: 'studio', label: '制作商', value: film.value.studio || '—' },
    { field: 'publisher', label: '发行商', value: film.value.publisher || '—' },
    ...(film.value.series
      ? [{ field: 'series', label: '系列', value: film.value.series }]
      : []),
  ].filter(fact => fact.value !== '—')
)
const sources = computed(() =>
  Object.entries(film.value.source_urls || {}).flatMap(([name, raw]) => {
    if (typeof raw !== 'string') return []
    try {
      const url = new URL(raw)
      return ['http:', 'https:'].includes(url.protocol)
        ? [{ name, url: url.href }]
        : []
    } catch {
      return []
    }
  })
)
const stills = computed(() => {
  const primary = film.value.extrafanart || []
  const images = primary.length
    ? primary
    : Object.values(film.value.extrafanart_urls || {}).flat()
  return [...new Set(images)].filter(
    image => typeof image === 'string' && amaneImage(image)
  )
})
const editingTags = ref(false),
  tagName = ref(''),
  tagBusy = ref(false),
  tagError = ref('')
const previewDialog = ref<HTMLDialogElement | null>(null)
const previewIndex = ref<number | null>(null),
  originalSize = ref(false),
  previewError = ref(false)

async function openPreview(index: number): Promise<void> {
  previewIndex.value = index
  originalSize.value = false
  previewError.value = false
  await nextTick()
  if (previewIndex.value !== null && !previewDialog.value?.open)
    previewDialog.value?.showModal()
}

function closePreview(): void {
  previewDialog.value?.close()
  previewIndex.value = null
}

function stepPreview(delta: number): void {
  if (previewIndex.value === null || !stills.value.length) return
  previewIndex.value =
    (previewIndex.value + delta + stills.value.length) % stills.value.length
  originalSize.value = false
  previewError.value = false
}

function previewKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    closePreview()
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    stepPreview(-1)
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    stepPreview(1)
  }
}

watch(stills, closePreview)
watch(
  () => film.value.id,
  () => {
    closePreview()
    editingTags.value = false
    tagName.value = ''
    tagError.value = ''
  }
)

async function updateTag(
  action: 'attach' | 'detach',
  id?: number
): Promise<void> {
  if (tagBusy.value) return
  const metadataId = film.value.id
  tagBusy.value = true
  tagError.value = ''
  try {
    let tag: AmaneUserTag | undefined
    if (action === 'attach') {
      const result = await amaneRequest<{ items: AmaneUserTag[] }>(
        '/facets/user_tag',
        'POST',
        { names: [tagName.value.trim()] }
      )
      tag = result.items[0]
      if (!tag) throw new Error('未能创建用户标签，请重试')
      id = tag.id
    }
    await amaneRequest('/metadata/batch/user-tags', 'POST', {
      ids: [metadataId],
      user_tag_ids: [id],
      action,
    })
    if (metadataId !== film.value.id) return
    const tags = props.detail.user_tags || []
    emit(
      'tagsChanged',
      metadataId,
      action === 'detach'
        ? tags.filter(item => item.id !== id)
        : tags.some(item => item.id === id)
          ? tags
          : [...tags, tag!]
    )
    tagName.value = ''
  } catch (e) {
    if (metadataId === film.value.id) tagError.value = (e as Error).message
  } finally {
    tagBusy.value = false
  }
}

function addTag(): void {
  if (tagName.value.trim()) void updateTag('attach')
}

function removeTag(id: number): void {
  void updateTag('detach', id)
}

function hideBrokenImage(event: Event): void {
  ;(event.target as HTMLImageElement).style.visibility = 'hidden'
}
</script>

<style scoped>
/* 剧照为 UiPressable block（已提供焦点环和按压反馈） */
.amane-still-open {
  border-radius: var(--radius-sm);
  background: var(--bg-fill-secondary);
  cursor: zoom-in;
  overflow: hidden;
}
.amane-still-preview {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  margin: 0;
  padding: 0;
  border: 0;
  background: var(--overlay-scrim-strong);
  color: var(--media-text);
}
.amane-still-preview[open] {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.amane-still-preview::backdrop {
  background: var(--overlay-scrim);
}
.amane-still-preview-stage {
  padding: 16px;
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: auto;
}
.amane-still-preview-stage img {
  display: block;
  margin: auto;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  flex-shrink: 0;
}
.amane-still-preview-stage.original-size img {
  max-width: none;
  max-height: none;
}
.amane-still-preview-stage p {
  margin: auto;
}
.amane-still-preview-navigation {
  padding: 0 16px 16px;
  display: flex;
  justify-content: center;
  gap: 16px;
  flex-shrink: 0;
}
</style>
