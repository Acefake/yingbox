<template>
  <div class="meta-page">
    <div v-if="loading" class="status-tip">正在从 JavBus 获取数据...</div>
    <div v-else-if="error" class="status-tip error">{{ error }}</div>

    <div v-else-if="meta" class="meta-content">
      <div class="meta-hero">
        <img class="meta-cover" :src="proxyImg(meta.cover)" :alt="meta.avid" />
        <div class="meta-info">
          <h2>{{ meta.title }}</h2>
          <div class="meta-tags">
            <span class="tag">{{ meta.avid }}</span>
            <span class="tag" v-if="meta.release_date">{{
              meta.release_date
            }}</span>
            <span class="tag" v-if="meta.duration">{{ meta.duration }}</span>
          </div>
          <p class="meta-desc" v-if="meta.description">
            {{ meta.description }}
          </p>

          <div
            class="meta-actresses"
            v-if="meta.actress && Object.keys(meta.actress).length"
          >
            <h4>演员</h4>
            <div class="actress-list">
              <div
                class="actress-item"
                v-for="(img, name) in meta.actress"
                :key="name"
              >
                <img :src="proxyImg(img)" :alt="name" />
                <span>{{ name }}</span>
              </div>
            </div>
          </div>

          <div
            class="meta-keywords"
            v-if="meta.keywords && meta.keywords.length"
          >
            <span class="kw" v-for="kw in meta.keywords" :key="kw">{{
              kw
            }}</span>
          </div>

          <button class="add-btn" @click="addVideo" :disabled="adding">
            {{ adding ? '添加中...' : '加入下载队列' }}
          </button>
        </div>
      </div>

      <div class="fanart-grid" v-if="meta.fanarts && meta.fanarts.length">
        <h3>预览图</h3>
        <div class="fanart-list">
          <img
            v-for="(img, i) in meta.fanarts"
            :key="i"
            :src="proxyImg(img)"
            @click="previewImg = proxyImg(img)"
          />
        </div>
      </div>
    </div>

    <!-- 图片预览遮罩 -->
    <div class="preview-mask" v-if="previewImg" @click="previewImg = null">
      <img :src="previewImg" />
    </div>
  </div>
</template>

<script>
import videosApi, { proxyImg } from '../api/videos'

export default {
  name: 'MetaView',
  props: ['id'],
  data() {
    return {
      meta: null,
      loading: false,
      error: null,
      adding: false,
      previewImg: null,
    }
  },
  async created() {
    this.loading = true
    try {
      const data = await videosApi.getMeta(this.id)
      if (data.error) {
        this.error = `获取失败: ${data.error}`
      } else {
        this.meta = data
      }
    } catch (e) {
      this.error = `请求失败: ${e.message}`
    } finally {
      this.loading = false
    }
  },
  methods: {
    proxyImg,
    async addVideo() {
      this.adding = true
      try {
        await videosApi.addVideo(this.id)
      } finally {
        this.adding = false
      }
    },
  },
}
</script>

<style scoped>
.meta-page {
  max-width: 1100px;
  margin: 0 auto;
}

.status-tip {
  text-align: center;
  color: #aaa;
  padding: 4rem 0;
  font-size: 1rem;
}
.status-tip.error {
  color: #ff6b8b;
}

.meta-hero {
  display: flex;
  gap: 2rem;
  background: white;
  border-radius: 16px;
  padding: 2rem;
  box-shadow: 0 4px 20px rgba(255, 107, 139, 0.08);
  margin-bottom: 2rem;
}

.meta-cover {
  width: 220px;
  flex-shrink: 0;
  border-radius: 10px;
  object-fit: cover;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
}

.meta-info {
  flex: 1;
}

.meta-info h2 {
  color: var(--text-color);
  font-size: 1.3rem;
  margin: 0 0 1rem;
  line-height: 1.5;
}

.meta-tags {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}

.tag {
  background: #fff0f3;
  color: var(--secondary-color);
  padding: 3px 12px;
  border-radius: 20px;
  font-size: 0.85rem;
}

.meta-desc {
  color: #888;
  font-size: 0.9rem;
  line-height: 1.6;
  margin-bottom: 1rem;
}

.meta-actresses h4 {
  color: var(--text-color);
  margin: 0.5rem 0;
  font-size: 0.95rem;
}

.actress-list {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}

.actress-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 0.8rem;
  color: var(--text-color);
}

.actress-item img {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--accent-color);
}

.meta-keywords {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 1.5rem;
}

.kw {
  background: #f5f5f5;
  color: #888;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 0.8rem;
}

.add-btn {
  background: linear-gradient(
    135deg,
    var(--primary-color),
    var(--secondary-color)
  );
  color: white;
  border: none;
  padding: 10px 28px;
  border-radius: 24px;
  cursor: pointer;
  font-size: 1rem;
  font-weight: 500;
  transition: opacity 0.2s;
}

.add-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.fanart-grid h3 {
  color: var(--text-color);
  margin-bottom: 1rem;
}

.fanart-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.fanart-list img {
  width: 100%;
  border-radius: 8px;
  cursor: pointer;
  object-fit: cover;
  aspect-ratio: 16/9;
  transition: transform 0.2s;
}

.fanart-list img:hover {
  transform: scale(1.03);
}

.preview-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  cursor: pointer;
}

.preview-mask img {
  max-width: 90vw;
  max-height: 90vh;
  border-radius: 8px;
}

@media (max-width: 600px) {
  .meta-hero {
    flex-direction: column;
  }
  .meta-cover {
    width: 100%;
  }
}
</style>
