<template>
  <div class="queue-page">
    <div class="queue-header">
      <h2>下载队列</h2>
      <button class="refresh-btn" @click="loadQueue" :disabled="loading">
        {{ loading ? '刷新中...' : '刷新' }}
      </button>
    </div>

    <div v-if="loading" class="status-tip">加载中...</div>
    <div v-else-if="queue.length === 0" class="status-tip">队列为空</div>
    <ul v-else class="queue-list">
      <li v-for="(item, index) in queue" :key="index" class="queue-item">
        <span class="queue-index">{{ index + 1 }}</span>
        <span class="queue-id">{{ item }}</span>
        <span class="queue-badge">待下载</span>
      </li>
    </ul>
  </div>
</template>

<script>
import videosApi from '../api/videos'

export default {
  name: 'QueueView',
  data() {
    return {
      queue: [],
      loading: false
    }
  },
  mounted() {
    this.loadQueue()
    this.timer = setInterval(this.loadQueue, 5000)
  },
  beforeUnmount() {
    clearInterval(this.timer)
  },
  methods: {
    async loadQueue() {
      this.loading = true
      try {
        this.queue = await videosApi.getQueue()
      } catch (e) {
        console.error('获取队列失败', e)
      } finally {
        this.loading = false
      }
    }
  }
}
</script>

<style scoped>
.queue-page {
  max-width: 700px;
  margin: 0 auto;
}

.queue-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.5rem;
}

.queue-header h2 {
  color: var(--text-color);
  margin: 0;
}

.refresh-btn {
  background: var(--primary-color);
  color: white;
  border: none;
  padding: 8px 18px;
  border-radius: 20px;
  cursor: pointer;
  font-size: 14px;
}

.refresh-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.status-tip {
  text-align: center;
  color: #aaa;
  padding: 3rem 0;
  font-size: 1rem;
}

.queue-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.queue-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.9rem 1.2rem;
  background: white;
  border-radius: 12px;
  margin-bottom: 0.7rem;
  box-shadow: 0 2px 8px rgba(255, 107, 139, 0.08);
}

.queue-index {
  color: #ccc;
  font-size: 0.9rem;
  width: 24px;
  text-align: right;
  flex-shrink: 0;
}

.queue-id {
  flex: 1;
  font-weight: 500;
  color: var(--text-color);
  letter-spacing: 0.05em;
}

.queue-badge {
  font-size: 0.75rem;
  background: #fff0f3;
  color: var(--secondary-color);
  padding: 3px 10px;
  border-radius: 20px;
}
</style>
