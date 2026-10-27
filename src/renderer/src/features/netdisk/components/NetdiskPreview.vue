<template>
  <dialog
    ref="dialogEl"
    class="netdisk-preview yb-glass"
    :aria-labelledby="titleId"
    @cancel.prevent="emit('close')"
    @keydown="guardDialogEscape"
    @pointerdown="pressedOnBackdrop = $event.target === $event.currentTarget"
    @click.self="closeFromBackdrop"
  >
    <!-- 内容包一层：点在浮层内边距上不算点外面（只有背景幕的点击落在 dialog 自身） -->
    <div class="netdisk-preview-body">
      <header class="netdisk-preview-head">
        <div class="netdisk-preview-heading">
          <h2 :id="titleId" class="netdisk-preview-title">分享内容</h2>
          <p class="netdisk-preview-sub" :title="snap?.title || item.title">
            {{ snap?.title || item.title }}
          </p>
        </div>
        <UiIconButton
          class="netdisk-preview-close"
          icon="close"
          label="关闭"
          size="sm"
          @click="emit('close')"
        />
      </header>

      <p v-if="loading" class="netdisk-preview-note" role="status">
        正在读取分享…
      </p>
      <template v-else-if="snap">
        <p class="netdisk-preview-count">共 {{ snap.count }} 项</p>
        <ul ref="filesEl" class="netdisk-preview-files">
          <li
            v-for="file in snap.files"
            :key="file.id"
            class="netdisk-preview-file"
            :class="{ 'is-episode': isEpisode(file) }"
            :aria-current="isEpisode(file) ? 'true' : undefined"
          >
            <UiIcon
              class="netdisk-preview-icon"
              :name="file.isDir ? 'folder' : 'file'"
              size="sm"
            />
            <span class="netdisk-preview-name" :title="file.name">{{
              file.name
            }}</span>
            <span class="netdisk-preview-size">{{
              formatBytes(file.size)
            }}</span>
          </li>
          <li
            v-if="snap.count > snap.files.length"
            class="netdisk-preview-more"
          >
            还有 {{ snap.count - snap.files.length }} 项，转存时一并保存
          </li>
        </ul>
      </template>

      <footer class="netdisk-preview-actions">
        <!-- 打开时焦点在「取消」：转存只能由用户显式点按，误按 Enter 只会关掉浮层 -->
        <UiButton
          ref="cancelButton"
          class="netdisk-preview-cancel"
          label="取消"
          autofocus
          @click="emit('close')"
        />
        <!-- 读取中禁用（先看到文件再转存）；转存中用 loading，按钮保持可聚焦 -->
        <UiButton
          class="netdisk-preview-save"
          icon="download"
          :label="saved ? '已转存' : '转存到我的 115'"
          :disabled="saved || loading"
          :loading="saving"
          @click="emit('save')"
        />
      </footer>
    </div>
  </dialog>
</template>

<script setup lang="ts">
/**
 * 网盘页的分享预览浮层（原生 <dialog> 模态，玻璃材质）：当前查看的分享的顶层文件与大小，可直接转存或关闭。
 * Esc、点浮层外、取消、关闭按钮都收起；放在结果列表之外，结果行保持等高（虚拟列表要求）。
 * 打开时聚焦「取消」，转存必须用户自己点按；转存完成后按钮禁用，焦点挪到「取消」不丢到 body。
 * 搜索词带集号时（episode），那一集的文件高亮并滚进视野（转存仍是整个分享）。
 */
import {
  type ComponentPublicInstance,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch,
} from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import { guardDialogEscape } from '@/composables/use-escape-layer'
import type {
  NetdiskItem,
  ShareSnap,
} from '../../../../../shared/contract/pan115'
import { fileIsEpisode } from '../../../../../shared/netdisk/episode-hint'
import type { EpisodeTarget } from '../../../../../shared/netdisk/search-intent'

import { formatBytes } from '../utils/netdisk-rules'

const props = defineProps<{
  item: NetdiskItem
  snap: ShareSnap | null
  loading: boolean
  saving: boolean
  saved: boolean
  /** 要找的那一集；搜索词没写集号为 null */
  episode?: EpisodeTarget | null
}>()
const emit = defineEmits<{ save: []; close: [] }>()

