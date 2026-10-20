<template>
  <div
    class="amane-shell min-h-0 bg-yb-bg text-yb-text"
    :class="{ 'is-agent-view': tab === 'agent' }"
  >
    <nav class="amane-tabs" aria-label="Amane 功能">
      <UiSegmented
        label="Amane 功能"
        :model-value="tab"
        :options="tabOptions"
        @update:model-value="switchTab"
      />
      <UiIconButton
        v-if="tab !== 'agent'"
        class="amane-nav-refresh"
        icon="refresh"
        label="刷新"
        :disabled="busy"
        @click="refreshAll"
      />
    </nav>
    <div v-if="error" class="amane-error" role="alert">
      <span>{{ error }}</span>
      <UiIconButton
        icon="close"
        label="关闭错误提示"
        size="sm"
        @click="error = ''"
      />
    </div>

    <div class="amane-workspace">
      <main
        class="amane-library-content"
        :class="{ 'is-agent': tab === 'agent' }"
        @scroll="onListScroll"
      >
        <div
          v-if="connecting || status?.state === 'starting'"
          class="amane-empty"
          role="status"
          aria-live="polite"
        >
          <span class="amane-spinner" aria-hidden="true"></span>
          <h2>正在启动 Amane 后台</h2>
          <p>首次启动需要几秒，加载完成后会自动显示片库。</p>
        </div>
        <div v-else-if="!connected" class="amane-empty">
          <h2>连接你的 Amane 片库</h2>
          <p>影盒会在后台运行 Amane，无需打开单独的程序或浏览器。</p>
          <p v-if="status?.error">{{ status.error }}</p>
          <UiButton
            variant="primary"
            icon="settings"
            label="连接设置"
            @click="() => openGlobalSettings()"
          />
        </div>
        <AgentPanel v-else-if="tab === 'agent'" @settings="openAgentSettings" />
        <template v-else>
          <form
            v-if="tab === 'films' || tab === 'actors' || tab === 'files'"
            class="amane-toolbar"
            @submit.prevent="searchNow"
          >
            <div class="amane-search">
              <input
                v-model="search"
                class="yb-field"
                :placeholder="
                  tab === 'actors'
                    ? '搜索演员'
                    : tab === 'files'
                      ? '搜索文件或番号'
                      : '搜索片名、番号'
                "
                aria-label="搜索片库"
              />
              <UiIconButton type="submit" icon="search" label="搜索" />
            </div>
            <UiIconButton
              v-if="tab === 'films'"
              icon="filter"
              label="高级搜索"
              :active="advancedOpen"
              :aria-expanded="advancedOpen"
              @click="advancedOpen = !advancedOpen"
            />
            <div
              v-if="tab === 'films'"
              ref="sortWrapper"
              class="amane-sort"
              @keydown.esc.stop="sortOpen = false"
            >
              <UiButton
                ref="sortButton"
                class="amane-sort-button"
                icon="sort"
                aria-haspopup="menu"
                :aria-expanded="sortOpen"
                @click="sortOpen = !sortOpen"
              >
                <span>{{ sortLabel }}</span>
                <UiIcon
                  :name="sortOrder === 'asc' ? 'arrowUp' : 'arrowDown'"
                  size="sm"
                />
              </UiButton>
              <div
                v-if="sortOpen"
                class="amane-sort-menu"
                role="menu"
                aria-label="排序"
              >
                <!-- 菜单项保持原生 button：role=menuitemradio，样式属于菜单而不是按钮 -->
                <button
                  v-for="option in sortOptions"
                  :key="option.value"
                  type="button"
                  role="menuitemradio"
                  :aria-checked="sortField === option.value"
                  :class="{ active: sortField === option.value }"
                  @click="chooseSort(option.value)"
                >
                  <span>{{ option.label }}</span>
                  <UiIcon
                    v-if="sortField === option.value"
                    :name="sortOrder === 'asc' ? 'arrowUp' : 'arrowDown'"
                    size="sm"
                  />
                </button>
              </div>
            </div>
            <UiButton
              v-if="actorFilter || tagFilter"
              size="sm"
              icon="close"
              :label="`清除 ${filterLabel} 筛选`"
              @click="clearFilters"
            />
            <div v-if="tab === 'films'" class="amane-scrape">
              <input
                v-model="number"
                class="yb-field number-input"
                placeholder="输入番号添加资料"
                aria-label="手动刮削番号"
              />
              <UiButton
                icon="download"
                label="刮削"
                :disabled="!number.trim() || busy"
                @click="scrapeNumber"
              />
            </div>
          </form>
          <AdvancedSearch
            v-if="tab === 'films' && advancedOpen"
            :filters="advancedFilters"
            @change="applyAdvanced"
          />
          <div v-if="loading" class="amane-loading" role="status">
            正在读取片库…
          </div>
          <template v-else-if="tab === 'films'">
            <div v-if="selectedIds.length" class="amane-selection">
              <span>已选择 {{ selectedIds.length }} 部</span>
              <UiButton
                variant="primary"
                icon="download"
                label="批量刮削"
                :disabled="busy"
                @click="scrapeFilms(selectedIds)"
              />
              <UiIconButton
                icon="close"
                label="取消选择"
                @click="selectedIds = []"
              />
            </div>
            <div v-if="films.length" class="ui-poster-grid amane-posters">
              <UiPosterCard
                v-for="film in films"
                :key="film.id"
                class="amane-poster"
                :class="{
                  'is-current': detail?.metadata.id === film.id,
                  'is-previewing': hoverFilm?.id === film.id,
                }"
                :title="film.title || film.number"
                :cover="filmCover(film)"
                :subtitle="filmSubtitle(film)"
                :rating="film.score != null ? film.score.toFixed(1) : undefined"
                @open="openFilm(film.id)"
                @pointerenter="filmHoverEnter(film, $event)"
                @mouseleave="filmHoverLeave"
              >
                <template #badges>
                  <span v-if="film.release" class="ui-poster-badge">{{
                    film.release.slice(0, 7)
                  }}</span>
                  <span v-else-if="film.file_count" class="ui-poster-badge"
                    >{{ film.file_count }} 个文件</span
                  >
                </template>
                <template #actions>
                  <UiIconButton
                    class="amane-poster-check"
                    :class="{ 'is-on': selectedIds.includes(film.id) }"
                    icon="check"
                    variant="overlay"
                    size="sm"
                    :active="selectedIds.includes(film.id)"
                    :label="
                      selectedIds.includes(film.id)
                        ? `取消选择 ${film.number}`
                        : `选择 ${film.number}`
                    "
                    @click.stop="toggleSelect(film.id)"
                    @keydown.enter.stop
                    @keydown.space.stop
                  />
                </template>
              </UiPosterCard>
            </div>
            <div v-else class="amane-empty">
              <h2>这里还没有影片</h2>
              <p>添加媒体目录并扫描，或输入番号获取影片资料。</p>
              <UiButton
                variant="primary"
                icon="plus"
                label="添加媒体库"
                @click="switchTab('libraries')"
              />
            </div>
          </template>
          <template v-else-if="tab === 'actors'">
            <div v-if="actors.length" class="amane-actors">
              <!-- 演员卡是可点的内容卡片（头像 + 名字），不是操作按钮 -->
              <button
                v-for="actor in actors"
                :key="actor.id"
                type="button"
                class="amane-actor-card"
                @click="filterActor(actor)"
              >
                <img
                  v-if="actor.image_urls?.[0]"
                  :src="amaneImage(actor.image_urls[0])"
                  loading="lazy"
                  alt=""
                />
                <span v-else class="amane-actor-placeholder">{{
                  actor.name.slice(0, 1)
                }}</span>
                <strong>{{ actor.name }}</strong>
                <small>{{ actor.count }} 部作品</small>
              </button>
            </div>
            <div v-else class="amane-empty">
              <h2>暂无演员资料</h2>
              <p>完成影片刮削后，演员会出现在这里。</p>
            </div>
          </template>
          <template v-else-if="tab === 'libraries'">
            <form class="amane-library-form" @submit.prevent="addLibrary">
              <h2>添加媒体库</h2>
              <div class="amane-form-group">
                <label class="amane-form-row"
                  ><span>名称</span
                  ><input
                    v-model="libraryName"
                    class="yb-field"
                    placeholder="我的片库"
                /></label>
                <label class="amane-form-row">
                  <span>目录</span>
                  <div class="amane-form-control">
                    <input
                      v-model="libraryPath"
                      class="yb-field"
                      placeholder="选择存放视频的目录"
                      required
                    />
                    <UiIconButton
                      icon="folder"
                      label="选择目录"
                      variant="secondary"
                      @click="chooseDirectory"
                    />
                  </div>
                </label>
                <label class="amane-form-row">
                  <span>自动化</span>
                  <select v-model="automation" class="yb-field">
                    <option value="none">手动扫描</option>
                    <option value="watch">监控新文件</option>
                    <option value="scrape">监控并刮削</option>
                  </select>
                </label>
              </div>
              <div class="amane-form-footer">
                <UiButton
                  type="submit"
                  variant="primary"
                  icon="plus"
                  label="添加并扫描"
                  :disabled="busy || !libraryPath.trim()"
                />
              </div>
            </form>
            <div class="amane-library-list">
              <article v-for="library in libraries" :key="library.id">
                <div>
                  <h3>{{ library.name }}</h3>
                  <p>{{ library.path }}</p>
                  <small
                    >{{
                      {
                        none: '手动扫描',
                        watch: '监控新文件',
                        scrape: '监控并刮削',
                      }[library.automation]
                    }}
                    ·
                    {{
                      library.auto_organize
                        ? '已开启自动整理'
                        : '保留文件原位置'
                    }}</small
                  >
                </div>
                <div class="amane-actions">
                  <UiIconButton
                    icon="scan"
                    label="扫描"
                    :disabled="busy"
                    @click="scanLibrary(library, false)"
                  />
                  <UiIconButton
                    icon="wand"
                    label="扫描并刮削"
                    :disabled="busy"
                    @click="scanLibrary(library, true)"
                  />
                  <UiIconButton
                    icon="folder"
                    label="整理：按模板把文件搬进子目录，并写出封面/海报"
                    :disabled="busy"
                    @click="organizeLibrary(library)"
                  />
                  <UiIconButton
                    icon="file"
                    label="查看文件"
                    @click="browseLibrary(library)"
                  />
                </div>
              </article>
            </div>
          </template>
          <template v-else-if="tab === 'tasks'">
            <div class="amane-toolbar">
              <select
                v-model="taskStatus"
                class="yb-field"
                aria-label="任务状态"
                @change="searchNow"
              >
                <option value="">全部任务</option>
                <option
                  v-for="s in ['queued', 'running', 'done', 'failed']"
                  :key="s"
                  :value="s"
                >
                  {{ statusNames[s] }}
                </option>
              </select>
              <UiIconButton
                :icon="workerPaused ? 'play' : 'pause'"
                :label="workerPaused ? '继续队列' : '暂停队列'"
                :disabled="busy"
                @click="setWorker(!workerPaused)"
              />
              <span class="amane-muted">{{
                workerPaused
                  ? '队列已暂停，正在运行的任务会继续完成'
                  : '队列运行中'
              }}</span>
            </div>
            <div class="amane-table-wrap">
              <table class="amane-table">
                <thead>
                  <tr>
                    <th>任务</th>
                    <th>状态</th>
                    <th>详情</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="task in tasks" :key="task.id">
                    <td>
                      <strong>{{ task.title || `任务 #${task.id}` }}</strong
                      ><small>{{ taskNames[task.type] || task.type }}</small>
                    </td>
                    <td>
                      <span :class="['amane-task-state', task.status]">{{
                        statusNames[task.status] || task.status
                      }}</span
                      ><small v-if="task.child_count"
                        >子任务 {{ task.child_status.done || 0 }}/{{
                          task.child_count
                        }}</small
                      >
                    </td>
                    <td>
                      <span class="amane-task-error">{{
                        task.error || '—'
                      }}</span>
                    </td>
                    <td>
                      <div class="amane-row-actions">
                        <UiIconButton
                          icon="info"
                          label="任务详情"
                          size="sm"
                          @click="showTask(task.id)"
                        />
                        <UiIconButton
                          v-if="task.status === 'failed'"
                          icon="refresh"
                          label="重试"
                          size="sm"
                          :disabled="busy"
                          @click="retryTask(task.id)"
                        />
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p v-if="!tasks.length" class="amane-empty">暂无任务</p>
            </div>
          </template>
          <template v-else-if="tab === 'files'">
            <div class="amane-table-wrap">
              <table class="amane-table">
                <thead>
                  <tr>
                    <th>文件</th>
                    <th>番号</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="file in files" :key="file.id">
                    <td class="amane-file-path">{{ file.path }}</td>
                    <td>
                      <input
                        v-model="fileNumbers[file.id]"
                        class="yb-field"
                        :placeholder="file.number || '输入番号'"
                        :aria-label="`文件 ${file.id} 的番号`"
                      />
                    </td>
                    <td>{{ statusNames[file.status] || file.status }}</td>
                    <td>
                      <div class="amane-row-actions">
                        <UiIconButton
                          icon="play"
                          label="播放"
                          size="sm"
                          @click="play(file.id)"
                        />
                        <UiIconButton
                          icon="livePlay"
                          label="边跑边看"
                          size="sm"
                          :disabled="busy || liveBusy || restoreRunning"
                          @click="watchLive(file.id)"
                        />
                        <UiIconButton
                          icon="sparkle"
                          label="去码"
                          size="sm"
                          :disabled="busy || restoreRunning"
                          @click="restoreFile(file.id)"
                        />
                        <UiIconButton
                          icon="range"
                          label="去码一段"
                          size="sm"
                          :disabled="busy || restoreRunning"
                          @click="rangeFile(file.id)"
                        />
                        <UiIconButton
                          icon="download"
                          label="刮削"
                          size="sm"
                          @click="scrapeFile(file)"
                        />
                        <UiIconButton
                          icon="folder"
                          label="整理：按模板把这条搬进子目录，并写出封面/海报"
                          size="sm"
                          :disabled="busy"
                          @click="organizeFile(file.id)"
                        />
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p v-if="!files.length" class="amane-empty">
                暂无关联文件，请先扫描媒体库。
              </p>
            </div>
          </template>
          <footer v-if="tab === 'tasks'" class="amane-pagination">
            <span>共 {{ total }} 项</span>
            <UiIconButton
              icon="back"
              label="上一页"
              :disabled="page === 0"
              @click="changePage(-1)"
            />
            <span>第 {{ page + 1 }} 页</span>
            <UiIconButton
              icon="forward"
              label="下一页"
              :disabled="(page + 1) * pageSize >= total"
              @click="changePage(1)"
            />
          </footer>
          <footer
            v-else-if="['films', 'actors', 'files'].includes(tab)"
            class="amane-pagination amane-pagination-auto"
          >
            <span>共 {{ total }} 项</span
            ><span v-if="loadingMore" class="amane-muted">正在加载更多…</span
            ><span
              v-else-if="(page + 1) * pageSize >= total"
              class="amane-muted"
              >已全部加载</span
            >
          </footer>
        </template>
      </main>
    </div>
    <Teleport to="body">
      <dialog
        ref="detailDialog"
        class="amane-detail-dialog"
        :aria-label="taskDetail ? '任务详情' : '影片详情'"
        @cancel.prevent="closeDetail"
        @click.self="closeDetail"
      >
        <DialogTitlebar
          :title="taskDetail ? '任务详情' : '影片详情'"
          :icon="taskDetail ? 'list' : 'movie'"
          @close="closeDetail"
        />
        <div class="amane-detail-surface">
          <p v-if="detailLoading" class="amane-loading" role="status">
            正在读取详情…
          </p>
          <AmaneFilmDetail
            v-else-if="detail"
            :detail="detail"
            :busy="busy"
            @play="play"
            @restore="restoreFile"
            @range="rangeFile"
            @organize="organizeFile"
            @live="watchLive"
            @scrape="id => scrapeFilms([id])"
            @actor="filterActor"
            @tag="filterTag"
            @tags-changed="updateDetailTags"
          />
          <div v-else-if="taskDetail" class="amane-detail-body">
            <h2>{{ taskDetail.title || `任务 #${taskDetail.id}` }}</h2>
            <p>{{ statusNames[taskDetail.status] }}</p>
            <p v-if="taskDetail.error" class="amane-task-error">
              {{ taskDetail.error }}
            </p>
            <h3>执行结果</h3>
            <pre>{{
              JSON.stringify(taskDetail.result, null, 2) || '任务尚无结果'
            }}</pre>
            <h3 v-if="taskChildren.length">子任务</h3>
            <!-- 子任务是可点的列表行，不是操作按钮 -->
            <button
              v-for="task in taskChildren"
              :key="task.id"
              type="button"
              class="amane-task-child"
              @click="showTask(task.id)"
            >
              {{ task.title || `#${task.id}` }} — {{ statusNames[task.status]
              }}<span v-if="task.error">：{{ task.error }}</span>
            </button>
          </div>
        </div>
      </dialog>
    </Teleport>
    <!-- 悬停预览(Netflix 式):悬停意图延迟后弹出,横版剧照 + 详情级信息 + 直接操作 -->
    <Teleport to="body">
      <div
        v-if="hoverFilm"
        class="amane-hover-card"
        :style="hoverStyle"
        role="tooltip"
        @mouseenter="hoverCardEnter"
        @mouseleave="filmHoverLeave"
      >
        <button
          type="button"
          class="amane-hover-hero"
          :aria-label="`查看 ${hoverFilm.title || hoverFilm.number} 详情`"
          @click="hoverOpen"
        >
          <Transition name="amane-hover-slide">
            <img
              v-if="hoverHero"
              :key="hoverHero"
              :src="hoverHero"
              alt=""
              @load="
                hoverImageLoaded(
                  ($event.target as HTMLImageElement).getAttribute('src') || ''
                )
              "
              @error="
                hoverImageFailed(
                  ($event.target as HTMLImageElement).getAttribute('src') || ''
                )
              "
            />
          </Transition>
          <span v-if="!hoverHero" class="amane-hover-hero-fallback">{{
            hoverFilm.number
          }}</span>
          <span v-if="hoverImages.length" class="amane-hover-count"
            >{{ hoverImageIndex + 1 }} / {{ hoverImages.length }}</span
          >
          <span
            v-if="
              hoverImageReady && hoverImages.length > 1 && !hoverReducedMotion
            "
            :key="hoverHero"
            class="amane-hover-progress"
            aria-hidden="true"
          />
        </button>
        <div class="amane-hover-body">
          <p class="amane-hover-number">{{ hoverFilm.number }}</p>
          <button
            type="button"
            class="amane-hover-title-btn"
            @click="hoverOpen"
          >
            <strong class="amane-hover-title">{{
              hoverFilm.title || hoverFilm.number
            }}</strong>
          </button>
          <p class="amane-hover-meta">
            <span v-if="hoverFilm.release">{{
              hoverFilm.release.slice(0, 10)
            }}</span>
            <span v-if="hoverFilm.runtime"
              >{{ Math.floor(hoverFilm.runtime / 60) }}h
              {{ hoverFilm.runtime % 60 }}m</span
            >
            <span v-if="hoverFilm.score != null" class="amane-hover-score"
              ><UiIcon name="star" size="sm" filled />{{
                hoverFilm.score.toFixed(1)
              }}</span
            >
            <span v-if="hoverFilm.file_count"
              >{{ hoverFilm.file_count }} 个文件</span
            >
          </p>
          <div class="amane-hover-actions">
            <template v-if="!isWeb && hoverFilm.file_count">
              <UiButton
                :disabled="hoverActionBusy"
                icon="play"
                label="播放"
                variant="primary"
                @click="hoverPlay"
              />
              <UiIconButton
                :disabled="hoverActionBusy"
                icon="sparkle"
                label="去码"
                variant="secondary"
                @click="hoverRestore"
              />
              <UiIconButton
                :disabled="hoverActionBusy"
                icon="range"
                label="去码一段"
                variant="secondary"
                @click="hoverRange"
              />
              <UiIconButton
                :disabled="hoverActionBusy"
                icon="livePlay"
                label="边跑边看"
                variant="secondary"
                @click="hoverLive"
              />
            </template>
            <UiIconButton
              icon="refresh"
              label="重新刮削"
              :disabled="busy || hoverActionBusy"
              variant="secondary"
              @click="hoverRescrape"
            />
            <UiIconButton
              icon="info"
              label="详情"
              variant="secondary"
              @click="hoverOpen"
            />
          </div>
          <div class="amane-hover-facts">
            <p v-if="hoverFilm.studio" class="amane-hover-fact">
              <span>制作商</span><b>{{ hoverFilm.studio }}</b>
            </p>
            <p v-if="hoverFilm.publisher" class="amane-hover-fact">
              <span>发行商</span><b>{{ hoverFilm.publisher }}</b>
            </p>
            <p v-if="hoverFilm.series" class="amane-hover-fact">
              <span>系列</span><b>{{ hoverFilm.series }}</b>
            </p>
            <p
              v-if="hoverFilm.directors?.length"
              class="amane-hover-fact is-wrap"
            >
              <span>导演</span
              ><b
                >{{ hoverFilm.directors.slice(0, 4).join(' / ')
                }}{{ hoverFilm.directors.length > 4 ? ' …' : '' }}</b
              >
            </p>
            <p v-if="hoverFilm.actors.length" class="amane-hover-fact is-wrap">
              <span>演员</span
              ><b
                >{{ hoverFilm.actors.slice(0, 8).join(' / ')
                }}{{ hoverFilm.actors.length > 8 ? ' …' : '' }}</b
              >
            </p>
            <p v-if="hoverFilm.tags.length" class="amane-hover-fact is-wrap">
              <span>标签</span
              ><b
                >{{ hoverFilm.tags.slice(0, 10).join(' · ')
                }}{{ hoverFilm.tags.length > 10 ? ' …' : '' }}</b
              >
            </p>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import DialogTitlebar from '@/components/DialogTitlebar.vue'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue'
