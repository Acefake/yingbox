<template>
  <UiButton
    v-if="trashItem"
    :variant="variant"
    size="sm"
    icon="trash"
    label="删除"
    @click="confirmTrash"
  />
</template>

<script setup lang="ts">
import type { LibraryItemNode } from '../../../../../shared/library/ipc'
import { confirmDialog, toast } from '@/components/ui'
import UiButton from '@/components/ui/UiButton.vue'
import { errorText, libraryBridge } from '../api/bridge'

const props = defineProps<{
  /** 要删除的媒体。合并版本由媒体库引擎统一处理。 */
  item: Pick<LibraryItemNode, 'id' | 'title' | 'addedAt' | 'merge'>
  /** 详情页在封面上使用玻璃按钮。 */
  variant?: 'glass'
}>()
const emit = defineEmits<{
  /** 打开确认框前通知宿主收起悬停卡。 */
  request: []
}>()

const trashItem = libraryBridge()?.trashItem

async function confirmTrash(): Promise<void> {
  if (!trashItem) return
  const { id, title, addedAt, merge } = props.item
  const memberIds = merge?.members.map(member => member.itemId) ?? [id]
  emit('request')
  let moved = 0
  const confirmed = await confirmDialog({
    title: `删除「${title}」？`,
    content:
      '所有本地版本、剧集及能确认归属的字幕、NFO 和图片将移到系统回收站。',
    okText: '移到回收站',
    danger: true,
    onOk: async () => {
      try {
        moved = await trashItem({ itemId: id, addedAt, memberIds })
      } catch (error) {
        throw new Error(errorText(error), { cause: error })
      }
    },
  })
  if (confirmed) toast.success(`已将 ${moved} 个文件移到回收站`)
}
</script>
