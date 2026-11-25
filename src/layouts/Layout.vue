<template>
  <!-- h-dvh:动态视口高度(移动端地址栏收起/弹出时不会多出一截空白)
       overflow-hidden:页面本身不滚动,滚动交给聊天区 -->
  <div class="h-dvh flex overflow-hidden bg-white text-gray-800">
    <!-- 移动端:侧边栏拉出来时盖一层半透明遮罩,点一下就收起 -->
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-30 bg-black/30 md:hidden"
      @click="sidebarOpen = false"
    ></div>

    <!-- ─────────────── 左边栏 ─────────────── -->
    <aside
      class="fixed md:static inset-y-0 left-0 z-40 w-64 shrink-0 flex flex-col
             bg-gray-50 border-r border-gray-200
             transition-transform duration-200 ease-out
             md:translate-x-0"
      :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
    >
      <!-- 顶部:logo + 关闭(仅移动端) -->
      <div class="h-12 shrink-0 flex items-center gap-2 px-4">
        <SvgIcon name="deepseek-logo" customCss="w-6 h-6" />
        <span class="font-semibold text-[15px]">小哈 AI</span>
        <button
          type="button"
          class="ml-auto md:hidden p-1.5 rounded-md text-gray-400 hover:bg-gray-200 hover:text-gray-700"
          aria-label="关闭侧边栏"
          @click="sidebarOpen = false"
        >
          <SvgIcon name="close" customCss="w-4 h-4" />
        </button>
      </div>

      <!-- 新对话 -->
      <div class="px-3 pb-3 shrink-0">
        <button
          type="button"
          class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm
                 bg-white border border-gray-200 text-gray-700
                 hover:border-[#4d6bfe] hover:text-[#4d6bfe] transition-colors"
          @click="goHome"
        >
          <SvgIcon name="plus" customCss="w-4 h-4" />
          新对话
        </button>
      </div>

      <!-- 会话列表 -->
      <div class="flex-1 min-h-0 overflow-y-auto px-3 pb-3 chat-scroll">
        <!-- 列表加载中 -->
        <p v-if="chatState.loading && !chatState.chats.length" class="px-3 py-2 text-xs text-gray-400">
          正在加载对话…
        </p>

        <!-- 一个会话都没有 -->
        <p v-else-if="!chatState.chats.length" class="px-3 py-2 text-xs text-gray-400 leading-5">
          还没有对话。在右边问一句,就会自动出现在这里。
        </p>

        <!-- 按时间分组 -->
        <div v-for="group in groupedChats" :key="group.label" class="mb-4">
          <p class="px-3 pb-1.5 text-[11px] font-medium text-gray-400">{{ group.label }}</p>
          <div class="space-y-0.5">
            <ChatListItem
              v-for="item in group.items"
              :key="item.uuid"
              :chat="item"
              :active="item.uuid === activeUuid"
              @select="openChat"
              @rename="doRename"
              @delete="doDelete"
            />
          </div>
        </div>

        <!-- 还有更早的会话 -->
        <button
          v-if="chatState.hasMore"
          type="button"
          class="w-full py-2 text-xs text-gray-400 hover:text-[#4d6bfe] transition-colors disabled:opacity-50"
          :disabled="chatState.loading"
          @click="loadMore"
        >
          {{ chatState.loading ? '加载中…' : '加载更多' }}
        </button>
      </div>

      <!-- 底部:模型选择 + 联网搜索 -->
      <div class="shrink-0 border-t border-gray-200 p-3 space-y-2">
        <select
          v-model="modelCode"
          class="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-sm
                 text-gray-700 outline-none focus:border-[#4d6bfe]"
          title="选择对话模型"
        >
          <option value="">默认模型（后端配置）</option>
          <option v-for="m in modelState.models" :key="m.code" :value="m.code">
            {{ m.name }}
          </option>
        </select>

        <label class="flex items-center gap-2 px-1 text-xs text-gray-500 cursor-pointer select-none">
          <input
            v-model="modelState.webSearch"
            type="checkbox"
            class="w-3.5 h-3.5 accent-[#4d6bfe] cursor-pointer"
          />
          联网搜索
          <span class="text-gray-400 truncate">({{ currentModelDesc }})</span>
        </label>
      </div>
    </aside>

    <!-- ─────────────── 主内容区 ─────────────── -->
    <main class="flex-1 min-w-0 flex flex-col">
      <!-- 移动端顶栏(桌面端隐藏,那边侧边栏一直开着) -->
      <div class="md:hidden h-12 shrink-0 flex items-center gap-2 px-3 border-b border-gray-100">
        <button
          type="button"
          class="p-1.5 -ml-1.5 rounded-md text-gray-500 hover:bg-gray-100"
          aria-label="打开侧边栏"
          @click="sidebarOpen = true"
        >
          <SvgIcon name="menu" customCss="w-5 h-5" />
        </button>
        <span class="text-sm font-medium text-gray-700">小哈 AI</span>
      </div>

      <!-- 真正的页面(首页 / 聊天页) -->
      <RouterView />
    </main>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SvgIcon from '@/components/SvgIcon.vue'
import ChatListItem from '@/components/ChatListItem.vue'
import {
  chatState,
  modelState,
  groupedChats,
  loadChats,
  loadModels,
  removeChat,
  renameChat,
  selectModel,
} from '@/utils/chat-store.js'

const route = useRoute()
const router = useRouter()

/** 移动端:侧边栏是不是拉出来了 */
const sidebarOpen = ref(false)

/** 当前打开的会话 uuid(用来高亮侧边栏里的那一条) */
const activeUuid = computed(() => route.params?.uuid || '')

/**
 * 模型选择框的值
 *
 * <p>用 computed + setter,而不是直接 v-model 绑定 store 里的字段 ——
 *    换了模型要把「支不支持联网搜索」一起对齐(有的模型不支持联网),
 *    这件事得走 {@link selectModel}。
 */
const modelCode = computed({
  get: () => modelState.code,
  set: (code) => selectModel(code),
})

/** 当前模型的说明(给「联网搜索」那一行当提示) */
const currentModelDesc = computed(() => {
  const model = modelState.models.find((m) => m.code === modelState.code)
  return model?.description || '由后端决定'
})

/** 回首页(新对话) */
const goHome = () => {
  sidebarOpen.value = false
  router.push('/')
}

/** 打开某个会话 */
const openChat = (uuid) => {
  sidebarOpen.value = false
  if (uuid === activeUuid.value) return
  router.push(`/chat/${uuid}`)
}

/** 加载更早的会话 */
const loadMore = () => {
  if (chatState.loading || !chatState.hasMore) return
  loadChats()
}

/**
 * 改名
 *
 * <p>失败(比如标题超长、后端报错)时把列表重新拉一遍 ——
 *    后端没改成的话,列表里还留着旧标题,重新拉一次能对上真实状态。
 */
const doRename = async (id, summary) => {
  try {
    await renameChat(id, summary)
  } catch (e) {
    console.error('改名失败: ', e)
    loadChats({ reset: true })
  }
}

/**
 * 删掉一个会话
 *
 * <p>删的就是当前打开的那个 → 回首页,不然主内容区会停在一个已经不存在的会话上。
 */
const doDelete = async (uuid) => {
  try {
    const ok = await removeChat(uuid)
    if (!ok) return
    if (uuid === activeUuid.value) {
      router.push('/')
    }
  } catch (e) {
    console.error('删除失败: ', e)
  }
}

onMounted(() => {
  loadChats({ reset: true })
  loadModels()
})

/**
 * 换页面就刷新会话列表
 *
 * <p>为什么:会话是**发消息之后**才出现在后端列表里的。
 * 从首页发完第一条消息跳到聊天页,侧边栏要能立刻看到这条新会话。
 *
 * <p>监听的是「当前在哪个会话」,没有的场合(首页)退回用路径 ——
 * 于是「首页 ↔ 聊天页」「换一个会话」都会触发,
 * 而页面内部的其它状态变化(比如发消息)不会触发
 * (用户刚点开「加载更多」,列表一重置就又回到第一页了)。
 */
watch(
  () => route.params?.uuid || route.path,
  () => loadChats({ reset: true })
)
</script>

<style scoped>
/* 聊天区滚动条:颜色淡一点,不抢正文视线 */
.chat-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.16) transparent;
}

.chat-scroll::-webkit-scrollbar {
  width: 6px;
}

.chat-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.chat-scroll::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.16);
  border-radius: 3px;
}

.chat-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.28);
}
</style>