import { useRoute } from 'vue-router'
import { useMediaQuery } from '@vueuse/core'
import { message } from 'ant-design-vue'
import type { AmaneStatus } from '../../../../shared/amane'
import {
  type AmaneActor,
  type AmaneDetail,
  type AmaneFile,
  type AmaneFilm,
  type AmaneLibrary,
  type AmaneTask,
  type AmaneUserTag,
  type Page,
  amaneImage,
  amaneRequest,
  statusNames,
  taskNames,
} from '@/api/amane'
import AgentPanel from './AgentPanel.vue'
import {
  type SegmentedOption,
  UiButton,
  UiIcon,
  UiIconButton,
  UiPosterCard,
  UiSegmented,
} from '@/components/ui'
import AdvancedSearch from './AdvancedSearch.vue'
import AmaneFilmDetail from './FilmDetail.vue'
import { openMediaPlayer } from '@/composables/use-media-player'
import { useLadaTasks } from '@/composables/use-lada-tasks'

function openGlobalSettings(section = 'scraping'): void {
  window.dispatchEvent(
    new CustomEvent('app:open-settings', {
      detail: section === 'agent' ? 'amane:agent' : 'amane',
    })
  )
}

function openAgentSettings(): void {
  openGlobalSettings('agent')
}

type Tab = 'agent' | 'films' | 'actors' | 'libraries' | 'files' | 'tasks'
/** 顶部视图切换（UiSegmented）；点当前项也会重新加载，与旧的标签按钮一致 */
const tabOptions: SegmentedOption<Tab>[] = [
  { value: 'agent', label: '智能体' },
  { value: 'films', label: '片库' },
  { value: 'actors', label: '演员' },
  { value: 'libraries', label: '媒体库' },
  { value: 'files', label: '文件' },
  { value: 'tasks', label: '任务' },
]
const tab = ref<Tab>('films'),
  status = ref<AmaneStatus | null>(null),
  busy = ref(false),
  loading = ref(false),
  error = ref('')
