<template>
  <div
    class="assistant"
    data-focus-scope
    :data-layout="layout"
    :data-mode="mode"
    :data-private="context.private"
    :data-searching="searching"
  >
    <div v-if="layout === 'page'" class="assistant-scrim" @click="close" />
    <div class="assistant-stage">
      <section
        ref="panelRef"
        class="assistant-panel"
        :class="{ 'yb-glass': mode === 'panel' }"
        role="dialog"
        :aria-modal="layout === 'page'"
        aria-label="搜索与 AI 助手"
        @keydown="trapTab"
      >
        <p class="assistant-status" role="status">{{ statusText }}</p>
        <h2 v-if="mode === 'hero'" class="assistant-hello">有什么可以帮你？</h2>
        <AssistantHeader
          :context="context"
          :model-label="modelLabel"
          :closable="mode === 'panel'"
          @close="close"
        />
        <div
          v-if="threaded"
          ref="threadRef"
          class="assistant-thread"
          @scroll="onThreadScroll"
        >
          <AssistantTurn
            v-for="turn in turns"
            :key="turn.id"
            :question="turn.question"
            :answer="turn.answer"
            :result="turn.result"
            :notice="turn.notice"
            @played="close"
          />
          <AssistantTurn
            v-if="hasCurrent"
            :question="transcript"
            :answer="answer"
            :result="result"
            :notice="notice"
            :typing="phase === 'answering'"
            @played="close"
          >
            <div v-if="needsSetup" class="assistant-setup">
              <UiButton
                variant="primary"
                icon="settings"
                label="去设置 AI"
                @click="openAiSettings"
              />
            </div>
          </AssistantTurn>
          <UiLoadingDots
            v-if="phase === 'thinking'"
            class="assistant-thinking"
            label="思考中"
          />
        </div>
        <AssistantSearch
          v-if="searching && mode === 'panel'"
          v-bind="searchProps"
          @ask="send(query)"
        />
        <AssistantComposer
          v-model:draft="draft"
          :suggestions="threaded || searching || !askable ? [] : suggestions"
          :placeholder="threaded ? '继续问，或搜索片库…' : placeholder"
          :example="threaded || !askable ? '' : example"
          :floating="mode === 'hero'"
          :voice-ready="voiceReady"
          :listening="phase === 'listening'"
          :level="level"
          :busy="busy"
          :askable="askable"
          :list-id="searching ? 'entry-results' : ''"
          :active-id="searching ? selectionId(selected) : ''"
          @ask="send"
          @enter="onEnter"
          @move="move"
          @voice="toggleVoice"
        >
          <AssistantSearch
            v-if="searching && mode === 'hero'"
            v-bind="searchProps"
            floating
            @ask="send(query)"
          />
        </AssistantComposer>
        <footer v-if="mode === 'hero'" class="assistant-keys">
          <span class="assistant-key">
            <kbd class="assistant-kbd" aria-hidden="true">↑ ↓</kbd>选择
          </span>
          <span class="assistant-key">
            <kbd class="assistant-kbd" aria-hidden="true">↵</kbd>打开 / 发送
          </span>
          <span v-if="askable" class="assistant-key">
            <kbd class="assistant-kbd" aria-hidden="true">{{ askKey }}</kbd>
            问 AI
          </span>
          <span class="assistant-key">
            <kbd class="assistant-kbd" aria-hidden="true">{{ hotkey }}</kbd>
            唤起 / 收起
          </span>
          <UiPressable
            class="assistant-key assistant-close"
            label="关闭（Esc）"
            @click="close"
          >
            <kbd class="assistant-kbd" aria-hidden="true">Esc</kbd>
            <span aria-hidden="true">关闭</span>
          </UiPressable>
        </footer>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 统一入口浮层（按需加载）：搜索片库与问 AI 共用的窗口正中一列，两种形态（data-mode）。
 * - hero（还没提问）：大标题「有什么可以帮你？」、上下文胶囊、独立的玻璃输入胶囊、技能建议、快捷键提示；
 *   输入框一有字就即时搜（use-entry-search.ts：本地片库 + AI 增强融合，在线影视源异步追加；范围胶囊全部 / 本地 /
 *   在线 / 当前分区），结果块（AssistantSearch）接在输入胶囊下面、替换技能建议，最上一行是「问 AI：<输入>」。回车作用在选中行（默认规则见 assistant-entry.ts），Cmd/Ctrl+回车总是问 AI；
 *   整列顶部锚定（不随结果长度上下跳）；
 * - panel 里继续输入时，结果块出现在输入框上方，规则相同。
 * - panel（有对话后）：同一列展开成玻璃面板（.yb-glass）——上下文胶囊与 Esc 在顶、对话流在中间滚动、
 *   内凹输入胶囊在底；面板随内容长高，最高 --assistant-panel-height，超出后只有对话流滚动。
 * 两种布局（data-layout）：
 * - 普通页面（page）：整窗压暗轻模糊的遮罩，模态（aria-modal + 焦点陷阱，use-focus-trap.ts），点遮罩收起；
 * - 网页端播放层在前台（player）：没有遮罩，整层不拦点击、不拦焦点，画面照常可点；
 *   画面上没有遮罩托底，所以一律用面板形态（文字落在玻璃上才读得清）。
 * 唯一的彩色是输入胶囊上沿 1px 的蓝紫粉渐变，思考 / 回答时变亮。
 * 对话流 = 本次打开期间归档的几轮（assistant-thread.ts）+ 当前这一轮；新内容出现时，只有贴近底部时
 * 才自动滚到底部，用户上滚回看时不打扰，回到底部附近再恢复（assistant-scroll.ts）。
 * 「正在打开播放器」在所有轮次的结果间共享（assistant-opening.ts）。
 * 根上的 data-focus-scope 让下面网页端播放层的焦点陷阱放行：点进助手输入框不会被拉回播放器。
 * 私密模式（data-private="true"）上下文胶囊写「私密 · 仅本地模型 · 无痕」，不举例、不换色调。
 * 状态行只给读屏用：待命且还没提问时为空。
 *
 * 第一次打开时登记内置技能包（之后打开不再重复登记）；提示词、建议与占位文字都来自当前生效的技能。
 * Esc（按层）、点遮罩、Esc 键帽（面板顶部或快捷键提示里）都会收起；收起时取消模型调用、录音与逐字计时。
 * 状态机在 use-assistant.ts，依赖在 assistant-deps.ts。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { UiButton, UiLoadingDots, UiPressable } from '@/components/ui'
