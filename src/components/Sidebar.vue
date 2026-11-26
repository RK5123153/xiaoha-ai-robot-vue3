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
      <!--
        ⚠️ data-chat-list:脚本里要定位「会话列表这个滚动容器」,
           靠它拿 scrollHeight / clientHeight 判断「还有没有更早的会话」。
      -->
      <div
        ref="listRef"
        data-chat-list
        class="flex-1 min-h-0 overflow-y-auto px-3 pb-3 chat-scroll"
        @scroll="onScroll"
      >
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
          <!--
            分组标题:sticky 定位,往下翻的时候钉在顶上。

            ⚠️ 两处细节,少一个就露馅:
               · **不透明背景**:sticky 的元素是浮在内容上面的,
                 背景透明的话,滑过去的会话标题会从标题**底下透出来**;
               · **-mx-3 px-3**:列表容器左右各有 12px 内边距,
                 不抵消掉的话,标题只盖住中间那条,缝里照样漏。
          -->
          <p class="sticky top-0 z-10 -mx-3 px-3 pt-1 pb-1.5 text-[11px] font-medium text-gray-400 bg-[#f9fbff]">
            {{ group.label }}
          </p>
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
import { computed, nextTick, ref, watch } from 'vue'
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

/** 会话列表的滚动容器 */
const listRef = ref(null)

/**
 * 离底部多近就加载下一页
 *
 * <p>给 24px 的余量:用户滑到底之前就先加载好了,不用等他滑到头才发现还有更多。
 */
const BOTTOM_THRESHOLD = 24

/**
 * 还能不能继续加载更早的会话
 *
 * @returns {boolean}
 */
const canLoadMore = () => {
  if (loading.value || !hasMore.value) return false
  const el = listRef.value
  if (!el) return false
  // ⚠️ 容器还没被内容撑开 → 根本没有滚动条 → **scroll 事件永远不会来**。
  //    这种情况下光等着用户滚是等不到的(教程里就漏了这一条):
  //    第一页只有三五条、侧边栏又高,用户压根不知道自己下面还有内容。
  //    所以这种情况要**自己**接着拉,拉到撑开为止。
  if (el.scrollHeight <= el.clientHeight) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD
}

/**
 * 加载更早的会话(往下一页)
 *
 * <p>⚠️ 这不是「加载更多」按钮独占的路径 —— 滚到底也会调它。
 *
 * @returns {Promise<void>}
 */
const loadMore = async () => {
  if (loading.value || !hasMore.value) return
  const before = chats.value.length
  const ok = await sessionStore.loadChats()
  if (!ok) return
  // ⚠️ 一条都没多 → 别再接着拉了(后端返回空页但还报 hasMore 的极端情况,
  //    不挡住的话这里就是个死循环,一直打后端)
  if (chats.value.length === before) return
  await nextTick()
}

/**
 * 滚到底部附近 → 加载下一页
 */
const onScroll = () => {
  if (canLoadMore()) loadMore()
}

/**
 * 记住「用户正看着的那条会话」
 *
 * <p>⚠️ 为什么需要:列表刷新时,新会话会插到**最前面**(后端按更新时间倒序),
 *    上面凭空多出一截,用户正看着的那条就被顶下去了 —— 看着像「页面自己跳了」。
 *    所以刷新前记下它(量的是**旧**的位置),刷新后把它挪回原位。
 *
 * @returns {{uuid: string, offset: number}|null}
 */
const captureAnchor = () => {
  const el = listRef.value
  if (!el) return null
  const top = el.getBoundingClientRect().top
  for (const node of el.querySelectorAll('[data-uuid]')) {
    const rect = node.getBoundingClientRect()
    // 第一个「露出一点」的 —— 完全在视口上方的跳过
    if (rect.bottom > top + 1) {
      return { uuid: node.getAttribute('data-uuid'), offset: rect.top - top }
    }
  }
  return null
}

/**
 * 把锚定的那条会话挪回原位
 *
 * @param {{uuid: string, offset: number}|null} anchor
 */
const restoreAnchor = (anchor) => {
  const el = listRef.value
  if (!el || !anchor) return
  const node = el.querySelector(`[data-uuid="${CSS.escape(anchor.uuid)}"]`)
  // 那条会话没了(被删了)→ 就别挪了
  if (!node) return
  const top = el.getBoundingClientRect().top
  const offset = node.getBoundingClientRect().top - top
  el.scrollTop += offset - anchor.offset
}

/**
 * 列表变了 → 位置别乱,而且把没露出来的接着拉
 *
 * <p>⚠️ flush:'pre' —— 回调在 DOM 更新**之前**跑,
 *    这时候量到的还是**旧**位置(captureAnchor 要的就是旧的);
 *    await nextTick() 之后 DOM 才是新的,这时才能量新位置、把它挪回去。
 */
watch(
  [chats, hasMore],
  async () => {
    const anchor = captureAnchor()
    await nextTick()
    restoreAnchor(anchor)
    // 内容还没把容器撑开 → 用户滚不动 → 看不见「下面还有」→ 接着拉
    if (canLoadMore()) loadMore()
  },
  { flush: 'pre' }
)

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