const route = useRoute()
const search = ref(''),
  number = ref(''),
  taskStatus = ref(''),
  page = ref(0),
  total = ref(0),
  pageSize = 36
const actorFilter = ref<number | null>(null),
  tagFilter = ref<number | null>(null),
  libraryFilter = ref<number | null>(null),
  filterLabel = ref('')
const films = ref<AmaneFilm[]>([]),
  actors = ref<AmaneActor[]>([]),
  libraries = ref<AmaneLibrary[]>([]),
  tasks = ref<AmaneTask[]>([]),
  files = ref<AmaneFile[]>([]),
  selectedIds = ref<number[]>([])
const loadingMore = ref(false)
const detailLoading = ref(false)
const detail = ref<AmaneDetail | null>(null),
  taskDetail = ref<AmaneTask | null>(null),
  taskChildren = ref<AmaneTask[]>([])
const fileNumbers = reactive<Record<number, string>>({})
const libraryName = ref(''),
  libraryPath = ref(''),
  automation = ref<'none' | 'watch' | 'scrape'>('none'),
  workerPaused = ref(false)
// Web/PWA(无 Electron 桥):Amane 经 vite 同源代理直连,视为已连接(令牌由接入链接注入)。
const isWeb = !window.api?.amane
const connected = computed(() => isWeb || status.value?.state === 'running')
// 首次打开时后台还在启动：区分“加载中”和“未连接”，避免闪出连接设置空状态。
const connecting = ref(true)
const advancedOpen = ref(false)
const advancedFilters = ref<Record<string, string[]>>({})
type MetadataSortField =
  | 'updated_at'
  | 'created_at'
  | 'number'
  | 'title'
  | 'studio'
  | 'release'
  | 'score'
  | 'file_count'