import { useEscapeLayer } from '@/composables/use-escape-layer'
import { useFocusTrap } from '@/composables/use-focus-trap'
import { aiAvailable } from '@/features/ai'
import { playerSession } from '@/features/player'
import { getSetting, useSetting } from '@/features/settings'
import { isSearchCommand } from '@/utils/search-command'

import { assistantExample, assistantPlaceholder } from './assistant-copy'
import {
  assistantAiReady,
  assistantContext,
  assistantVoiceReady,
  createAssistantDeps,
  openSettingsSection,
} from './assistant-deps'
import { ASK_ROW, selectionId } from './assistant-entry'
import {
  ASK_HOTKEY_LABEL as askKey,
  ENTRY_HOTKEY_LABEL as hotkey,
} from './assistant-hotkey'
import { provideOpening } from './assistant-opening'
import { useStickyScroll } from './assistant-scroll'
import { useAssistantThread } from './assistant-thread'
import AssistantComposer from './AssistantComposer.vue'
import AssistantHeader from './AssistantHeader.vue'
import AssistantSearch from './AssistantSearch.vue'
import AssistantTurn from './AssistantTurn.vue'
import { ensureCoreSkills } from './skills/core-skills'
import { skillPlaceholder, skillSuggestions } from './skills/skill-prompt'
import { assistantSkills } from './skills/skill-registry'
import { PHASE_LABELS, useAssistant } from './use-assistant'
import { useEntrySearch } from './use-entry-search'
import './assistant.css'
import './assistant-panel.css'
import './assistant-results.css'
import './assistant-search.css'

const emit = defineEmits<{ close: [] }>()

const router = useRouter()
const route = useRoute()

const close = (): void => emit('close')

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

ensureCoreSkills(assistantSkills, router)

