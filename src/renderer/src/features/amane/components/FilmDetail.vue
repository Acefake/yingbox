<template>
  <article class="amane-film-detail" aria-labelledby="amane-film-title">
    <div class="amane-film-poster">
      <img
        v-if="cover"
        :src="amaneImage(cover)"
        alt="影片海报"
        @error="failedCovers = [...failedCovers, cover]"
      />
      <span v-else>{{ film.number }}</span>
    </div>
    <div class="amane-film-content">
      <div class="amane-film-summary">
        <p class="amane-film-number">{{ film.number }}</p>
        <h2 id="amane-film-title" :title="film.title || film.number">
          {{ film.title || film.number }}
        </h2>
        <p class="amane-film-meta">
          <span v-if="film.release">{{ film.release.slice(0, 10) }}</span>
          <span
            v-if="film.release && film.runtime"
            class="amane-film-meta-dot"
            aria-hidden="true"
            >·</span
          >
          <span v-if="film.runtime">{{ runtimeText(film.runtime) }}</span>
          <span v-if="film.score != null" class="amane-film-score"
            ><UiIcon name="star" size="sm" filled />{{
              film.score.toFixed(1)
            }}</span
          >
        </p>
        <div class="amane-film-actions">
          <UiButton
            v-if="detail.files.length"
            :disabled="busy"
            icon="play"
            label="播放"
            variant="primary"
            @click="$emit('play', detail.files[0].id)"
          />
          <UiIconButton
            icon="refresh"
            label="重新刮削"
            :disabled="busy"
            variant="secondary"
            @click="$emit('scrape', film.id)"
          />
          <UiIconButton
            v-if="detail.files.length"
            icon="sparkle"
            label="去码"
            :disabled="busy"
            variant="secondary"
            @click="$emit('restore', detail.files[0].id)"
          />
          <UiIconButton
            v-if="detail.files.length"
            :disabled="busy"
            icon="range"
            label="去码一段"
            variant="secondary"
            @click="$emit('range', detail.files[0].id)"
          />
          <UiIconButton
            v-if="detail.files.length"
            :disabled="busy"
            icon="folder"
            label="整理到媒体库目录（写出封面与海报）"
            variant="secondary"
            @click="$emit('organize', detail.files[0].id)"
          />
          <UiIconButton
            v-if="detail.files.length"
            :disabled="busy"
            icon="livePlay"
            label="边跑边看"
            variant="secondary"
            @click="$emit('live', detail.files[0].id)"
          />
        </div>
      </div>

      <dl v-if="facts.length" class="amane-film-facts">
        <div v-for="fact in facts" :key="fact.field">
          <dt>
            {{ fact.label }}
            <FieldLock v-if="locked(fact.field)" />
          </dt>
          <dd>{{ fact.value }}</dd>
        </div>
      </dl>
      <section v-if="film.directors?.length" class="amane-film-section">
        <h3>
          导演
          <FieldLock v-if="locked('directors')" />
        </h3>
        <div class="amane-film-chips">
          <span
            v-for="name in film.directors"
            :key="name"
            class="amane-film-chip director"
            >{{ name }}</span
          ><span v-if="!film.directors?.length" class="amane-muted"
            >暂无导演资料</span
          >
        </div>
      </section>
      <section class="amane-film-section">
        <h3>
          演员
          <FieldLock v-if="locked('actors')" />
        </h3>
        <div class="amane-film-chips">
          <UiChip
            v-for="name in film.actors"
            :key="name"
            class="amane-film-chip actor"
            :disabled="!detail.actor_ids[name]"
            @click="$emit('actor', { id: detail.actor_ids[name], name })"
          >
            <template #leading
              ><span
                v-if="detail.actor_genders?.[name] === 'female'"
                aria-label="女"
                >♀</span
              ><span
                v-else-if="detail.actor_genders?.[name] === 'male'"
                aria-label="男"
                >♂</span
              ></template
            >
            {{ name }}</UiChip
          ><span v-if="!film.actors.length" class="amane-muted"
            >暂无演员资料</span
          >
        </div>
      </section>
      <section class="amane-film-section">
        <h3>
          标签
          <FieldLock v-if="locked('tags')" />
        </h3>
        <div class="amane-film-chips">
          <UiChip
            v-for="name in film.tags"
            :key="name"
            class="amane-film-chip"
            :label="name"
            :disabled="!detail.tag_ids[name]"
            @click="$emit('tag', name, detail.tag_ids[name])"
          /><span v-if="!film.tags.length" class="amane-muted">暂无标签</span>
        </div>
      </section>
      <FilmUserTags
        :metadata-id="film.id"
        :tags="detail.user_tags || []"
        @tags-changed="(id, tags) => emit('tagsChanged', id, tags)"
      />
      <section class="amane-film-section">
        <h3>来源链接</h3>
        <div class="amane-film-chips">
          <a
            v-for="link in sources"
            :key="link.name"
            class="amane-film-source"
            :href="link.url"
            target="_blank"
            rel="noopener noreferrer"
            >{{ link.name }} <UiIcon name="externalLink" size="sm" /></a
          ><span v-if="!sources.length" class="amane-muted">暂无来源链接</span>
        </div>
      </section>
      <section v-if="film.plot" class="amane-film-section">
        <h3>
          简介
          <FieldLock v-if="locked('plot')" />
        </h3>
        <p class="amane-film-plot">{{ film.plot }}</p>
      </section>
      <FilmStills :stills="stills" :locked="locked('extrafanart')" />
    </div>
  </article>
</template>

<script setup lang="ts">
/**
 * Amane 影片详情：海报、摘要与操作、信息行、导演 / 演员 / 标签、用户标签、来源链接、简介、剧照。
 * 用户标签与剧照预览各自成组件（film/），纯规则在 utils/film.ts。
 */
import { computed, ref, watch } from 'vue'
import { UiButton, UiChip, UiIcon, UiIconButton } from '@/components/ui'
import { type AmaneDetail, type AmaneUserTag, amaneImage } from '../api/amane'
import {
  detailCover,
  filmFacts,
  filmStills,
  runtimeText,
  sourceLinks,
} from '../utils/film'
import FieldLock from './film/FieldLock.vue'
import FilmStills from './film/FilmStills.vue'
import FilmUserTags from './film/FilmUserTags.vue'

const props = defineProps<{ detail: AmaneDetail; busy: boolean }>()
const emit = defineEmits<{
  play: [id: number]
  restore: [id: number]
  range: [id: number]
  organize: [id: number]
  live: [id: number]
  scrape: [id: number]
  actor: [actor: { id: number; name: string }]
  tag: [name: string, id: number]
  tagsChanged: [id: number, tags: AmaneUserTag[]]
}>()
const film = computed(() => props.detail.metadata)
const failedCovers = ref<string[]>([])
const cover = computed(() => detailCover(film.value, failedCovers.value))
watch(
  () => film.value.id,
  () => {
    failedCovers.value = []
  }
)
const locked = (field: string): boolean =>
  Boolean(film.value.locked_fields?.includes(field))
const facts = computed(() => filmFacts(film.value))
const sources = computed(() => sourceLinks(film.value))
const stills = computed(() => filmStills(film.value, amaneImage))
</script>
