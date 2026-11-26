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

      ⚠️ 收起时再加个 invisible:
         宽度收到 0 之后内容还在 DOM 里,键盘 Tab 还是能 tab 到那些看不见的按钮上 ——
         看不见但能聚焦,是比「看不见」更糟的一种状态。
         (visibility:hidden 不影响布局,宽度动画照常。)
    -->
    <div
      class="w-64 h-full flex flex-col bg-[#f9fbff] border-r border-gray-200"
      :class="collapsed ? 'md:invisible' : 'md:visible'"
    >
      <!-- 顶部:logo + 应用名(左) + 搜索 / 折叠(右) -->
      <div class="h-14 shrink-0 flex items-center gap-2 px-3">
        <!--
          logo + 应用名 = 回首页的入口。
          ⚠️ 做成 <button> 而不是给 <div> 加 @click:
             div 不可聚焦 —— 键盘 Tab 不到,读屏软件也不会把它念成可点的按钮。
        -->
        <a-tooltip placement="bottom" title="回到首页">
          <button
            type="button"
            class="flex items-center gap-2 px-1.5 py-1 rounded-lg
                   cursor-pointer transition-colors hover:bg-gray-100"
            @click="goHome"
          >
            <BrandLogo class="w-7 h-7" />
            <span class="font-semibold text-[15px] tracking-wide text-gray-800">小哈 AI</span>
          </button>
        </a-tooltip>

        <!-- 搜索对话 -->
        <a-tooltip placement="bottom" title="搜索对话">
          <button
            type="button"
            class="hidden md:inline-flex ml-auto p-1.5 rounded-md text-gray-400
                   hover:bg-gray-200/70 hover:text-gray-700 transition-colors"
            aria-label="搜索对话"
            @click="$emit('search')"
          >
            <SearchOutlined class="text-lg" />
          </button>
        </a-tooltip>

        <!-- 折叠(仅桌面端;移动端是抽屉,由顶栏的汉堡按钮管) -->
        <button
          type="button"
          class="hidden md:inline-flex p-1.5 rounded-md text-gray-400
                 hover:bg-gray-200/70 hover:text-gray-700 transition-colors"
          aria-label="收起侧边栏"
          @click="$emit('toggle')"
        >
          <MenuFoldOutlined class="text-lg" />
        </button>

        <!-- 关闭按钮(仅移动端) -->
        <button
          type="button"
          class="md:hidden ml-auto p-1.5 rounded-md text-gray-400 hover:bg-gray-200 hover:text-gray-700"
          aria-label="关闭侧边栏"
          @click="$emit('close')"
        >
          <CloseOutlined class="text-base" />
        </button>
      </div>

      <!-- 新对话 -->
      <div class="px-3 pb-3 shrink-0">
        <button
          type="button"
          class="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm
                 border border-gray-200 bg-white text-gray-700
                 hover:border-gray-300 hover:bg-gray-50 transition-colors cursor-pointer"
          @click="goHome"
        >
          <PlusOutlined class="text-base" />
          开启新对话
        </button>
      </div>

      <!-- 会话列表 -->
      <div class="flex-1 min-h-0 overflow-y-auto px-3 pb-3 chat-scroll">
        <!-- 列表加载中 -->
        <p v-if="loading && !chats.length" class="px-3 py-2 text-xs text-gray-400">
          正在加载对话…
        </p>

        <!-- 一个会话都没有 -->
        <p v-else-if="!chats.length" class="px-3 py-2 text-xs text-gray-400 leading-5">
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
          v-if="hasMore"
          type="button"
          class="w-full py-2 text-xs text-gray-400 hover:text-[#4d6bfe] transition-colors disabled:opacity-50"
          :disabled="loading"
          @click="loadMore"
        >
          {{ loading ? '加载中…' : '加载更多' }}
        </button>
      </div>

      <!--
        底部原来放着「模型选择 + 联网搜索」,现在挪到**输入框左下角**了
        (见 components/ModelPicker.vue / WebSearchToggle.vue)。

        <p>为什么挪:
          <ul>
            <li>侧边栏在移动端是抽屉 —— 那两个开关根本点不到。</li>
            <li>改模型/开联网搜索是「打字时顺手做的事」,输入框才是那会儿你盯着的地方。</li>
            <li>同一个设置散在两个地方,迟早会有人只改一处。</li>
          </ul>
      -->
    </div>
  </aside>
</template>

<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import ChatListItem from '@/components/ChatListItem.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import { useSessionStore } from '@/stores/sessions.js'

/** 会话列表放在 store 里 —— 侧边栏和聊天页都要知道「有哪些会话」 */
const sessionStore = useSessionStore()
const { chats, loading, hasMore, groupedChats } = storeToRefs(sessionStore)

const props = defineProps({
  /** 桌面端是不是收起来了 */
  collapsed: { type: Boolean, default: false },
  /** 移动端抽屉是不是拉出来了 */
  drawerOpen: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'toggle', 'search'])

const route = useRoute()
const router = useRouter()

/** 当前打开的会话 uuid(用来高亮侧边栏里的那一条) */
const activeUuid = computed(() => route.params?.uuid || '')

/** 回首页(新对话) */
const goHome = () => {
  emit('close')
  // ⚠️ 用命名路由,别写死路径 —— 路径改了这里不会跟着改
  router.push({ name: 'home' })
}

/** 打开某个会话 */
const openChat = (uuid) => {
  emit('close')
  if (uuid === activeUuid.value) return
  router.push({ name: 'chat', params: { uuid } })
}

/** 加载更早的会话 */
const loadMore = () => {
  if (loading.value || !hasMore.value) return
  sessionStore.loadChats()
}

/**
 * 改名
 *
 * <p>失败(比如标题超长、后端报错)时把列表重新拉一遍 ——
 *    后端没改成的话,列表里还留着旧标题,重新拉一次能对上真实状态。
 */
const doRename = async (id, summary) => {
  try {
    await sessionStore.renameChat(id, summary)
  } catch (e) {
    console.error('改名失败: ', e)
    sessionStore.loadChats({ reset: true })
  }
}

/**
 * 删掉一个会话
 *
 * <p>删的就是当前打开的那个 → 回首页,不然主内容区会停在一个已经不存在的会话上。
 */
const doDelete = async (uuid) => {
  try {
    const ok = await sessionStore.removeChat(uuid)
    if (!ok) return
    if (uuid === activeUuid.value) {
      router.push({ name: 'home' })
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
