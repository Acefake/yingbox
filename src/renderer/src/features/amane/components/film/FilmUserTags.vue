<template>
  <section class="amane-film-section">
    <h3>用户标签</h3>
    <div class="amane-film-chips">
      <span
        v-for="tag in tags"
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
    <form v-if="editingTags" class="amane-tag-form" @submit.prevent="addTag">
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
</template>

<script setup lang="ts">
/**
 * 影片的用户标签：添加（不存在时先创建标签）/ 移除。
 * 结果通过 tagsChanged 交回父级更新详情；换影片时收起编辑并清空输入与错误。
 */
import { ref, watch } from 'vue'
import { UiButton, UiIconButton, UiInput } from '@/components/ui'
import { type AmaneUserTag, amaneRequest } from '../../api/amane'
import { nextUserTags } from '../../utils/film'

const props = defineProps<{ metadataId: number; tags: AmaneUserTag[] }>()
const emit = defineEmits<{ tagsChanged: [id: number, tags: AmaneUserTag[]] }>()
const editingTags = ref(false),
  tagName = ref(''),
  tagBusy = ref(false),
  tagError = ref('')

watch(
  () => props.metadataId,
  () => {
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
  const metadataId = props.metadataId
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
    if (metadataId !== props.metadataId) return
    emit('tagsChanged', metadataId, nextUserTags(props.tags, action, id, tag))
    tagName.value = ''
  } catch (e) {
    if (metadataId === props.metadataId) tagError.value = (e as Error).message
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
</script>
