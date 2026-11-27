<template>
  <!-- h-dvh:动态视口高度(移动端浏览器地址栏收起/弹出时不会多出一截空白)
       overflow-hidden:页面本身不滚动,滚动交给聊天区 -->
  <div class="h-dvh flex overflow-hidden bg-white text-gray-800">
    <!-- 移动端:侧边栏拉出来时盖一层半透明遮罩,点一下就收起 -->
    <div
      v-if="drawerOpen"
      class="fixed inset-0 z-30 bg-black/30 md:hidden"
      @click="drawerOpen = false"
    ></div>

    <!-- 左边栏(收起时整个消失,它顶上的 logo 和图标挪到主内容区的顶栏里) -->
    <Sidebar
      :collapsed="collapsed"
      :drawer-open="drawerOpen"
      @close="drawerOpen = false"
      @toggle="toggleCollapsed"
      @search="openSearch"
    />

    <!-- ─────────────── 主内容区 ─────────────── -->
    <main class="flex-1 min-w-0 flex flex-col">
      <!--
        顶栏。

        ⚠️ 为什么顶栏在 Layout 而不在聊天页:
           侧边栏收起时,logo 和几个图标要**挪到顶栏里**(参考 DeepSeek)——
           顶栏是所有页面共用的,放这儿才接得住。聊天页的标题/分享也一并搬上来了。

        收起时(桌面端):[logo][展开][搜索][新对话] [标题] …… [分享]
        展开时:                          [标题] …… [分享]
        移动端:  [汉堡][标题] …… [分享]
      -->
      <header class="app-header shrink-0 flex items-center gap-1.5 h-12 px-3">
        <!-- 移动端:汉堡按钮(那边侧边栏是抽屉) -->
        <button
          type="button"
          class="md:hidden p-1.5 -ml-1 rounded-md text-gray-500 hover:bg-gray-100"
          aria-label="打开侧边栏"
          @click="drawerOpen = true"
        >
          <MenuOutlined class="text-xl" />
        </button>

        <!--
          收起时(桌面端)才出现的这一组:
          logo + 展开 + 搜索 + 新对话 —— 它们本来在侧边栏顶上,收起后挪到这儿。
        -->
        <template v-if="collapsed">
          <button
            type="button"
            class="hidden md:inline-flex p-1 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="回到首页"
            @click="goHome"
          >
            <BrandLogo class="w-6 h-6" />
          </button>
          <a-tooltip title="展开侧边栏" placement="bottom">
            <button
              type="button"
              class="hidden md:inline-flex p-1.5 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
              aria-label="展开侧边栏"
              @click="toggleCollapsed"
            >
              <MenuUnfoldOutlined class="text-lg" />
            </button>
          </a-tooltip>
          <a-tooltip title="搜索对话" placement="bottom">
            <button
              type="button"
              class="hidden md:inline-flex p-1.5 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
              aria-label="搜索对话"
              @click="openSearch"
            >
              <SearchOutlined class="text-lg" />
            </button>
          </a-tooltip>
          <a-tooltip title="开启新对话" placement="bottom">
            <button
              type="button"
              class="hidden md:inline-flex p-1.5 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
              aria-label="开启新对话"
              @click="goHome"
            >
              <PlusOutlined class="text-lg" />
            </button>
          </a-tooltip>
        </template>

        <!-- 会话标题(首页没有会话,就不显示) -->
        <h1 v-if="chatTitle" class="ml-2 truncate text-[15px] font-medium text-gray-800">
          {{ chatTitle }}
        </h1>

        <!-- 分享:复制当前会话的链接 -->
        <a-tooltip v-if="chatId" title="复制会话链接" placement="bottomRight">
          <button
            type="button"
            class="ml-auto shrink-0 p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            aria-label="复制会话链接"
            @click="shareChat"
          >
            <ShareAltOutlined class="text-lg" />
          </button>
        </a-tooltip>
      </header>

      <!-- 真正的页面(首页 / 聊天页) -->
      <RouterView />
    </main>

    <!-- 搜索对话的弹层 -->
    <ConversationSearch :open="searchOpen" @close="searchOpen = false" />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
// 这里起别名:页面里已经有叫 message 的变量(输入框的草稿)
import { message as antMessage } from 'ant-design-vue'
import Sidebar from '@/components/Sidebar.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import ConversationSearch from '@/components/ConversationSearch.vue'
import { useSessionStore } from '@/stores/sessions.js'
import { useModelStore } from '@/stores/model.js'
import { useToolStore } from '@/stores/tools.js'
import { safeGetItem, safeSetItem } from '@/utils/storage.js'
import { copyText } from '@/utils/clipboard.js'

const route = useRoute()
const router = useRouter()

/** 三个 store:会话列表 / 模型选择 / 工具开关(全局共享,首页和聊天页是同一份) */
const sessionStore = useSessionStore()
const modelStore = useModelStore()
const toolStore = useToolStore()

/** 搜索对话的弹层开着没 */
const searchOpen = ref(false)

const openSearch = () => {
  searchOpen.value = true
}

/** 当前打开的会话(uuid)—— 首页没有 */
const chatId = computed(() => route.params?.uuid || '')

/** 顶栏上的会话标题 */
const chatTitle = computed(() => sessionStore.titleOf(chatId.value) || '')

/** 回首页(新对话) */
const goHome = () => {
  router.push({ name: 'home' })
}

/** 分享:把当前会话的链接复制到剪贴板 */
const shareChat = async () => {
  const ok = await copyText(location.href)
  if (ok) antMessage.success('链接已复制')
  else antMessage.info('复制失败，请手动复制地址栏')
}

/**
 * 桌面端:侧边栏是不是收起来了
 *
 * <p>收起来 = 宽度收到 0,主内容区往左挪,把 256px 让给正文。
 * 和移动端的抽屉是**两件事**,所以是两个变量(见下面的 drawerOpen)。
 */
const collapsed = ref(false)

/**
 * 移动端:抽屉是不是拉出来了
 *
 * <p>只在移动端有意义 —— 桌面端侧边栏常驻,没有「拉出来」这回事。
 */
const drawerOpen = ref(false)

/** 折叠状态存在 localStorage 里 —— 刷新后还保持用户的选择 */
const COLLAPSED_STORAGE_KEY = 'xiaoha-ai-robot.sidebar-collapsed'

/**
 * 切换桌面端侧边栏的收缩/展开
 *
 * <p>用 utils/storage.js 那套(读不到/写不进去都不抛)——
 *    隐私模式下 localStorage 可能整个不可用,直接 localStorage.setItem 会把
 *    「点一下折叠按钮」变成「页面报错」。
 */
const toggleCollapsed = () => {
  collapsed.value = !collapsed.value
  safeSetItem(COLLAPSED_STORAGE_KEY, collapsed.value ? '1' : '0')
}

onMounted(() => {
  // 读回上次的选择(读不到就当没折叠过)
  collapsed.value = safeGetItem(COLLAPSED_STORAGE_KEY) === '1'
  sessionStore.loadChats({ reset: true })
  modelStore.loadModels()
  // 工具清单整个应用只拉这一次 —— 首页和聊天页共用一份勾选状态。
  // ⚠️ 别在页面里再拉一遍:会用存着的旧值覆盖用户刚做的勾选。
  toolStore.loadTools()
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
  () => sessionStore.loadChats({ reset: true })
)
</script>
