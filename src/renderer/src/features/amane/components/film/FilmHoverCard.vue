<template>
  <div
    class="amane-hover-card"
    :style="position"
    role="tooltip"
    @mouseenter="emit('enter')"
    @mouseleave="emit('leave')"
  >
    <UiPressable
      block
      class="amane-hover-hero"
      :label="`查看 ${film.title || film.number} 详情`"
      @click="emit('open')"
    >
      <Transition name="amane-hover-slide">
        <img
          v-if="hero"
          :key="hero"
          :src="hero"
          alt=""
          @load="imageLoaded(srcOf($event))"
          @error="imageFailed(srcOf($event))"
        />
      </Transition>
      <span v-if="!hero" class="amane-hover-hero-fallback">{{
        film.number
      }}</span>
      <span v-if="images.length" class="amane-hover-count"
        >{{ imageIndex + 1 }} / {{ images.length }}</span
      >
      <span
        v-if="imageReady && images.length > 1 && !reducedMotion"
        :key="hero"
        class="amane-hover-progress"
        aria-hidden="true"
      />
    </UiPressable>
    <div class="amane-hover-body">
      <p class="amane-hover-number">{{ film.number }}</p>
      <UiPressable class="amane-hover-title-btn" @click="emit('open')">
        <strong class="amane-hover-title">{{
          film.title || film.number
        }}</strong>
      </UiPressable>
      <p class="amane-hover-meta">
        <span v-if="film.release">{{ film.release.slice(0, 10) }}</span>
        <span v-if="film.runtime">{{ runtimeText(film.runtime) }}</span>
        <span v-if="film.score != null" class="amane-hover-score"
          ><UiIcon name="star" size="sm" filled />{{
            film.score.toFixed(1)
          }}</span
        >
        <span v-if="film.file_count">{{ film.file_count }} 个文件</span>
      </p>
      <div class="amane-hover-actions">
        <template v-if="!isWeb && film.file_count">
          <UiButton
            :disabled="actionBusy"
            icon="play"
            label="播放"
            variant="primary"
            @click="emit('play')"
          />
          <UiIconButton
            :disabled="actionBusy"
            icon="sparkle"
            label="去码"
            variant="secondary"
            @click="emit('restore')"
          />
          <UiIconButton
            :disabled="actionBusy"
            icon="range"
            label="去码一段"
            variant="secondary"
            @click="emit('range')"
          />
          <UiIconButton
            :disabled="actionBusy"
            icon="livePlay"
            label="边跑边看"
            variant="secondary"
            @click="emit('live')"
          />
        </template>
        <UiIconButton
          icon="refresh"
          label="重新刮削"
          :disabled="busy || actionBusy"
          variant="secondary"
          @click="emit('rescrape')"
        />
        <UiIconButton
          icon="info"
          label="详情"
          variant="secondary"
          @click="emit('open')"
        />
      </div>
      <div class="amane-hover-facts">
        <p v-if="film.studio" class="amane-hover-fact">
          <span>制作商</span><b>{{ film.studio }}</b>
        </p>
        <p v-if="film.publisher" class="amane-hover-fact">
          <span>发行商</span><b>{{ film.publisher }}</b>
        </p>
        <p v-if="film.series" class="amane-hover-fact">
          <span>系列</span><b>{{ film.series }}</b>
        </p>
        <p v-if="film.directors?.length" class="amane-hover-fact is-wrap">
          <span>导演</span><b>{{ clipList(film.directors, 4, ' / ') }}</b>
        </p>
        <p v-if="film.actors.length" class="amane-hover-fact is-wrap">
          <span>演员</span><b>{{ clipList(film.actors, 8, ' / ') }}</b>
        </p>
        <p v-if="film.tags.length" class="amane-hover-fact is-wrap">
          <span>标签</span><b>{{ clipList(film.tags, 10, ' · ') }}</b>
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 海报悬停预览卡（Netflix 式）：横版剧照轮播（每张加载完 2.4 秒后切下一张，
 * 减弱动效时不轮播）、详情级信息、直接操作。显隐与定位由 use-film-hover 管。
 */
import { computed, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { UiButton, UiIcon, UiIconButton, UiPressable } from '@/components/ui'
import { type AmaneFilm, amaneImage } from '../../api/amane'
import { clipList, hoverImages, runtimeText } from '../../utils/film'

const props = defineProps<{
  film: AmaneFilm
  position: Record<string, string>
  isWeb: boolean
  busy: boolean
  actionBusy: boolean
}>()
const emit = defineEmits<{
  enter: []
  leave: []
  open: []
  play: []
  restore: []
  range: []
  live: []
  rescrape: []
}>()
const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const imageIndex = ref(0)
const imageReady = ref(false)
const failedImages = ref<string[]>([])
let slideTimer: ReturnType<typeof setTimeout> | undefined
const images = computed(() =>
  hoverImages(props.film, failedImages.value, amaneImage)
)
const hero = computed(() => images.value[imageIndex.value] || '')

const srcOf = (event: Event): string =>
  (event.target as HTMLImageElement).getAttribute('src') || ''

function stopSlides(): void {
  clearTimeout(slideTimer)
  imageReady.value = false
}

function imageLoaded(url: string): void {
  if (url !== hero.value) return
  stopSlides()
  imageReady.value = true
  if (reducedMotion.value || images.value.length < 2) return
  slideTimer = setTimeout(() => {
    imageReady.value = false
    imageIndex.value = (imageIndex.value + 1) % images.value.length
  }, 2400)
}

function imageFailed(url: string): void {
  if (!url || url !== hero.value) return
  stopSlides()
  failedImages.value = [...failedImages.value, url]
  if (imageIndex.value >= images.value.length) imageIndex.value = 0
}

watch(
  () => props.film.id,
  () => {
    stopSlides()
    failedImages.value = []
    imageIndex.value = 0
  },
  { flush: 'sync' }
)
watch(reducedMotion, () => {
  stopSlides()
  imageIndex.value = 0
  if (hero.value) imageLoaded(hero.value)
})
onBeforeUnmount(stopSlides)
onDeactivated(stopSlides)
</script>
