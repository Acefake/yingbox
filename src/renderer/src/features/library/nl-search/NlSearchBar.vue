<template>
  <!-- 搜索词（可清除）+ 自然语言搜索：解析出的条件一排胶囊（可删、可改），或普通关键词旁的「用 AI 理解」 -->
  <div
    v-if="nl.active.value || query"
    class="nl-bar"
    role="group"
    :aria-label="nl.active.value ? 'AI 理解的搜索条件' : '搜索'"
  >
    <span v-if="query" class="nl-bar-item nl-bar-query">
      <span class="nl-bar-name">搜索</span>
      <span class="nl-bar-text">{{ query }}</span>
      <UiIconButton
        icon="close"
        size="sm"
        label="清除搜索"
        @click="clearQuery"
      />
    </span>
    <template v-if="nl.active.value">
      <span class="nl-bar-lead">
        <UiIcon name="sparkle" size="sm" />
        理解为
      </span>
      <template v-for="chip in nl.chips.value" :key="chip.key">
        <UiInput
          v-if="editing === chip.key"
          ref="editor"
          v-model="draft"
          v-enter="commit"
          class="nl-bar-editor"
          size="sm"
          :invalid="invalid"
          :aria-label="`修改条件 ${chip.name}`"
          @blur="cancel"
        />
        <span v-else class="nl-bar-item">
          <UiChip
            v-tooltip="chipTip(chip)"
            selected
            :class="{ 'is-inactive': chip.inactive }"
            :disabled="chip.edit === 'none'"
            :aria-label="`${chip.name} ${chip.label}`"
            @click="onChip(chip)"
          >
            <span class="nl-bar-name">{{ chip.name }}</span>
            {{ chip.label }}
          </UiChip>
          <UiIconButton
            icon="close"
            size="sm"
            :label="`去掉条件 ${chip.name} ${chip.label}`"
            @click="nl.remove(chip)"
          />
        </span>
      </template>
      <UiLoadingDots v-if="nl.status.value === 'loading'" label="正在理解" />
      <template v-else-if="nl.message.value">
        <span class="nl-bar-message">{{ nl.message.value }}</span>
        <UiButton
          v-if="nl.status.value === 'unconfigured'"
          variant="plain"
          size="sm"
          icon="settings"
          label="去设置 AI"
          @click="nl.openSettings"
        />
        <UiButton
          v-else
          variant="plain"
          size="sm"
          icon="refresh"
          label="重试"
          @click="nl.ask"
        />
      </template>
    </template>
    <UiButton
      v-else-if="nl.canAsk.value"
      variant="plain"
      size="sm"
      icon="sparkle"
      label="用 AI 理解"
      @click="nl.ask"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 海报墙上方的自然语言搜索条：AI 解析出的条件胶囊（点胶囊改值或切换，× 去掉），
 * 解析中 / 失败 / 未配置的提示；普通关键词时只给一个「用 AI 理解」按钮。
 * 路由带 ?q= 时最前面一枚「搜索 …」胶囊，× 去掉 q 与交接条件 searchFilter（搜索词来自统一入口的「在海报墙查看」
 * 或 AI 助手，侧栏不再有输入框，清除放在这里）。
 * 状态都在 useNlSearch 里，这里只负责展示和把操作交回去。
 */
import { computed, nextTick, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import UiButton from '@/components/ui/UiButton.vue'
import UiChip from '@/components/ui/UiChip.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiLoadingDots from '@/components/ui/UiLoadingDots.vue'
import { vTooltip } from '@/components/ui/tooltip'
import { useEscapeLayer } from '@/composables/use-escape-layer'
import { vEnter } from '@/directives/enter'

import type { NlChip } from './nl-chips'
import type { NlSearch } from './use-nl-search'

const props = defineProps<{ nl: NlSearch }>()

const route = useRoute()
const router = useRouter()
/** 路由里的搜索词 */
const query = computed(() =>
  typeof route.query.q === 'string'
    ? route.query.q.replace(/^[?？]\s*/, '').trim()
    : ''
)

function clearQuery(): void {
  void router.replace({
    path: route.path,
    query: { ...route.query, q: undefined, searchFilter: undefined },
  })
}

/** 正在改的胶囊 key */
const editing = ref<string | null>(null)
const draft = ref('')
const invalid = ref(false)
const editor = ref<Array<InstanceType<typeof UiInput>>>([])
let editingChip: NlChip | null = null

/** 胶囊的提示：本页不生效 / 怎么改。 */
function chipTip(chip: NlChip): string {
  if (chip.inactive) return '本页没有这一类，这个条件不生效'
  if (chip.edit === 'text') return '点击修改'
  if (chip.edit === 'toggle') return '点击切换'
  return ''
}

function onChip(chip: NlChip): void {
  if (chip.edit === 'toggle') {
    props.nl.toggle(chip)
    return
  }
  if (chip.edit !== 'text') return
  editingChip = chip
  editing.value = chip.key
  draft.value = chip.draft
  invalid.value = false
  void nextTick(() => editor.value[0]?.focus())
}

function commit(): void {
  if (!editingChip) return
  if (!props.nl.edit(editingChip, draft.value)) {
    invalid.value = true
    return
  }
  cancel()
}

function cancel(): void {
  editing.value = null
  editingChip = null
}

useEscapeLayer(() => editing.value !== null, cancel)
</script>

<style scoped>
.nl-bar {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--content-padding-x) var(--space-3);
}
.nl-bar-lead {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.nl-bar-item {
  display: inline-flex;
  align-items: center;
}
.nl-bar-name {
  color: var(--text-tertiary);
}
.nl-bar-query {
  gap: var(--space-1_5);
  max-width: 100%;
  padding-left: var(--space-3);
  border-radius: var(--radius-full);
  background: var(--bg-active-soft);
  box-shadow: inset 0 0 0 0.5px var(--border-default);
  font-size: var(--text-sm);
}
.nl-bar-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nl-bar-item .is-inactive {
  color: var(--text-tertiary);
  text-decoration: line-through;
}
.nl-bar-editor {
  width: auto;
  max-width: 200px;
}
.nl-bar-message {
  color: var(--text-secondary);
  font-size: var(--text-xs);
}
</style>