const titleId = useId()
const dialogEl = ref<HTMLDialogElement | null>(null)
const cancelButton = ref<ComponentPublicInstance | null>(null)
onMounted(() => dialogEl.value?.showModal())
onBeforeUnmount(() => dialogEl.value?.close())

const filesEl = ref<HTMLElement | null>(null)

/** 这个文件是不是要找的那一集（分享标题补季号） */
function isEpisode(file: ShareSnap['files'][number]): boolean {
  if (!props.episode || file.isDir) return false
  const folder = props.snap?.title || props.item.title
  return fileIsEpisode(file.name, props.episode, folder)
}

// 读到文件后把那一集滚进视野
watch(
  () => props.snap,
  async snap => {
    if (!snap || !props.episode) return
    await nextTick()
    filesEl.value
      ?.querySelector('.is-episode')
      ?.scrollIntoView({ block: 'nearest' })
  },
  { immediate: true }
)

/** 按下点是否就在背景幕上：从文件行拖选到背景幕松手时 click 也落在 dialog 上，不能算点外面 */
const pressedOnBackdrop = ref(false)

function closeFromBackdrop(): void {
  if (pressedOnBackdrop.value) emit('close')
  pressedOnBackdrop.value = false
}

/** 转存完成、按钮变禁用时，焦点若停在禁用按钮上或已丢出浮层，就放回「取消」 */
watch(
  () => props.saved,
  saved => {
    const dialog = dialogEl.value
    const active = document.activeElement as HTMLButtonElement | null
    if (!saved || !dialog) return
    if (active && dialog.contains(active) && !active.disabled) return
    const cancel = cancelButton.value?.$el as HTMLElement | undefined
    cancel?.focus()
  },
  { flush: 'post' }
)
</script>

<style scoped>
.netdisk-preview {
  box-sizing: border-box;
  width: min(600px, calc(100vw - var(--space-8)));
  max-height: min(600px, calc(100vh - var(--space-10)));
  margin: auto;
  padding: 0;
  border: 0;
  border-radius: var(--radius-2xl);
  color: var(--text-primary);
  font-family: var(--font-sans);
}
.netdisk-preview-body {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  max-height: inherit;
  padding: var(--space-5) var(--space-5) var(--space-4);
}
.netdisk-preview::backdrop {
  background: var(--overlay-scrim-soft);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.netdisk-preview-head {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  margin-bottom: var(--space-3_5);
}
.netdisk-preview-heading {
  flex: 1;
  min-width: 0;
}
.netdisk-preview-title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
}
.netdisk-preview-sub {
  margin: var(--space-0_5) 0 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.netdisk-preview-close {
  flex: none;
  border-radius: var(--radius-full);
  background: var(--bg-active);
}
.netdisk-preview-count {
  margin: 0;
  padding: 0 var(--space-3) var(--space-2);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
.netdisk-preview-files {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  padding: var(--space-1_5);
  overflow-y: auto;
  border-radius: var(--radius-lg);
  background: var(--bg-active-soft);
  list-style: none;
}
.netdisk-preview-file {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 38px;
  padding: 0 var(--space-2_5);
  font-size: var(--text-sm);
}
.netdisk-preview-file.is-episode {
  border-radius: var(--radius-md);
  background: var(--bg-active);
  font-weight: var(--font-weight-medium);
}
.netdisk-preview-icon {
  flex: none;
  color: var(--text-tertiary);
}
.netdisk-preview-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.netdisk-preview-size {
  flex: none;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
.netdisk-preview-more,
.netdisk-preview-note {
  margin: 0;
  padding: var(--space-1_5) var(--space-2_5) var(--space-1);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.netdisk-preview-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2_5);
  margin-top: var(--space-4);
}
.netdisk-preview-cancel,
.netdisk-preview-save {
  height: 44px;
  padding: 0 var(--space-5);
  border-radius: var(--radius-full);
  font-size: var(--text-md);
}
.netdisk-preview-cancel {
  background: var(--bg-active);
}
.netdisk-preview-save {
  background: var(--text-primary);
  color: var(--bg-content);
}
</style>
