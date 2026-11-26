<template>
  <!--
    搜索对话 —— 一个弹层,按标题筛已加载的会话。

    <p>⚠️ 为什么是「已加载的」:
       后端的 /chat/list 是**游标翻页**,没有「按关键词搜」这个接口。
       所以这里搜的是前端已经拿在手里的那些(首页 20 条 + 点过「加载更多」的)。
       弹层里写明了这一点 —— 说成「搜索所有对话」就是在骗人。
  -->
  <a-modal
    :open="open"
    title="搜索对话"
    :footer="null"
    width="480"
    @cancel="$emit('close')"
  >
    <a-input
      v-model:value="keyword"
      placeholder="按标题搜索已加载的对话"
      allow-clear
      autofocus
    />

    <div class="search-list">
      <button
        v-for="c in results"
        :key="c.uuid"
        type="button"
        class="search-item"
        @click="pick(c.uuid)"
      >
        <span class="search-title truncate">{{ c.title }}</span>
        <span class="search-time">{{ c.time }}</span>
      </button>

      <p v-if="!results.length" class="search-empty">
        {{ keyword ? '没找到匹配的对话' : '输入关键词找对话(只搜已加载的那些)' }}
      </p>
    </div>

    <p class="search-note">
      只搜索当前已加载的 {{ chats.length }} 条对话;更早的可以先在左边栏点「加载更多」。
    </p>
  </a-modal>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useSessionStore } from '@/stores/sessions.js'
import { decodeSummary } from '@/utils/summary.js'

const props = defineProps({
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

const router = useRouter()
const sessionStore = useSessionStore()
const { chats } = storeToRefs(sessionStore)

/** 搜索词 */
const keyword = ref('')

// 每次打开都清空上一次的搜索词 —— 不然「上次搜的词」会一直在框里
watch(
  () => props.open,
  (v) => {
    if (v) keyword.value = ''
  }
)

/** 标题里含关键词的会话 */
const results = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return chats.value
    .map((c) => ({
      uuid: c.uuid,
      title: decodeSummary(c.summary) || '（无标题对话）',
      time: (c.updateTime || '').slice(5, 16),
    }))
    .filter((c) => !kw || c.title.toLowerCase().includes(kw))
})

/** 点某个结果 → 跳到那个会话 */
const pick = (uuid) => {
  emit('close')
  router.push({ name: 'chat', params: { uuid } })
}
</script>

<style scoped>
.search-list {
  margin-top: 12px;
  max-height: 320px;
  overflow-y: auto;
}

.search-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  text-align: left;
  transition: background-color 0.15s ease;
}

.search-item:hover {
  background: #f5f7fa;
}

.search-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: #262626;
}

.search-time {
  flex-shrink: 0;
  font-size: 11px;
  color: #9ca3af;
}

.search-empty {
  padding: 16px 10px;
  text-align: center;
  font-size: 13px;
  color: #9ca3af;
}

.search-note {
  margin-top: 10px;
  font-size: 11px;
  color: #9ca3af;
}
</style>
