<template>
  <section class="amane-film-section amane-film-gallery">
    <h3>
      剧照 <span class="amane-section-count">{{ stills.length }}</span>
      <FieldLock v-if="locked" />
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
  </section>
</template>

<script setup lang="ts">
/**
 * 影片详情的剧照区：缩略图网格 + 全屏预览（左右键切换、原图尺寸、Esc 关闭）。
 * 剧照列表变化（换了影片）时自动关闭预览。
 */
import DialogTitlebar from '@/components/DialogTitlebar.vue'
import { nextTick, ref, watch } from 'vue'
import { UiIconButton, UiPressable } from '@/components/ui'
import { amaneImage } from '../../api/amane'
import { cycleIndex } from '../../utils/film'
import FieldLock from './FieldLock.vue'

const props = defineProps<{ stills: string[]; locked: boolean }>()
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
  if (previewIndex.value === null || !props.stills.length) return
  previewIndex.value = cycleIndex(
    previewIndex.value,
    delta,
    props.stills.length
  )
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

function hideBrokenImage(event: Event): void {
  ;(event.target as HTMLImageElement).style.visibility = 'hidden'
}

watch(() => props.stills, closePreview)
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