const deps = createAssistantDeps({
  router,
  route,
  registry: assistantSkills,
  close,
  reducedMotion,
})
const {
  phase,
  transcript,
  answer,
  result,
  notice,
  needsSetup,
  level,
  ask,
  listen,
  stopListening,
  cancel,
} = useAssistant(deps)
const { turns, archive } = useAssistantThread({
  transcript,
  answer,
  result,
  notice,
})
provideOpening()

const player = playerSession()
/** 播放层盖在页面上（网页端）时不做模态、不加遮罩；桌面端在独立窗口里播，主窗口照常是页面 */
const layout = computed(() => (player.value?.inPage ? 'player' : 'page'))

/** 打开时的状态（在播时间点不随播放刷新，下次提问时重新取） */
const context = computed(() => {
  void phase.value
  return assistantContext(route)
})
const skills = computed(() => assistantSkills.active(context.value))
const suggestions = computed(() =>
  skillSuggestions(skills.value, context.value)
)
/** 能问 AI（桌面端）；网页版只有片库搜索 */
const askable = aiAvailable()
const placeholder = computed(() =>
  skillPlaceholder(
    askable ? skills.value : [],
    assistantPlaceholder(context.value, askable)
  )
)
const voiceReady = computed(() => assistantVoiceReady(context.value.private))

const modelLabel = computed(() => getSetting('ai.model') || '')

/** 思考 / 回答中：输入胶囊上沿的渐变变亮 */
const busy = computed(
  () => phase.value === 'thinking' || phase.value === 'answering'
)

const statusText = computed(() =>
  phase.value === 'idle' && !transcript.value ? '' : PHASE_LABELS[phase.value]
)

/** 当前这一轮有内容（或需要先去设置 AI）时显示 */
const hasCurrent = computed(() =>
  Boolean(
    transcript.value ||
    answer.value ||
    notice.value ||
    result.value ||
    needsSetup.value
  )
)

/** 有对话（归档的轮次或当前这一轮）：展开对话流 */
const threaded = computed(() => turns.value.length > 0 || hasCurrent.value)
/** 播放器在前台时一律面板形态，否则有对话才展开 */
const mode = computed(() =>
  threaded.value || layout.value === 'player' ? 'panel' : 'hero'
)
const example = computed(() => assistantExample(context.value))

const panelRef = ref<HTMLElement | null>(null)
const trapTab = useFocusTrap(panelRef, () => layout.value === 'page')

const draft = ref('')
const entry = useEntrySearch({
  draft,
  isPrivate: () => context.value.private,
  askable,
  aiReady: assistantAiReady,
  close,
})
const { searching, query, selected, move } = entry
const searchProps = computed(() => ({
  entry,
  selected: selected.value,
  askable,
  aiReady: assistantAiReady(),
  private: context.value.private,
}))

const adultMode = useSetting('app.adultMode')

/** 界面口令（切换一项隐藏设置，见 utils/search-command）：不搜索、不问 AI，切换后收起 */
function runCommand(): boolean {
  if (!isSearchCommand(draft.value)) return false
  adultMode.value = !adultMode.value
  draft.value = ''
  close()
  return true
}

/** 回车：选中了结果就打开它，选中「问 AI」行就提问 */
function onEnter(): void {
  if (runCommand()) return
  const row = entry.entries.value[selected.value]
  if (row) row.open()
  else if (selected.value === ASK_ROW && askable && query.value)
    send(query.value)
}

/** 提问：清空输入，先把上一轮归档进对话流 */
function send(text: string): void {
  if (runCommand() || !askable) return
  draft.value = ''
  archive()
  stickToBottom()
  void ask(text)
}

function toggleVoice(): void {
  if (phase.value === 'listening') {
    void stopListening()
    return
  }
  archive()
  stickToBottom()
  void listen()
}

function openAiSettings(): void {
  close()
  openSettingsSection('ai')
}

const threadRef = ref<HTMLElement | null>(null)
const {
  onScroll: onThreadScroll,
  follow,
  stick: stickToBottom,
} = useStickyScroll(threadRef)

/** 对话流有新内容时：贴近底部才跟到底部 */
watch([turns, transcript, answer, result, notice, phase], follow)

useEscapeLayer(() => true, close)

onBeforeUnmount(cancel)
</script>
