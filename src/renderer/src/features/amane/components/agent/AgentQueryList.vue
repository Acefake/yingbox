<template>
  <div class="agent-query-list primary-scroll">
    <p v-if="!queries.length" class="amane-muted">
      暂无查询预设。可以让智能体查询片库并保存查询。
    </p>
    <article v-for="query in queries" :key="query.id" class="agent-query">
      <strong>{{ query.name }}</strong>
      <p>{{ query.description }}</p>
      <details>
        <summary>查询语句</summary>
        <pre>{{ query.sql }}</pre>
      </details>
      <div class="agent-query-actions">
        <UiIconButton
          icon="eye"
          label="查看结果"
          :disabled="busy"
          @click="emit('view', query.id, 0)"
        />
        <UiIconButton
          v-if="!query.persisted"
          icon="bookmark"
          label="保留预设"
          :disabled="busy"
          @click="emit('action', query.id, 'persist')"
        />
        <UiIconButton
          icon="trash"
          label="删除查询预设"
          danger
          :disabled="busy"
          @click="emit('action', query.id, 'delete')"
        />
      </div>
    </article>
    <div v-if="result" class="agent-query-result">
      <div class="agent-query-actions">
        <span>共 {{ result.total }} 行</span
        ><UiIconButton
          icon="download"
          label="导出当前查询结果为 CSV"
          @click="emit('export')"
        />
      </div>
      <div class="amane-table-wrap">
        <table class="amane-table">
          <thead>
            <tr>
              <th v-for="column in result.columns" :key="column">
                {{ column }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in result.rows" :key="index">
              <td v-for="(value, cell) in row" :key="cell">
                {{ cellText(value) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="agent-query-actions">
        <UiIconButton
          icon="back"
          label="上一页"
          :disabled="busy || offset === 0"
          @click="emit('view', queryId, offset - QUERY_PAGE_SIZE)"
        /><UiIconButton
          icon="forward"
          label="下一页"
          :disabled="busy || offset + QUERY_PAGE_SIZE >= result.total"
          @click="emit('view', queryId, offset + QUERY_PAGE_SIZE)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/** 查询预设列表与当前预设的分页结果表（只展示，操作交给父级）。 */
import { UiIconButton } from '@/components/ui'
import type { QueryResult, SavedQuery } from '../../api/amane-agent'
import { QUERY_PAGE_SIZE, cellText } from '../../utils/agent'

defineProps<{
  queries: SavedQuery[]
  result: QueryResult | null
  queryId: number
  offset: number
  busy: boolean
}>()
const emit = defineEmits<{
  view: [id: number, offset: number]
  action: [id: number, action: 'persist' | 'delete']
  export: []
}>()
</script>
