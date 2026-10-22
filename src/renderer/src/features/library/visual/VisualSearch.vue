<template>
  <!-- 按画面搜：一句话描述画面，在封面和剧照里找片；第一次用要下载模型、建索引 -->
  <LibrarySheet
    :open="open"
    title="按画面搜"
    icon="image"
    size="lg"
    @close="open = false"
  >
    <div class="visual">
      <!-- 推理组件不可用 -->
      <p v-if="stage === 'unavailable'" class="visual-note">
        当前系统缺少推理组件，暂时不能按画面搜。
      </p>

      <!-- 第一次：下载模型、建立索引 -->
      <div v-else-if="stage === 'setup'" class="visual-setup">
        <p class="visual-lead">
          用一句话描述画面，比如「高跟鞋」，在封面和剧照里找片。
        </p>
        <p class="visual-note">
          需要先下载中文图文模型（{{
            MODEL_SIZE_LABEL
          }}），并给已识别的番号建立索引。
          模型在本机运行，图片不会上传。剧照没下载过的会顺便下载。
        </p>
        <UiButton
          variant="primary"
          icon="download"
          :label="status?.model === 'ready' ? '建立索引' : '下载模型并建立索引'"
          @click="startIndex"
        />
      </div>

      <template v-else>
        <div class="visual-bar">
          <UiInput
            v-model="text"
            class="visual-input"
            variant="filled"
            icon="search"
            clearable
            placeholder="描述画面，比如 高跟鞋"
            aria-label="描述画面"
          />
          <UiButton
            v-if="stage === 'ready' && status && hasPending(status)"
            size="sm"
            icon="refresh"
            :label="`补索引 ${status.total - status.indexed} 部`"
            @click="startIndex"
          />
        </div>
        <p
          v-if="stage === 'working' && status"
          class="visual-note"
          aria-live="polite"
        >
          {{ progressText(status) }}，索引好的部分已经可以搜。
        </p>

        <div v-if="!text.trim()" class="visual-examples">
          <UiChip
            v-for="example in EXAMPLES"
            :key="example"
            :label="example"
            @click="text = example"
          />
        </div>
        <ul v-else-if="hits.length" class="visual-grid" :aria-busy="searching">
          <li v-for="hit in hits" :key="hit.itemId">
            <UiPressable
              block
              class="visual-hit"
              :label="`打开 ${hit.title}`"
              @click="emit('open-item', hit.itemId)"
            >
              <img
                :src="stillImage(hit.image, 'thumb')"
                alt=""
                loading="lazy"
                decoding="async"
              />
              <span class="visual-hit-title">{{ hit.title }}</span>
            </UiPressable>
          </li>
        </ul>
        <p v-else-if="!searching" class="visual-note">没有找到相近的画面。</p>
      </template>

      <p v-if="error || status?.error" class="visual-error" role="alert">
        {{ error || status?.error }}
      </p>
    </div>
  </LibrarySheet>
</template>

<script setup lang="ts">
/**
 * 按画面搜面板（番号库）。结果按「最像的那张图」排序，每部显示那张图，点开进详情。
 * 状态与搜索见 use-visual-search.ts，阶段划分见 visual-rules.ts。
 */
import { computed } from 'vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiChip from '@/components/ui/UiChip.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiPressable from '@/components/ui/UiPressable.vue'
import { stillImage } from '../api/images'
import LibrarySheet from '../shared/LibrarySheet.vue'
import { useVisualSearch } from './use-visual-search'
import {
  EXAMPLES,
  MODEL_SIZE_LABEL,
  hasPending,
  progressText,
  stageOf,
} from './visual-rules'

const props = defineProps<{
  /** 只搜这个媒体库；null 为全部。 */
  libraryId: number | null
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ 'open-item': [itemId: number] }>()

const { status, text, hits, searching, error, startIndex } = useVisualSearch({
  open,
  libraryId: () => props.libraryId ?? undefined,
})
const stage = computed(() => stageOf(status.value))
</script>

<style scoped>
.visual {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: 320px;
}
.visual-setup {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}
.visual-lead {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--text-md);
}
.visual-note {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}
.visual-error {
  margin: 0;
  color: var(--danger);
  font-size: var(--text-sm);
}
.visual-bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.visual-input {
  flex: 1 1 auto;
}
.visual-examples {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.visual-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}
.visual-hit {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.visual-hit img {
  width: 100%;
  aspect-ratio: 3 / 2;
  object-fit: cover;
  border-radius: var(--radius-md);
  background: var(--bg-fill-secondary);
  transition: var(--transition-fast);
}
.visual-hit:hover img {
  filter: brightness(1.06);
}
.visual-hit-title {
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
