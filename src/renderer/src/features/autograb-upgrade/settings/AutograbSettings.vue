<template>
  <p v-if="error" class="autograb-settings-error" role="alert">{{ error }}</p>
  <div v-if="tv">
    <KindPolicyGroup kind="tv" :policy="tv" :save="saveTv" />
    <KindPrefsGroup kind="tv" :prefs="tv.prefs" :save="saveTv" />
    <CategoryFolders />
  </div>
  <div v-if="movie" ref="movieAnchor">
    <KindPolicyGroup
      kind="movie"
      :policy="movie.policy"
      :panel-cid="movie.cid"
      :save="saveMovie"
    />
    <KindPrefsGroup
      kind="movie"
      :prefs="movie.policy.prefs"
      :save="saveMovie"
    />
  </div>
  <section class="autograb-settings-upgrade" aria-labelledby="upgrade-title">
    <h3 id="upgrade-title" class="autograb-settings-upgrade-title">洗版</h3>
    <UpgradePanel />
  </section>
</template>

<script setup lang="ts">
/**
 * 设置 · 自动追更：剧集、电影各一份全局策略——默认方式、（剧集）新剧先确认几集、默认目录，以及资源偏好。
 * 追更面板 / 电影追踪里没单独设的剧和电影都按这里；改了即存，经契约 autograb.setPolicy / autograbMovies.setPolicy
 * 写到主进程或片库服务（桌面与 NAS 同一份）。sub 为 tv / movie 时打开后滚到那一块（面板里的「策略」按钮）。
 */
import { nextTick, onMounted, ref, shallowRef } from 'vue'

import { toast } from '@/components/ui/toast'
import { autograbApi } from '@/features/autograb'
import type { MoviesOverview } from '../../../../../shared/contract/autograb-upgrade'
import type {
  GrabPolicy,
  GrabPolicyPatch,
} from '../../../../../shared/contract/grab-policy'

import { moviesApi } from '../api'
import CategoryFolders from './CategoryFolders.vue'
import UpgradePanel from '../components/UpgradePanel.vue'
import KindPolicyGroup from './KindPolicyGroup.vue'
import KindPrefsGroup from './KindPrefsGroup.vue'

const props = defineProps<{ sub?: string }>()

const tv = shallowRef<GrabPolicy | null>(null)
const movie = shallowRef<MoviesOverview | null>(null)
const error = ref<string | null>(null)
const movieAnchor = ref<HTMLElement | null>(null)

async function loadTv(): Promise<void> {
  tv.value = await autograbApi().policy()
}

async function loadMovie(): Promise<void> {
  movie.value = await moviesApi().overview()
}

/** 存一次：失败提示原因，之后都重新读一遍（以主进程为准） */
async function apply(
  run: () => Promise<{ ok: true } | { ok: false; error: string }>,
  reload: () => Promise<void>
): Promise<boolean> {
  try {
    const result = await run()
    if (!result.ok) toast.error(result.error)
    await reload()
    return result.ok
  } catch (e) {
    toast.error((e as Error).message)
    return false
  }
}

const saveTv = (patch: GrabPolicyPatch): Promise<boolean> =>
  apply(() => autograbApi().setPolicy(patch), loadTv)
const saveMovie = (patch: GrabPolicyPatch): Promise<boolean> =>
  apply(() => moviesApi().setPolicy(patch), loadMovie)

onMounted(async () => {
  try {
    await Promise.all([loadTv(), loadMovie()])
  } catch (e) {
    error.value = (e as Error).message
  }
  await nextTick()
  if (props.sub === 'movie')
    movieAnchor.value?.scrollIntoView({ block: 'start' })
})
</script>

<style scoped>
.autograb-settings-upgrade {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin-top: var(--space-7);
}

.autograb-settings-upgrade-title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
}

.autograb-settings-error {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--warning);
}
</style>