// 评分通过前端完整结果排序，其余字段交由 Amane 后台排序。
const sortOptions: { value: MetadataSortField; label: string }[] = [
  { value: 'updated_at', label: '更新时间' },
  { value: 'created_at', label: '创建时间' },
  { value: 'number', label: '番号' },
  { value: 'title', label: '标题' },
  { value: 'studio', label: '制作商' },
  { value: 'release', label: '发行日期' },
  { value: 'score', label: '评分' },
  { value: 'file_count', label: '关联文件' },
]
const sortField = ref<MetadataSortField>('updated_at'),
  sortOrder = ref<'asc' | 'desc'>('desc'),
  sortOpen = ref(false)
const sortWrapper = ref<HTMLElement | null>(null),
  sortButton = ref<InstanceType<typeof UiButton> | null>(null)
const sortLabel = computed(
  () =>
    sortOptions.find(option => option.value === sortField.value)?.label ||
    '更新时间'
)

/** 海报卡的封面：优先竖版海报，没有时退到横版缩略图 */
function filmCover(film: AmaneFilm): string | undefined {
  const url = film.poster_url || film.poster_urls?.[0] || film.thumb_url
  return url ? amaneImage(url) : undefined
}

/** 海报卡的一行副标题：番号（标题缺失时已作标题，不重复）· 前两位演员，没有演员时用发行年份 */
function filmSubtitle(film: AmaneFilm): string {
  const extra = film.actors.length
    ? film.actors.slice(0, 2).join(' / ')
    : film.release?.slice(0, 4)
  return [film.title ? film.number : '', extra].filter(Boolean).join(' · ')
}

