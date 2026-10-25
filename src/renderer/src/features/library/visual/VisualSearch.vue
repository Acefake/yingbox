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
        <FramesSettings
          v-if="status?.model === 'ready'"
          :frames="status.frames"
          @change="setFrames"
        />

        <div v-if="!text.trim()" class="visual-examples">
          <UiChip
            v-for="example in EXAMPLES"
            :key="example"
            :label="example"
            @click="text = example"
          />
        </div>
        <ul v-else-if="hits.length" class="visual-grid" :aria-busy="searching">
          <VisualHitCard
            v-for="hit in hits"
            :key="hit.itemId"
            :hit="hit"
            @open="id => emit('open-item', id)"
            @play="(fileId, at) => playFrom(hit.itemId, fileId, at)"
          />
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
 * 按画面搜面板（番号库）。结果按「最像的那个画面」排序，每部显示那张图：封面 / 剧照点开进详情，
 * 视频画面从那个时间点播放（结果卡见 VisualHitCard.vue，视频画面开关见 FramesSettings.vue）。
 * 状态与搜索见 use-visual-search.ts，阶段划分见 visual-rules.ts。
 */
import { computed } from 'vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiChip from '@/components/ui/UiChip.vue'
import UiInput from '@/components/ui/UiInput.vue'
import LibrarySheet from '../shared/LibrarySheet.vue'
import FramesSettings from './FramesSettings.vue'
import VisualHitCard from './VisualHitCard.vue'
import { playMoment } from './play-moment'
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

const { status, text, hits, searching, error, startIndex, setFrames } =
  useVisualSearch({
    open,
    libraryId: () => props.libraryId ?? undefined,
  })
const stage = computed(() => stageOf(status.value))

/** 从视频画面的时间点播放：先收起面板，免得挡住播放器。 */
function playFrom(itemId: number, fileId: number, at: number): void {
  open.value = false
  void playMoment(itemId, fileId, at)
}
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
</style>
