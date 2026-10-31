<template>
  <Teleport to="body" :disabled="embedded">
    <Transition name="panel-fade" :css="!embedded">
      <div
        v-if="visible"
        :class="embedded ? 'smp-embedded' : 'smp-backdrop'"
        @click.self="!embedded && emit('close')"
      >
        <div :class="embedded ? 'smp-embedded-panel' : 'smp-panel'">
          <!-- Header（仅独立面板） -->
          <DialogTitlebar
            v-if="!embedded"
            title="数据源"
            icon="database"
            @close="emit('close')"
          />
          <SourceManagerToolbar v-model="activeTab" :tabs="tabs" />

          <div class="smp-body">
            <p class="smp-startup-note">
              每次启动自动检测：可用源开启，不可用源关闭。手动调整保留到下次启动。
            </p>
            <!-- 在线 CMS / 插件 / 自定义源 -->
            <OnlineSourcesTab
              v-if="activeTab === 'online'"
              :plugins="visibleCatSpiderSites"
              @add="showAdd = true"
            />

            <!-- AV 源 -->
            <AvSourcesTab
              v-if="activeTab === 'av'"
              :plugins="adultCatSpiderSites"
            />
          </div>
        </div>

        <!-- 添加自定义源（v-show：取消后再打开时保留已填内容） -->
        <AddSourceDialog v-show="showAdd" @close="showAdd = false" />
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 数据源管理：在线 CMS / 插件 / 自定义源，以及成人模式下的 AV 源。
 * 既能作为独立侧滑面板，也能 embedded 嵌入设置窗口的「数据源」分区。
 * 本组件只管外框、分类与打开时的刷新；工具栏、在线源、AV 源、分组外框、添加对话框分别是
 * SourceManagerToolbar / OnlineSourcesTab / AvSourcesTab / SourceSection / AddSourceDialog。
 */
import { computed, ref, watch } from 'vue'

import DialogTitlebar from '@/components/DialogTitlebar.vue'
import AddSourceDialog from './AddSourceDialog.vue'
import AvSourcesTab from './AvSourcesTab.vue'
import OnlineSourcesTab from './OnlineSourcesTab.vue'
import SourceManagerToolbar from './SourceManagerToolbar.vue'
import { useSetting } from '@/features/settings'
import { useAvSources } from '@/features/av'
import { useOnlineSearch } from '../composables/use-online-search'
import { onlineApis, refreshSources } from '../composables/use-source-refresh'
import { type SourceTab, sourceTabs } from '../utils/source-rules'

const props = defineProps<{ visible: boolean; embedded?: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const adultMode = useSetting('app.adultMode')

// ── 插件源：成人插件统一归入 AV 源分类，不出现在在线源的插件列表中 ──
const { CATSPIDER_SITES, isAdultCatSpiderSite } = useOnlineSearch()
const adultCatSpiderSites = computed(() =>
  CATSPIDER_SITES.value.filter(site => isAdultCatSpiderSite(site))
)
const visibleCatSpiderSites = computed(() =>
  CATSPIDER_SITES.value.filter(site => !isAdultCatSpiderSite(site))
)

// ── 启动与打开面板时自动同步并检测 ───────────────────────────
watch(
  () => props.visible,
  visible => {
    if (visible) void refreshSources()
  }
)

// ── 分类 ────────────────────────────────────────────────────
const { allSources: avSources } = useAvSources()
const activeTab = ref<SourceTab>('online')
const tabs = computed(() =>
  sourceTabs(
    onlineApis.value.length + visibleCatSpiderSites.value.length,
    adultMode.value
      ? avSources.value.length + adultCatSpiderSites.value.length
      : null
  )
)
// 关闭成人模式后不要停留在已经消失的 AV 分类
watch(adultMode, on => {
  if (!on) activeTab.value = 'online'
})

// ── 添加自定义源 ─────────────────────────────────────────────
const showAdd = ref(false)
</script>

<style scoped>
.smp-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  justify-content: flex-end;
  background: var(--overlay-scrim-soft);
}

.smp-panel {
  display: flex;
  flex-direction: column;
  width: min(520px, calc(100vw - 48px));
  height: 100vh;
  overflow: hidden;
  border-left: 1px solid var(--separator);
  background: var(--bg-main);
  color: var(--text-primary);
  box-shadow: var(--shadow-lg);
  transition: var(--transition-panel);
}

/* 嵌入模式：在统一设置窗口内渲染，不带遮罩与标题 */
.smp-embedded {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--text-primary);
}
.smp-embedded-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.smp-body {
  flex: 1;
  padding: 0 var(--space-5) var(--space-7);
  overflow-y: auto;
}
.smp-embedded .smp-body {
  padding: 0 var(--space-2) var(--space-6) 0;
}

.panel-fade-enter-active,
.panel-fade-leave-active {
  transition: opacity var(--duration-slow) var(--ease-out);
}
.panel-fade-enter-from,
.panel-fade-leave-to {
  opacity: 0;
}
.panel-fade-enter-active .smp-panel,
.panel-fade-leave-active .smp-panel {
  transition: var(--transition-panel);
}
.panel-fade-enter-from .smp-panel,
.panel-fade-leave-to .smp-panel {
  transform: translateX(100%);
}

@media (prefers-reduced-motion: reduce) {
  .panel-fade-enter-active,
  .panel-fade-leave-active,
  .panel-fade-enter-active .smp-panel,
  .panel-fade-leave-active .smp-panel {
    transition: opacity var(--duration-normal) ease;
  }
  .panel-fade-enter-from .smp-panel,
  .panel-fade-leave-to .smp-panel {
    transform: none;
  }
}
</style>

<style scoped>
.smp-startup-note {
  margin: 0 0 var(--space-4);
  padding: 0 var(--space-4);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
</style>
