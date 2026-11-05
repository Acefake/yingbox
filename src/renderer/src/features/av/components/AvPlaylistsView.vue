<template>
  <AvWatchLaterView
    title="片单"
    :items="current?.items ?? []"
    :empty-title="current ? '这个片单还没有资源' : '还没有片单'"
    :is-favorite="isFavorite"
    @play="emit('play', $event)"
    @toggle-favorite="emit('toggle-favorite', $event)"
  >
    <template #controls>
      <div class="av-playlist-controls">
        <UiSelect
          v-if="lists.length"
          v-model="selection"
          :options="options"
          aria-label="选择片单"
        />
        <UiIconButton
          v-if="current"
          icon="trash"
          label="删除片单"
          danger
          @click="deleteList(current)"
        />
        <UiInput
          v-model="name"
          v-enter="create"
          placeholder="新片单名称"
          aria-label="新片单名称"
          maxlength="40"
        />
        <UiButton
          label="新建片单"
          icon="plus"
          :disabled="!name.trim()"
          @click="create"
        />
      </div>
      <div v-if="pending" class="av-playlist-controls">
        <span>{{ pending.vod_name }}</span>
        <UiButton
          :label="alreadyAdded ? '已在所选片单' : '加入所选片单'"
          :disabled="!current || alreadyAdded"
          @click="add"
        />
        <UiIconButton
          icon="close"
          label="取消加入片单"
          @click="pending = null"
        />
      </div>
    </template>
    <template #actions="{ video }">
      <slot name="actions" :video="video" />
      <AvPlaylistButton remove @press="remove(video)" />
    </template>
  </AvWatchLaterView>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { confirmDialog, toast } from '@/components/ui'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import AvPlaylistButton from './AvPlaylistButton.vue'
import AvWatchLaterView from './AvWatchLaterView.vue'
import type { AvVideo } from '../utils/av-catalog'

interface Playlist {
  name: string
  items: AvVideo[]
}

const lists = defineModel<Playlist[]>('lists', { required: true })
const pending = defineModel<AvVideo | null>('pending', { required: true })
const selectedName = defineModel<string>('selectedName', { required: true })
defineSlots<{
  /** 片单卡片的其他列表操作。 */
  actions(props: { video: AvVideo }): unknown
}>()
defineProps<{
  /** 查询卡片的收藏状态。 */
  isFavorite: (video: AvVideo) => boolean
}>()
const emit = defineEmits<{
  /** 播放片单中的资源。 */
  play: [video: AvVideo]
  /** 切换片单卡片的收藏状态。 */
  'toggle-favorite': [video: AvVideo]
}>()

const name = ref('')
const current = computed(
  () =>
    lists.value.find(list => list.name === selectedName.value) ?? lists.value[0]
)
const selection = computed({
  get: () => current.value?.name ?? '',
  set: value => {
    selectedName.value = value
  },
})
const options = computed(() =>
  lists.value.map(list => ({ label: list.name, value: list.name }))
)
const alreadyAdded = computed(
  () =>
    current.value?.items.some(video => video._uid === pending.value?._uid) ??
    false
)

function create(): void {
  const title = name.value.trim()
  if (!title) return
  if (lists.value.some(list => list.name === title)) {
    toast.info('已有同名片单')
    return
  }
  lists.value = [...lists.value, { name: title, items: [] }]
  selectedName.value = title
  name.value = ''
}

function add(): void {
  const list = current.value
  const video = pending.value
  if (!list || !video || alreadyAdded.value) return
  lists.value = lists.value.map(entry =>
    entry === list ? { ...entry, items: [...entry.items, video] } : entry
  )
  pending.value = null
  toast.success('已加入片单')
}

function remove(video: AvVideo): void {
  lists.value = lists.value.map(list =>
    list === current.value
      ? { ...list, items: list.items.filter(item => item._uid !== video._uid) }
      : list
  )
}

async function deleteList(list: Playlist): Promise<void> {
  if (
    !(await confirmDialog({
      title: '删除片单',
      content: `删除「${list.name}」？`,
      danger: true,
    }))
  )
    return
  lists.value = lists.value.filter(entry => entry.name !== list.name)
}
</script>

<style scoped>
.av-playlist-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.av-playlist-controls :deep(.ui-field) {
  width: min(100%, 220px);
}
</style>
