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

    <!-- 左边栏 -->
    <Sidebar :collapsed="collapsed" :drawer-open="drawerOpen" @close="drawerOpen = false" />

    <!--
      侧边栏「收缩 / 展开」按钮(仅桌面端)
      ⚠️ 移动端不显示:那边侧边栏本来就是抽屉,由顶栏的汉堡按钮管,
         再挂一个浮动按钮会挡住内容、还多出一个同功能的入口。
    -->
    <!--
      悬停提示用 antd 的 <a-tooltip>,不用原生 title:
      原生 title 要悬停 1 秒才弹,样式还是浏览器自带的灰方块。
      ⚠️ 别再给这个按钮加原生 title —— title 和 a-tooltip 会**弹两次**。
      统一到 antd 而不是各写各的 CSS:以后再引入 Dropdown / Modal,
      弹层避让、延迟、读屏这些细节都是现成的,不必每处自己写一遍。
    -->
    <a-tooltip placement="bottom">
      <template #title>
        <span>{{ collapsed ? '展开侧边栏' : '收起侧边栏' }}</span>
      </template>
      <button
        type="button"
        class="hidden md:flex items-center justify-center fixed top-4 z-30
               bg-white border border-gray-200 p-2
               transition-[left] duration-300 ease-in-out"
        :class="collapsed ? 'left-0 rounded-lg' : 'left-64 rounded-r-lg'"
        :aria-label="collapsed ? '展开侧边栏' : '收起侧边栏'"
        :aria-expanded="!collapsed"
        @click="toggleCollapsed"
      >
        <!-- 收起 / 展开:antd 里对应 MenuFold / MenuUnfold -->
        <MenuFoldOutlined v-if="collapsed" class="text-xl text-gray-400" />
        <MenuUnfoldOutlined v-else class="text-xl text-gray-400" />
        <!--
          ⚠️ 两个图标的 viewBox 里留白不一样:
          sidebar-close 的图形在 1024 的画布里缩了一圈,同样 w-6 h-6 渲染出来
          看着比 sidebar-open 小一圈(实测 21.5px vs 24px)。
          所以收起时给大一号(w-7),两个状态看着才一样大。
        -->
      </button>
    </a-tooltip>

    <!-- ─────────────── 主内容区 ─────────────── -->
    <main class="flex-1 min-w-0 flex flex-col">
      <!-- 移动端顶栏(桌面端隐藏,那边侧边栏常驻) -->
      <div class="md:hidden h-12 shrink-0 flex items-center gap-2 px-3 border-b border-gray-100">
        <button
          type="button"
          class="p-1.5 -ml-1.5 rounded-md text-gray-500 hover:bg-gray-100"
          aria-label="打开侧边栏"
          @click="drawerOpen = true"
        >
          <MenuOutlined class="text-xl" />
        </button>
        <span class="text-sm font-medium text-gray-700">小哈 AI</span>
      </div>

      <!-- 真正的页面(首页 / 聊天页) -->
      <RouterView />
    </main>
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import Sidebar from '@/components/Sidebar.vue'
import { chatState, loadChats, loadModels } from '@/utils/chat-store.js'

const route = useRoute()

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

/** 切换桌面端侧边栏的收缩/展开 */
const toggleCollapsed = () => {
  collapsed.value = !collapsed.value
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed.value ? '1' : '0')
  } catch {
    // 隐私模式下 localStorage 可能不可写 → 忽略,只是这次不记住而已
  }
}

onMounted(() => {
  // 读回上次的选择
  try {
    collapsed.value = localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1'
  } catch {
    collapsed.value = false
  }
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
