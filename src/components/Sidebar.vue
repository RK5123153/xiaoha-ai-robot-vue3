<template>
  <!--
    左边栏。

    ⚠️ 它在两种形态下是**两个东西**,别混了:
      · 桌面端(md 以上):在文档流里占位,「收缩」是把宽度收到 0,
        主内容区跟着往左挪 —— 桌面空间紧张,收起能给正文让出 256px。
      · 移动端:是**抽屉**,平时整个滑出屏幕外,点汉堡按钮才滑进来。

    所以状态是分开的两份:collapsed(桌面收缩)/ drawerOpen(移动抽屉)。
    教程里那份单一 sidebarOpen 在这儿会出事 ——
    移动端选完一个会话要把抽屉关上,要是它同时控制桌面收缩,
    那用户点个会话,桌面的侧边栏也跟着塌了。
  -->
  <aside
    class="fixed md:static inset-y-0 left-0 z-40 shrink-0 overflow-hidden
           w-64 transition-all duration-300 ease-in-out"
    :class="[
      // 移动端:抽屉开合
      drawerOpen ? 'translate-x-0' : '-translate-x-full',
      // 桌面端:永远在原位(靠宽度收缩,不用平移)
      'md:translate-x-0',
      // ⚠️ md 下的宽度只能挂**一个**:
      //    两个都挂(比如基础类里写 md:w-64、条件类写 md:w-0)的话,
      //    谁的优先级高由 Tailwind 生成 CSS 的顺序决定,不由 class 书写顺序决定 ——
      //    结果就是「折叠没生效」。所以 md:w-* 只在这一处出现。
      collapsed ? 'md:w-0' : 'md:w-64',
    ]"
  >
    <!--
      内层固定 w-64:
      外层宽度动画到 0 时,里面的内容会被压扁(文字挤成一团、按钮变形)。
      内层定宽 + 外层 overflow-hidden,才是「滑进去」的效果。
    -->
    <div class="w-64 h-full flex flex-col bg-[#f9fbff] border-r border-gray-200">
      <!-- 顶部:logo + 关闭(仅移动端) -->
      <div class="h-12 shrink-0 flex items-center gap-2 px-4">
        <SvgIcon name="deepseek-logo" customCss="w-6 h-6" />
        <span class="font-semibold text-[15px]">小哈 AI</span>
        <button
          type="button"
          class="ml-auto md:hidden p-1.5 rounded-md text-gray-400 hover:bg-gray-200 hover:text-gray-700"
          aria-label="关闭侧边栏"
          @click="$emit('close')"
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
    </div>
  </aside>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SvgIcon from '@/components/SvgIcon.vue'
import ChatListItem from '@/components/ChatListItem.vue'
import {
  chatState,
  modelState,
  groupedChats,
  loadChats,
  removeChat,
  renameChat,
  selectModel,
} from '@/utils/chat-store.js'

const props = defineProps({
  /** 桌面端是不是收起来了 */
  collapsed: { type: Boolean, default: false },
  /** 移动端抽屉是不是拉出来了 */
  drawerOpen: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

const route = useRoute()
const router = useRouter()

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
  emit('close')
  router.push('/')
}

/** 打开某个会话 */
const openChat = (uuid) => {
  emit('close')
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
</script>

<style scoped>
/* 侧边栏滚动条:颜色淡一点,不抢会话标题的视线 */
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