function applyAdvanced(filters: Record<string, string[]>): void {
  advancedFilters.value = filters
  searchNow()
}

let generation = 0,
  detailGeneration = 0,
  disposed = false,
  pollTimer: ReturnType<typeof setTimeout> | undefined
const detailDialog = ref<HTMLDialogElement | null>(null)
let previousFocus: HTMLElement | null = null
watch(
  () => Boolean(detail.value || taskDetail.value || detailLoading.value),
  async visible => {
    if (visible) {
      previousFocus = document.activeElement as HTMLElement | null
      await nextTick()
      if (
        !disposed &&
        (detail.value || taskDetail.value || detailLoading.value) &&
        !detailDialog.value?.open
      ) {
        detailDialog.value?.showModal()
        if (detailDialog.value) detailDialog.value.scrollTop = 0
      }
    } else {
      detailDialog.value?.close()
      if (previousFocus?.isConnected)
        previousFocus.focus({ preventScroll: true })
    }
  }
)
onDeactivated(() => {
  hideHover()
  closeDetail()
  detailDialog.value?.close()
})
watch(
  () => route.query.q,
  query => {
    search.value = typeof query === 'string' ? query : ''
    sortOpen.value = false
    tab.value = 'films'
    searchNow()
  }
)

async function run(action: () => Promise<void>): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await action()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

let scoredFilmsCache: { key: string; items: AmaneFilm[] } | null = null

