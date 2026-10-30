<template>
  <div class="assistant-result" :class="`is-${result.kind}`">
    <template v-if="result.kind === 'cards'">
      <ul
        class="assistant-cards"
        :class="{ 'is-busy': opening !== null }"
        aria-label="结果"
        @keydown="moveFocus"
      >
        <li
          v-for="(card, index) in result.cards"
          :key="card.id"
          class="assistant-card-in assistant-card"
          :class="{ 'is-busy': isMine(card.id) }"
          :style="{ '--i': index }"
        >
          <UiMediaRow
            :title="card.title"
            :image="card.image"
            :meta="[card.meta]"
            :specs="card.specs"
            :rating="card.rating"
            :note="cardNote(card)"
            :progress="card.progress"
            :openable="!card.actions"
            :label="openLabel(card)"
            @open="openCard(card)"
          >
            <template v-if="isMine(card.id)" #status>
              <UiLoadingDots label="正在打开…" />
            </template>
            <template #actions>
              <UiIconButton
                v-if="!privateContext"
                icon="search"
                size="sm"
                :label="`查找资源：${card.title}`"
                @click="findResources(card)"
              />
              <template v-if="card.actions">
                <UiButton
                  v-for="action in card.actions()"
                  :key="action.label"
                  size="sm"
                  :variant="action.primary ? 'primary' : 'secondary'"
                  :label="action.label"
                  :aria-label="`${action.label}：${card.title}`"
                  :aria-expanded="
                    action.panel ? expanded?.cardId === card.id : undefined
                  "
                  @click="act(card, action)"
                />
              </template>
              <template v-else>
                <UiIconButton
                  v-if="card.library"
                  class="assistant-card-extra"
                  icon="bookmark"
                  size="sm"
                  :label="
                    saved(card.library)
                      ? `已在想看，点击移除：${card.title}`
                      : `加入想看：${card.title}`
                  "
                  :active="saved(card.library)"
                  :filled="saved(card.library)"
                  @click="toggleSaved(card.library)"
                />
                <UiIconButton
                  v-if="card.library"
                  class="assistant-card-extra"
                  icon="info"
                  size="sm"
                  :label="`详情：${card.title}`"
                  @click="openDetail(card.library)"
                />
                <UiButton
                  class="assistant-card-play"
                  :variant="
                    card.progress === undefined ? 'primary' : 'secondary'
                  "
                  size="sm"
                  icon="play"
                  :label="cardPlayLabel(card)"
                  :aria-label="`${card.playLabel}：${card.title}`"
                  :aria-busy="isMine(card.id)"
                  :aria-disabled="opening !== null"
                  @click="play(card)"
                />
              </template>
            </template>
          </UiMediaRow>
        </li>
      </ul>
      <div v-if="expanded" class="assistant-card-in assistant-panel-slot">
        <component
          :is="expanded.panel.component"
          :key="expanded.cardId"
          v-bind="expanded.panel.props"
          @played="emit('played')"
        />
      </div>
    </template>

    <p
      v-else
      class="assistant-card-in assistant-done"
      :class="{ 'is-failed': !result.ok }"
    >
      <span class="assistant-done-icon"
        ><UiIcon :name="result.icon" size="sm"
      /></span>
      <span>{{ result.text }}</span>
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * 助手面板里的结果（弹簧滑入，逐行错开）：
 * - 影片结果卡（UiMediaRow，与统一入口的搜索结果行同一个组件）：海报（有进度时底部一条进度条）、片名、
 *   年份 · 类型 · 时长或季集、规格标签 + 金星评分 + 备注（看到哪儿 / 推荐理由 / 来源）；
 *   右侧主按钮「播放」（白底）或「继续」（有进度时，灰底），片库条目另有「想看」「详情」两个图标钮，
 *   整卡点开详情（片库条目），没有详情的整卡点了就播放；
 * - 一次性动作的回执：圆形图标 + 一句话。
 * 带按钮的行（库外的片子：备注里写「未入库」等状态）右侧换成一组按钮，按钮可执行一次性动作，
 * 或在列表下方展开一个面板（同一时间只展开一张卡的面板，再点收起；结果换了就收起）。
 *
 * 键盘：Tab 进到卡片，↑ / ↓ 在卡片之间移动（与统一入口的结果列表一致），回车打开；焦点在整卡上时整行高亮。
 * 开始播放 / 打开详情后通知外层收起助手。打开播放器期间：被点的那行在说明处显示「正在打开…」并标 aria-busy，
 * 其余按钮标 aria-disabled（保持可聚焦，点击不重复打开），那几行变淡。「正在打开」在整个浮层共享
 * （assistant-opening.ts）：对话流里其它轮次的结果同样变淡、点击被忽略，播放器不会被打开两次。
 */