async function load(silent = false, append = false): Promise<void> {
  if (!connected.value || tab.value === 'agent') return
  const current = ++generation,
    currentTab = tab.value
  if (!silent) loading.value = true
  else if (append) loadingMore.value = true
  const query = new URLSearchParams({
    offset: String(page.value * pageSize),
    limit: String(pageSize),
  })
  if (search.value.trim() && ['films', 'actors', 'files'].includes(currentTab))
    query.set('search', search.value.trim())
  if (currentTab === 'films') {
    query.set(
      'sort_by',
      sortField.value === 'score' ? 'updated_at' : sortField.value
    )
    query.set('order', sortField.value === 'score' ? 'desc' : sortOrder.value)
    for (const [key, values] of Object.entries(advancedFilters.value))
      for (const value of values) query.append(key, value)
    if (actorFilter.value) query.set('actor_id', String(actorFilter.value))
    if (tagFilter.value) query.set('tag_id', String(tagFilter.value))
  }
  if (currentTab === 'files' && libraryFilter.value)
    query.set('library_id', String(libraryFilter.value))
  if (currentTab === 'tasks' && taskStatus.value)
    query.set('status', taskStatus.value)
  const resources: Record<string, string> = {
    films: 'metadata',
    actors: 'actors',
    libraries: 'libraries',
    tasks: 'tasks',
    files: 'media',
  }
  try {
    let result: Page<
      AmaneFilm | AmaneActor | AmaneLibrary | AmaneTask | AmaneFile
    >
    if (currentTab === 'films' && sortField.value === 'score') {
      const allQuery = new URLSearchParams(query)
      allQuery.delete('offset')
      allQuery.delete('limit')
      const direction = sortOrder.value
      const key = `${allQuery}|${direction}`
      if (!append || scoredFilmsCache?.key !== key) {
        const items: AmaneFilm[] = []
        let count = Infinity
        while (items.length < count) {
          allQuery.set('offset', String(items.length))
          allQuery.set('limit', '200')
          const batch = await amaneRequest<Page<AmaneFilm>>(
            `/metadata?${allQuery}`
          )
          if (disposed || current !== generation) return
          if (!batch.items.length) break
          items.push(...batch.items)
          count = batch.total
        }
        const unique = Array.from(
          new Map(items.map(item => [item.id, item])).values()
        )
        unique.sort((a, b) => {
          if (a.score == null && b.score != null) return 1
          if (b.score == null && a.score != null) return -1
          const difference = (a.score ?? 0) - (b.score ?? 0)
          return (
            (direction === 'asc' ? difference : -difference) ||
            (b.release || '').localeCompare(a.release || '') ||
            a.id - b.id
          )
        })
        scoredFilmsCache = { key, items: unique }
      }
      const items = scoredFilmsCache!.items
      result = {
        items: items.slice(page.value * pageSize, (page.value + 1) * pageSize),
        total: items.length,
      }
    } else {
      scoredFilmsCache = null
      result = await amaneRequest<
        Page<AmaneFilm | AmaneActor | AmaneLibrary | AmaneTask | AmaneFile>
      >(`/${resources[currentTab]}?${query}`)
    }
    if (disposed || current !== generation) return
    total.value = result.total || 0
    const merge = (current: unknown[], items: unknown[]): unknown[] =>
      append ? [...(current as never[]), ...(items as never[])] : items
    if (currentTab === 'films')
      films.value = merge(films.value, result.items) as AmaneFilm[]
    const hoveredId = hoverFilm.value?.id
    if (currentTab === 'films' && !append) {
      hoverFileCache.clear()
      if (hoveredId && !films.value.some(item => item.id === hoveredId))
        hideHover()
    }
    if (currentTab === 'actors')
      actors.value = merge(actors.value, result.items) as AmaneActor[]
    if (currentTab === 'libraries')
      libraries.value = result.items as AmaneLibrary[]
    if (currentTab === 'files')
      files.value = merge(files.value, result.items) as AmaneFile[]
    if (currentTab === 'tasks') {
      tasks.value = result.items as AmaneTask[]
      const worker = await amaneRequest<{ paused: boolean }>('/tasks/worker')
      if (current === generation) workerPaused.value = worker.paused
    }
  } catch (e) {
    if (current === generation) {
      error.value = (e as Error).message
      if (append) page.value = Math.max(0, page.value - 1)
    }
  } finally {
    if (current === generation) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

async function refreshAll(): Promise<void> {
  await run(async () => {
    if (window.api?.amane) status.value = await window.api.amane.status()
    await load()
  })
}

async function connect(): Promise<void> {
  await run(async () => {
    connecting.value = true
    try {
      status.value = await window.api.amane.start()
      if (connected.value) await load()
      else error.value = status.value.error || 'Amane 未能启动'
    } finally {
      connecting.value = false
    }
  })
}

function switchTab(next: Tab): void {
  hideHover()
  closeDetail()
  sortOpen.value = false
  tab.value = next
  page.value = 0
  search.value = ''
  selectedIds.value = []
  void load()
}

function searchNow(): void {
  page.value = 0
  selectedIds.value = []
  void load()
}

function chooseSort(field: MetadataSortField): void {
  if (sortField.value === field)
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  else {
    sortField.value = field
    sortOrder.value = 'desc'
  }
  sortOpen.value = false
  ;(sortButton.value?.$el as HTMLButtonElement | undefined)?.focus()
  searchNow()
}

function onSortOutside(event: MouseEvent): void {
  if (sortOpen.value && !sortWrapper.value?.contains(event.target as Node))
    sortOpen.value = false
}

function changePage(delta: number): void {
  page.value += delta
  void load()
}

async function loadMore(): Promise<void> {
  page.value += 1
  await load(true, true)
}

function onListScroll(event: Event): void {
  hideHover()
  const list = event.target as HTMLElement
  if (list.scrollHeight <= 0) return
  if (!['films', 'actors', 'files'].includes(tab.value)) return
  if (loading.value || loadingMore.value || !connected.value) return
  if ((page.value + 1) * pageSize >= total.value) return
  if (list.scrollTop + list.clientHeight >= list.scrollHeight - 480)
    void loadMore()
}

function closeDetail(): void {
  detailGeneration++
  detailLoading.value = false
  detail.value = null
  taskDetail.value = null
  taskChildren.value = []
}

// ── 悬停预览(Netflix 式)────────────────────────────────
const hoverFilm = ref<AmaneFilm | null>(null)
const hoverStyle = ref<Record<string, string>>({})
let hoverTimer: number | undefined
let hoverHideTimer: number | undefined
/** 仅精确指针启用:触屏不做悬停预览 */
const hoverReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const hoverImageIndex = ref(0)
const hoverImageReady = ref(false)
const hoverFailedImages = ref<string[]>([])
let hoverSlideTimer: ReturnType<typeof setTimeout> | undefined
const hoverImages = computed(() => {
  const film = hoverFilm.value
  if (!film) return []
  const stills = [...new Set((film.extrafanart || []).filter(Boolean))]
  const candidates = stills.length
    ? stills
    : [film.poster_url || film.poster_urls?.[0] || film.thumb_url]
  return candidates
    .filter((url): url is string => Boolean(url))
    .map(amaneImage)
    .filter(url => !hoverFailedImages.value.includes(url))
})
const hoverHero = computed(() => hoverImages.value[hoverImageIndex.value] || '')

function stopHoverSlides(): void {
  clearTimeout(hoverSlideTimer)
  hoverImageReady.value = false
}

function hoverImageLoaded(url: string): void {
  if (!hoverFilm.value || url !== hoverHero.value) return
  stopHoverSlides()
  hoverImageReady.value = true
  if (hoverReducedMotion.value || hoverImages.value.length < 2) return
  hoverSlideTimer = setTimeout(() => {
    hoverImageReady.value = false
    hoverImageIndex.value =
      (hoverImageIndex.value + 1) % hoverImages.value.length
  }, 2400)
}

function hoverImageFailed(url: string): void {
  if (!url || url !== hoverHero.value) return
  stopHoverSlides()
  hoverFailedImages.value = [...hoverFailedImages.value, url]
  if (hoverImageIndex.value >= hoverImages.value.length)
    hoverImageIndex.value = 0
}

watch(
  () => hoverFilm.value?.id,
  () => {
    stopHoverSlides()
    hoverFailedImages.value = []
    hoverImageIndex.value = 0
  },
  { flush: 'sync' }
)
watch(hoverReducedMotion, () => {
  stopHoverSlides()
  hoverImageIndex.value = 0
  if (hoverHero.value) hoverImageLoaded(hoverHero.value)
})
onBeforeUnmount(stopHoverSlides)
onDeactivated(stopHoverSlides)
const hoverActionBusy = ref(false)
const hoverFileCache = new Map<number, number | null>()

/** 列表项不含文件 ID;点操作时按影片拉一次详情并缓存。 */
async function firstFileId(filmId: number): Promise<number | null> {
  const cached = hoverFileCache.get(filmId)
  if (cached !== undefined) return cached
  const detail = await amaneRequest<AmaneDetail>(`/metadata/${filmId}`)
  const id = detail.files[0]?.id ?? null
  hoverFileCache.set(filmId, id)
  return id
}

async function hoverFileAction(
  action: (fileId: number) => Promise<void>
): Promise<void> {
  const film = hoverFilm.value
  if (!film || hoverActionBusy.value) return
  hoverActionBusy.value = true
  try {
    const id = await firstFileId(film.id)
    if (id === null) {
      message.info('该影片还没有关联本地文件')
      return
    }
    hideHover()
    await action(id)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    hoverActionBusy.value = false
  }
}

const hoverPlay = (): Promise<void> => hoverFileAction(play)
const hoverRestore = (): Promise<void> => hoverFileAction(restoreFile)
const hoverRange = (): Promise<void> => hoverFileAction(rangeFile)
const hoverLive = (): Promise<void> => hoverFileAction(watchLive)

function hoverRescrape(): void {
  const film = hoverFilm.value
  if (!film) return
  void scrapeFilms([film.id])
}

function hideHover(): void {
  clearTimeout(hoverTimer)
  clearTimeout(hoverHideTimer)
  if (hoverFilm.value) hoverFilm.value = null
}

function showHover(film: AmaneFilm, el: HTMLElement): void {
  if (disposed) return
  const rect = el.getBoundingClientRect()
  const width = 400,
    margin = 10,
    estHeight = 540
  const rightRoom = window.innerWidth - rect.right
  const leftRoom = rect.left
  let left: number
  if (rightRoom >= width + margin) left = rect.right + margin
  else if (leftRoom >= width + margin) left = rect.left - width - margin
  else
    left = Math.min(
      Math.max(margin, rect.right - width / 2),
      window.innerWidth - width - margin
    )
  const top = Math.min(
    Math.max(margin, rect.top - 10),
    Math.max(margin, window.innerHeight - estHeight - margin)
  )
  hoverStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
  }
  hoverFilm.value = film
}

function filmHoverEnter(film: AmaneFilm, event: PointerEvent): void {
  if (event.pointerType === 'touch' || disposed || selectedIds.value.length)
    return
  clearTimeout(hoverTimer)
  clearTimeout(hoverHideTimer)
  if (hoverFilm.value?.id === film.id) return
  const el = event.currentTarget as HTMLElement
  hoverTimer = window.setTimeout(() => showHover(film, el), 420)
}

function filmHoverLeave(): void {
  clearTimeout(hoverTimer)
  clearTimeout(hoverHideTimer)
  hoverHideTimer = window.setTimeout(() => {
    hoverFilm.value = null
  }, 180)
}

function hoverCardEnter(): void {
  clearTimeout(hoverHideTimer)
  clearTimeout(hoverTimer)
}

function hoverOpen(): void {
  const film = hoverFilm.value
  if (!film) return
  hideHover()
  void openFilm(film.id)
}

function toggleSelect(id: number): void {
  hideHover()
  const index = selectedIds.value.indexOf(id)
  if (index >= 0) selectedIds.value.splice(index, 1)
  else selectedIds.value.push(id)
}

async function openFilm(id: number): Promise<void> {
  hideHover()
  const current = ++detailGeneration
  detailLoading.value = true
  taskDetail.value = null
  try {
    const result = await amaneRequest<AmaneDetail>(`/metadata/${id}`)
    if (!disposed && current === detailGeneration) detail.value = result
  } catch (e) {
    if (current === detailGeneration) {
      detail.value = null
      error.value = (e as Error).message
    }
  } finally {
    if (current === detailGeneration) detailLoading.value = false
  }
}

function updateDetailTags(id: number, tags: AmaneUserTag[]): void {
  if (detail.value?.metadata.id === id) detail.value.user_tags = tags
}

function filterActor(actor: { id: number; name: string }): void {
  if (!actor.id) return
  actorFilter.value = actor.id
  tagFilter.value = null
  filterLabel.value = actor.name
  closeDetail()
  switchTab('films')
}

function filterTag(name: string, id: number): void {
  if (!id) return
  tagFilter.value = id
  actorFilter.value = null
  filterLabel.value = name
  closeDetail()
  switchTab('films')
}

function clearFilters(): void {
  actorFilter.value = null
  tagFilter.value = null
  filterLabel.value = ''
  searchNow()
}

async function scrapeNumber(): Promise<void> {
  await run(async () => {
    await amaneRequest('/tasks', 'POST', {
      type: 'scrape',
      number: number.value.trim(),
    })
    number.value = ''
    message.success('已加入 Amane 刮削队列')
    switchTab('tasks')
  })
}

async function scrapeFilms(ids: number[]): Promise<void> {
  await run(async () => {
    await amaneRequest('/metadata/batch/scrape', 'POST', { ids })
    selectedIds.value = []
    message.success('已加入 Amane 刮削队列')
  })
}

async function play(id: number): Promise<void> {
  await run(async () => {
    if (isWeb)
      throw new Error('手机/网页端暂不支持本地文件播放，请在桌面客户端打开')
    const result = await window.api.amane.resolveMedia(id)
    if (!result.success || !result.filePath)
      throw new Error(result.error || '无法播放关联文件')
    // 同目录若已有 .restored.mp4（去码产物），优先播它
    let target = result.filePath
    let restored = false
    try {
      const preferred = await window.api.lada.playablePath(result.filePath)
      if (preferred?.path) {
        target = preferred.path
        restored = Boolean(preferred.restored)
      }
    } catch {
      /* 探测失败就播原片 */
    }
    const title = target.split(/[\\/]/).pop() || '正在播放'
    // 交给统一播放器，遵循设置中的播放器引擎（内置 / mpv）。
    if (!(await openMediaPlayer({ filePath: target, title })))
      throw new Error('无法打开播放器，请完全重启应用后重试')
    if (restored) message.success('正在播放无码版本')
  })
}

// ── 去马赛克（lada）/ 边跑边看 ──────────────────────────────
// 状态与动作都在 useLadaTasks 里（刮削队列面板展示同一份），这里只负责找到文件路径。
const {
  restoreRunning,
  liveBusy,
  startRestoreSmart,
  startRangeSmart,
  startLive,
} = useLadaTasks()

/** 找到文件路径并发起去码 */
async function restoreFile(id: number): Promise<void> {
  const file =
    detail.value?.files?.find(item => item.id === id) ||
    files.value.find(item => item.id === id)
  if (!file?.path) {
    message.error('找不到该文件的路径')
    return
  }
  await run(async () => {
    if (isWeb) throw new Error('去码仅在桌面客户端可用')
    await startRestoreSmart(file.path)
  })
}

/** 区间去码：只处理指定的那一段（跑完自动播放） */
async function rangeFile(id: number): Promise<void> {
  const file =
    detail.value?.files?.find(item => item.id === id) ||
    files.value.find(item => item.id === id)
  if (!file?.path) {
    message.error('找不到该文件的路径')
    return
  }
  await run(async () => {
    if (isWeb) throw new Error('去码仅在桌面客户端可用')
    await startRangeSmart(file.path)
  })
}

/** 边跑边看（追播）：起 lada 后把 m3u8 交给播放器 */
async function watchLive(id: number): Promise<void> {
  if (isWeb) return
  const file =
    detail.value?.files?.find(item => item.id === id) ||
    files.value.find(item => item.id === id)
  if (!file?.path) {
    message.error('找不到该文件的路径')
    return
  }
  await startLive(file.path)
}

// ── 整理（organize）─────────────────────────────────────────
// 影盒以前没有任何地方能提交整理任务，而「封面/海报」（水印就打在它们上面）只在整理时写出。
// 整理不刮削、不改元数据，只按已有的刮削信息落盘；但**会移动视频文件**，所以每次都先问一句。
function findFile(id: number): AmaneFile | undefined {
  return (
    detail.value?.files?.find(item => item.id === id) ||
    files.value.find(item => item.id === id)
  )
}

/** 整理指定文件（同一媒体库内可以多个） */
async function organizeFiles(targets: AmaneFile[]): Promise<void> {
  const usable = targets.filter(file => file.metadata_id)
  if (!usable.length) {
    message.info('这些文件还没有刮削信息，整理会直接跳过它们（先去「刮削」）')
    return
  }
  const preview = usable.map(file => file.path).join('\n')
  const head =
    usable.length === 1
      ? '整理这一条会做三件事：\n· 按媒体库模板把视频搬进子目录（文件会被移动）\n· 在旁边写出封面/海报（水印打在这两个文件上）\n· 写出 .nfo'
      : `整理这 ${usable.length} 条会移动这些视频文件，并在旁边写出封面/海报与 .nfo：`
  if (!window.confirm(`${head}\n\n${preview}\n\n确定继续？`)) return
  await run(async () => {
    await amaneRequest('/tasks', 'POST', {
      type: 'organize',
      library_id: usable[0].library_id,
      media_file_ids: usable.map(file => file.id),
    })
    message.success(`已加入整理队列（${usable.length} 条），去「任务」看结果`)
    switchTab('tasks')
  })
}

async function organizeFile(id: number): Promise<void> {
  const file = findFile(id)
  if (!file) {
    message.error('找不到该文件')
    return
  }
  await organizeFiles([file])
}

/** 整理整个媒体库：范围最大，会把库里所有**已刮削**的文件都按模板搬一遍 */
async function organizeLibrary(library: AmaneLibrary): Promise<void> {
  const ok = window.confirm(
    `整理整个媒体库「${library.name}」？\n\n` +
      '会把库里所有已刮削的文件按模板搬进子目录，并重新写出封面/海报与 .nfo；\n' +
      '视频文件会被移动，搬空后的目录会被删除。\n\n' +
      '如果只想试一下，建议先到「文件」里对单条点「整理」。确定继续？'
  )
  if (!ok) return
  await run(async () => {
    await amaneRequest('/tasks', 'POST', {
      type: 'organize',
      library_id: library.id,
    })
    message.success('已加入整理队列（整个媒体库），去「任务」看结果')
    switchTab('tasks')
  })
}

async function chooseDirectory(): Promise<void> {
  if (isWeb || !window.api?.dialog) return
  const selected = await window.api.dialog.selectDirectory()
  if (selected) libraryPath.value = selected
}

async function addLibrary(): Promise<void> {
  await run(async () => {
    await amaneRequest('/libraries', 'POST', {
      name: libraryName.value.trim() || null,
      path: libraryPath.value.trim(),
      automation: automation.value,
      auto_organize: false,
      scan: true,
    })
    libraryPath.value = ''
    libraryName.value = ''
    message.success('媒体库已添加，扫描任务已提交')
    await load()
  })
}

async function scanLibrary(
  library: AmaneLibrary,
  scrape: boolean
): Promise<void> {
  await run(async () => {
    await amaneRequest('/tasks', 'POST', {
      type: 'refresh',
      library_id: library.id,
      path: library.path,
      scan: ['add'],
      scrape: scrape ? ['pending', 'failed'] : [],
    })
    message.success(scrape ? '扫描和刮削任务已提交' : '扫描任务已提交')
  })
}

function browseLibrary(library: AmaneLibrary): void {
  libraryFilter.value = library.id
  switchTab('files')
}

async function retryTask(id: number): Promise<void> {
  await run(async () => {
    await amaneRequest('/tasks/batch', 'POST', {
      action: 'retry',
      task_ids: [id],
    })
    await load()
  })
}

async function setWorker(paused: boolean): Promise<void> {
  await run(async () => {
    await amaneRequest(`/tasks/worker/${paused ? 'pause' : 'resume'}`, 'POST')
    workerPaused.value = paused
  })
}

async function showTask(id: number): Promise<void> {
  const current = ++detailGeneration
  detailLoading.value = false
  try {
    const task = await amaneRequest<AmaneTask>(`/tasks/${id}`)
    const children = task.child_count
      ? await amaneRequest<Page<AmaneTask>>(`/tasks/${id}/children?limit=100`)
      : { items: [] }
    if (current !== detailGeneration || disposed) return
    detail.value = null
    taskDetail.value = task
    taskChildren.value = children.items
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function scrapeFile(file: AmaneFile): Promise<void> {
  const number = (fileNumbers[file.id] || file.number || '').trim()
  if (!number) {
    message.info('请先在文件的番号栏输入番号')
    return
  }
  await run(async () => {
    if (number !== file.number)
      await amaneRequest(`/media/${file.id}`, 'PATCH', { number })
    await amaneRequest('/tasks', 'POST', {
      type: 'scrape',
      media_id: file.id,
      number,
    })
    message.success('已加入 Amane 刮削队列')
  })
}

async function poll(): Promise<void> {
  if (disposed) return
  if (!busy.value) {
    try {
      if (window.api?.amane) status.value = await window.api.amane.status()
      // 后台就绪后自动出片库；连接成功后由页面自身重试，不在这里启动后台。
      if (connected.value && ['tasks', 'films', 'files'].includes(tab.value))
        await load(true)
    } catch {
      /* the next manual connection reports the error */
    }
  }
  if (!disposed) pollTimer = setTimeout(() => void poll(), 7000)
}

onMounted(async () => {
  document.addEventListener('click', onSortOutside)
  // 去码进度与边跑边看状态由 useLadaTasks 统一接推送（刮削队列面板也在用）
  search.value = typeof route.query.q === 'string' ? route.query.q : ''
  if (isWeb) {
    connecting.value = false
    void poll()
    return
  }
  try {
    status.value = await window.api.amane.status()
    if (
      status.value.settings.executablePath ||
      status.value.settings.mode === 'external' ||
      status.value.settings.devSource
    )
      await connect()
    else {
      connecting.value = false
      openGlobalSettings()
    }
    void poll()
  } catch (e) {
    connecting.value = false
    error.value = (e as Error).message
  }
})
onBeforeUnmount(() => {
  disposed = true
  generation++
  detailGeneration++
  clearTimeout(pollTimer)
  document.removeEventListener('click', onSortOutside)
})
</script>

<style src="./amane.css"></style>