import { type Component, computed, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  UiButton,
  UiIcon,
  UiIconButton,
  UiLoadingDots,
  UiMediaRow,
  toast,
} from '@/components/ui'
import type { LibraryCardInfo } from '@/features/library'
import { resourceSearchLocation } from '@/features/search'
import { inWatchlist, toggleWatchlist } from '@/features/watchlist'

import { assistantContext } from './assistant-deps'
import { useOpening } from './assistant-opening'
import { cardNote, cardPlayLabel } from './result-rows'
import type {
  AssistantCardAction,
  AssistantMediaCard,
  AssistantResult,
} from './skills/skill-types'

const props = defineProps<{ result: AssistantResult }>()
const emit = defineEmits<{ played: [] }>()

const router = useRouter()
const route = useRoute()
const privateContext = computed(() => assistantContext(route).private)

function findResources(card: AssistantMediaCard): void {
  emit('played')
  void router.push(resourceSearchLocation(card.title))
}

/** 正在打开播放器的卡片（整个浮层共享，见 assistant-opening.ts） */
const { opening, owner, isMine } = useOpening()
/** 展开的面板 */
const expanded = shallowRef<{
  cardId: string
  panel: { component: Component; props: Record<string, unknown> }
} | null>(null)

// 换了一批结果：上一批卡片展开的面板随之收起，不残留到新结果下
watch(
  () => props.result,
  () => {
    expanded.value = null
  }
)

const saved = (info: LibraryCardInfo): boolean =>
  inWatchlist(info.watchlist.section, info.watchlist.key)

function toggleSaved(info: LibraryCardInfo): void {
  toast.success(toggleWatchlist(info.watchlist) ? '已加入想看' : '已从想看移除')
}

const openLabel = (card: AssistantMediaCard): string =>
  card.library ? `打开详情：${card.title}` : `${card.playLabel}：${card.title}`

function openDetail(info: LibraryCardInfo): void {
  if (opening.value) return
  emit('played')
  void router.push(info.location)
}

/** 整卡：片库条目打开详情，其余直接播放 */
function openCard(card: AssistantMediaCard): void {
  if (card.library) openDetail(card.library)
  else void play(card)
}

/** ↑ / ↓ 在整卡按钮之间移动焦点（首尾不循环） */
function moveFocus(event: KeyboardEvent): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const list = event.currentTarget as HTMLElement
  const hits = [...list.querySelectorAll<HTMLElement>('.yb-media-row-hit')]
  const current = hits.findIndex(hit =>
    hit.closest('li')?.contains(document.activeElement)
  )
  const next = hits[current + (event.key === 'ArrowDown' ? 1 : -1)]
  if (current < 0 || !next) return
  event.preventDefault()
  next.focus()
}

async function play(card: AssistantMediaCard): Promise<void> {
  if (opening.value) return
  opening.value = { owner, cardId: card.id }
  try {
    if (await card.play()) emit('played')
    else toast.warning('没有找到能播放的文件')
  } catch {
    toast.error('无法打开播放器')
  } finally {
    opening.value = null
  }
}

async function act(
  card: AssistantMediaCard,
  action: AssistantCardAction
): Promise<void> {
  if (action.panel) {
    expanded.value =
      expanded.value?.cardId === card.id
        ? null
        : { cardId: card.id, panel: action.panel }
    return
  }
  try {
    if (await action.run?.()) emit('played')
  } catch {
    toast.error('操作失败')
  }
}
</script>
