<template>
  <!-- h-dvh 动态视口高度：移动端浏览器地址栏收起/弹出时，输入框不会掉出屏幕
       overflow-hidden：页面本身不滚动，滚动交给下面的聊天区 -->
  <div class="h-full flex flex-col overflow-hidden">
    <!--
      ⚠️ 这里原来有一行顶栏(会话标题 + 分享)—— 现在搬到 Layout.vue 了:
         侧边栏收起时,logo 和几个图标要挪到那一行里(参考 DeepSeek),
         顶栏是所有页面共用的,放聊天页里接不住。

      ⚠️ 这里原来还有「文字对话 / 看图说话」的模式切换 ——
         现在**没有模式**了:一个输入框,带没带图决定走哪条链路(见 sendMessage)。
         模式切换的代价是:看图那条路是无状态的,用户得先想清楚「我现在要干嘛」;
         而实际使用里「顺手发张图问问」是常态 —— 让用户先切模式是白加的一步。
    -->

    <!-- 聊天记录区域：自己滚动，输入框始终钉在底部 -->
    <!--
      ⚠️ data-chat-scroll:侧边栏的会话列表也用了 .chat-scroll 这个类(样式是共用的),
         脚本里要定位「聊天区」得能一眼选中它 —— 别拿 .chat-scroll 选,会选到侧边栏去。
    -->
    <div
      class="chat-scroll flex-1 min-h-0 overflow-y-auto pt-4 px-4 pb-2"
      data-chat-scroll
      ref="chatScrollRef"
      @scroll="handleScroll"
    >
      <!-- 历史加载中 -->
      <div v-if="loadingHistory" class="flex justify-center py-8 text-gray-400">
        <LoadingDots size="md" label="正在加载历史消息" />
      </div>

      <!-- 内容限宽:宽屏上不让气泡拉成一整行(一行字太长不好读) -->
      <div ref="chatContentRef" class="mx-auto w-full max-w-3xl">
      <!--
        往上翻页的提示:
        · 正在加载 → 一行小字,别让用户以为「滑到顶就没了」;
        · 已经到头 → 明说「以上是全部对话」,不然用户会一直往上滑。
      -->
      <div v-if="loadingOlder" class="flex justify-center py-3 text-xs text-gray-400">
        正在加载更早的消息…
      </div>
      <div
        v-else-if="!historyHasMore && historyMessageCount > 0"
        class="flex justify-center py-3 text-xs text-gray-300"
      >
        — 以上是全部对话 —
      </div>
      <!-- 遍历聊天记录 -->
      <template v-for="chat in chatList" :key="chat.id">
        <!-- 用户提问消息（靠右） -->
        <div v-if="chat.role === 'user'" class="flex justify-end mb-4">
          <div class="quesiton-container">
            <!-- 看图说话：图在文字上面，点一下能放大 -->
            <img
              v-if="chat.image"
              :src="chat.image.previewUrl"
              :alt="chat.image.name || '提问的图片'"
              class="vision-thumb"
              @click="openPreview(chat.image)"
            />
            <p class="whitespace-pre-wrap break-words">{{ chat.content }}</p>
            <!--
              看图问答的说明 —— 这条走的是无状态的多模态接口:
              不带聊天记忆,回答也不写进会话历史(刷新就没了)。
              不标出来的话,用户会以为它和其它消息一样「存下了」。
            -->
            <p v-if="chat.kind === 'vision'" class="text-[11px] text-gray-400 mt-1">
              看图问答 · 不写入会话历史
            </p>
          </div>
        </div>

        <!-- 大模型回复消息（靠左） -->
        <div v-else class="flex items-start mb-4">
          <!--
            头像:小一点、去掉那圈描边。
            参考图里助手的消息是不带气泡的,标识越轻越好 —— 一圈描边反而抢眼。
          -->
          <div class="flex-shrink-0 mr-2.5 pt-0.5">
            <BrandLogo class="w-6 h-6" />
          </div>
          <!-- 回复的内容（Markdown 渲染） -->
          <div class="w-full max-w-[80%] mb-2">
            <!--
              等待模型回答时的进度显示。

              ⚠️ 为什么要把思考链显示出来:
                 后端等模型开口的这段时间可能很长(要先调工具:天气/联网搜索,
                 实测 MCP 工具挂住能到一两分钟),这期间 SSE **一个字节都不发** ——
                 光一个「正在思考…」,用户只会以为页面卡死了。
                 而后端**一直在流思考链**(event: thinking),里面写着它在干什么。
                 把它显示出来,这段等待就有了内容。

              ⚠️ 思考链**不混进正文**:它是模型的内部推理(还可能是英文的),
                 单独一块、灰字、小字;正文那块保持干净。
            -->
            <ThinkingPanel v-if="chat.pending && chat.thinking" :text="chat.thinking" />
            <!-- 没有思考链的模型(不给 reasoning)→ 至少给个转圈 -->
            <div
              v-else-if="chat.pending"
              class="flex items-center gap-2 text-sm text-gray-400 mb-1"
            >
              <LoadingDots size="sm" label="正在思考" />
              <span aria-hidden="true">正在思考…</span>
            </div>
            <!-- 后端存下来的「被打断」的回答：正文是残缺的,标一下免得以为模型就答这么多 -->
            <p
              v-if="chat.interrupted && !chat.pending && !chat.content"
              class="text-sm text-gray-400"
            >这次回答没有完成（生成被中断了）。</p>
            <StreamMarkdownRender :content="chat.content" />
            <!-- 用户主动点了「停止」:正文是半截的,标一下免得以为模型就答这么多 -->
            <p
              v-if="chat.stopped && !chat.pending"
              class="text-sm text-gray-400 mt-1"
            >已停止生成。</p>
            <!-- 这一轮出错了：正文很可能只说了一半（模型先讲了两句才被拦/超时），
                 把原因亮出来 —— 不然用户看到的是半截回答，会以为它已经答完了 -->
            <p
              v-if="chat.failed && !chat.pending"
              class="text-sm text-amber-600 mt-1.5 whitespace-pre-wrap"
            >{{ chat.failed }}</p>
            <!-- 消息底部的操作栏：朗读 / 复制 / 重新生成 / 点赞 / 点踩
                 只在流式输出结束后出现（done），打字过程中显示没意义 -->
            <MessageActions
              v-if="chat.done && chat.content"
              :content="chat.content"
              :feedback="feedbackMap[chat.id] || ''"
              :regenerating="isSending"
              :can-regenerate="chat.turn > 0 && chat.id === regenerableIdOf(chat)"
              @regenerate="handleRegenerate(chat.id)"
              @feedback="handleFeedback(chat.id, $event)"
            />
          </div>
        </div>
      </template>
      </div>
    </div>

    <!--
      发送消息输入框 —— 和首页共用同一个组件(ChatInputBox.vue)。
      两个页面只有三处不同:能不能带图、要不要显示工具开关、提示文案。
    -->
    <div class="w-full mb-5 shrink-0 px-4">
      <div class="mx-auto w-full max-w-3xl">
        <ChatInputBox
          ref="inputRef"
          v-model="message"
          :attachment="attachment"
          :busy="preparingImage"
          :send-disabled="sendState.disabled"
          :send-hint="sendState.hint"
          :streaming="isSending"
          :loading="loadingHistory"
          :vision="!!attachment"
          placeholder="给小哈 AI 机器人发送消息（Enter 发送，Shift + Enter 换行）"
          :hint="attachment ? '看图问答：本次不带聊天记忆，回答也不写入会话历史' : ''"
          @send="sendMessage"
          @stop="handleStop"
          @pick-image="pickImage"
          @remove-image="removeImage"
        />
        <DisclaimerBar />
      </div>
    </div>

    <!-- 轻提示用 antd 的 message(见 App.vue 的 message.config) -->

    <!-- 图片放大预览:点遮罩或按 Esc 关闭 -->
    <ImagePreview v-if="previewUrl" :url="previewUrl" @close="previewUrl = ''" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
// 这里起别名:页面里已经有叫 message 的变量(输入框的草稿)
import { message as antMessage } from 'ant-design-vue'
import StreamMarkdownRender from '@/components/StreamMarkdownRender.vue'
import LoadingDots from '@/components/LoadingDots.vue'
import ThinkingPanel from '@/components/ThinkingPanel.vue'
import MessageActions from '@/components/MessageActions.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import ChatInputBox from '@/components/ChatInputBox.vue'
import ImagePreview from '@/components/ImagePreview.vue'
import { parseChunkPayload } from '@/utils/sse.js'
import {
  lastRegenerableId,
  turnIndexOf as turnIndexOfMessage,
  assignTurns,
  baseTurnOf,
  countUserTurns,
} from '@/utils/chat-turn.js'
import { conversationApi } from '@/api/conversation.js'
import { feedbackApi } from '@/api/chat.js'
import { useAttachment } from '@/utils/attachment.js'
import { sendVisionStream, DEFAULT_QUESTION } from '@/utils/vision.js'
import { useSessionStore } from '@/stores/sessions.js'
import { useModelStore } from '@/stores/model.js'
import { useToolStore } from '@/stores/tools.js'
import { useDraft } from '@/composables/useDraft.js'
import { peekHandoff, clearHandoff } from '@/utils/handoff.js'
import DisclaimerBar from '@/components/DisclaimerBar.vue'

const route = useRoute()

/**
 * 全局状态(store 里):会话列表 / 模型选择 / 工具开关
 *
 * <p>⚠️ 这里**不**把状态通过 emit 传给输入框组件:
 *    教程里那种「子组件 emit 一份 payload 给父组件」的做法在这儿是倒退 ——
 *    父组件拿到的会是一份**拷贝**,用户改了设置(比如在输入框里换了模型)
 *    父组件手里那份还是旧的,发请求时用的就是旧值。
 *    直接读 store:发请求那一刻读到的永远是**当前**的值。
 */
const sessionStore = useSessionStore()
const modelStore = useModelStore()
const toolStore = useToolStore()

/**
 * 本次会话的 uuid —— 来自路由(/chat/:uuid)
 *
 * ⚠️ 现在会话是**后端管理的**:后端建会话时给一个 uuid,前端拿它当地址。
 * 刷新页面 / 把链接发给别人,打开的都是同一个会话 —— 这才像聊天软件。
 */
const chatId = computed(() => route.params?.uuid || '')

/** 历史消息加载中 */
const loadingHistory = ref(false)

/* 工具开关的状态在 store 里(stores/tools.js):首页和聊天页共用同一份勾选。 */
/* ──────────────────────────────────────────────────────────────────────
 * 输入框
 *
 * <p>输入框**本身**是 ChatInputBox 组件 —— 自动长高、Enter 发送、拖图、粘贴图
 *    这些都在组件里。这里只留「页面特有」的那部分:草稿文字、待发送的图片、
 *    以及发出去之后干什么。
 * ────────────────────────────────────────────────────────────────────── */

/**
 * 草稿:每个会话各存各的,刷新页面也不丢
 *
 * <p>⚠️ 为什么不能直接用 `ref('')`:
 *   路由切会话时页面组件是**复用**的(同一个组件,只是参数变了),
 *   所以输入框里的文字会原样跟到下一个会话去 ——
 *   在会话 A 里写「帮我查天气」,点侧边栏切到 B,按发送,这句话就发到 B 里了。
 *   草稿跟着会话走,才不会串。
 */
const { text: message } = useDraft(chatId)
/** 输入框组件(要拿它的 focus) */
const inputRef = ref(null)
const chatScrollRef = ref(null)
/** 聊天内容的容器(高度会变 —— 盯它就知道内容什么时候稳定了) */
const chatContentRef = ref(null)
const isSending = ref(false)

/** 生成消息 id */
const genId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

/**
 * 是否「贴底」
 *
 * 用途：流式输出时，如果用户已经往上翻去看历史消息，就不该再把他拽回底部。
 * 只有贴着底部（或强制滚动）时才跟随滚动。
 */
const stickToBottom = ref(true)

/**
 * 上一次已知的滚动位置
 *
 * <p>用来判断「这次 scroll 事件是不是位置真的动了」——
 *    内容长高也会触发 scroll 事件,那时位置没动(见 handleScroll)。
 */
let lastScrollTop = 0

/**
 * 离顶部多近就往上翻页
 *
 * <p>给 80px 的余量:用户滑到顶之前就先加载好了,不用等他滑到头才发现还有更多。
 */
const TOP_TRIGGER = 80

// 用户手动滚动时更新贴底状态
const handleScroll = () => {
  const el = chatScrollRef.value
  if (!el) return
  // ⚠️ 只在**位置真的动了**的时候更新贴底状态:
  //    内容长高(等 Markdown 渲染完)也会触发 scroll 事件,那时位置没动 ——
  //    用户其实还贴着底,不能因为内容变高就判定「他往上翻了」,
  //    否则一加载完历史就再也贴不回底部了(打开会话停在半截对话上)。
  if (el.scrollTop !== lastScrollTop) {
    // 距底部 24px 以内视为贴底（留一点余量，避免滚动条本身造成抖动）
    stickToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight <= 24
    lastScrollTop = el.scrollTop
  }
  // ⚠️ 滑到顶部了就往上翻一页(更早的消息)。
  //    这里不判「是不是用户滑的」:prepend 完把滚动位置挪回去也会触发 scroll 事件,
  //    而挪回去之后 scrollTop 已经不在顶部了(loadOlderHistory 内部有并发/到底了的保护)。
  if (el.scrollTop <= TOP_TRIGGER) loadOlderHistory()
}

/**
 * 滚动到底部
 * @param {boolean} force 强制滚动（用户刚发消息时用），否则只在贴底时才跟随
 */
const scrollToBottom = async (force = false) => {
  await nextTick()
  const el = chatScrollRef.value
  if (!el) return
  if (!force && !stickToBottom.value) return
  el.scrollTop = el.scrollHeight
}

/**
 * 盯住内容高度:长高了还贴底就继续贴底
 *
 * <p>⚠️ 为什么不能只在「加载完」那一刻滚一次底:
 *   历史消息先进 DOM、Markdown 组件**再异步渲染**(渲染管线是动态 import 的),
 *   气泡高度会**再变一次** —— 只滚一次的话,位置停在「当时的底部」,
 *   用户打开会话看到的是**半截对话**(实测:最新那一轮被输入框挡住一半)。
 *
 * <p>⚠️ 判断「用户还贴不贴底」要用**长高之前**的高度:
 *   内容是在**下面**长高的(新消息排在后面),长高之前贴底 = 现在也该贴底。
 *   拿长高后的高度算就错了 —— 中间那截多出来的空档会被当成「用户往上翻了」,
 *   于是再也回不到底。
 *
 * <p>⚠️ 往上翻页(prepend)也会让高度变 —— 那时不能跟着滚,
 *    prepend 完自己会把位置挪回去(见 loadOlderHistory)。
 */
let contentObserver = null
/** 上一次看到的内容高度(判断「长高之前贴不贴底」用的) */
let lastContentHeight = 0
const watchContentHeight = () => {
  if (!window.ResizeObserver || !chatContentRef.value) return
  contentObserver?.disconnect()
  lastContentHeight = 0
  contentObserver = new ResizeObserver(() => {
    const el = chatScrollRef.value
    if (!el) return
    const height = el.scrollHeight
    // 长高之前贴不贴底(用长高之前的高度算)
    const wasAtBottom = lastContentHeight - el.scrollTop - el.clientHeight <= 24
    lastContentHeight = height
    // ⚠️ 往上翻页的时候别跟着滚 —— prepend 完自己会把位置挪回去
    if (loadingOlder.value) return
    if (!wasAtBottom) return
    stickToBottom.value = true
    el.scrollTop = height
  })
  contentObserver.observe(chatContentRef.value)
}

/* ──────────────────────────────────────────────────────────────────────
 * 聊天记录
 * ────────────────────────────────────────────────────────────────────── */

/** 问候语(新会话的第一屏) */
const GREETING = {
  id: 'greeting',
  role: 'assistant',
  kind: 'text',
  content:
    '我是小哈智能 AI 助手！✨ 我可以帮你解答各种问题，无论是学习、工作，还是日常生活中的小困惑，都可以找我聊聊。有什么我可以帮你的吗？😊',
  done: true,
  // 问候语不是某一轮提问的回答，turn = 0 → 不显示「重新生成」
  turn: 0,
}

/** 聊天记录 */
const chatList = ref([])

/**
 * 待发送的图片(压缩、预览地址、回收都在 useAttachment 里)
 *
 * <p>⚠️ isUrlInUse:气泡里的缩略图正在用某个预览地址时,那个地址不能回收 ——
 *    回收掉用户看到的就是裂图。
 */
const { attachment, preparingImage, pickImage, removeImage, adoptImage } = useAttachment({
  isUrlInUse: (url) => chatList.value.some((c) => c.image?.previewUrl === url),
})

/** 每条消息的点赞/点踩状态：{ [messageId]: 'up' | 'down' | '' } */
const feedbackMap = ref({})

/**
 * 最后一条「有对应提问」的回答 —— 只有它能「重新生成」。
 *
 * 文字对话和看图说话**分别算**：
 *   文字对话要回滚后端记忆（只会回滚最后一轮），所以只能重新生成最后一条；
 *   看图说话是无状态的，没有记忆可回滚，但 UI 上也保持「只给最新一条显示按钮」的一致性。
 *
 * 规则和理由写在 utils/chat-turn.js 里（那里有完整注释，也有单元测试兜着）。
 */
const textRegenerableId = computed(() => lastRegenerableId(chatList.value, 'text'))
const visionRegenerableId = computed(() => lastRegenerableId(chatList.value, 'vision'))

/** 这条消息能不能点「重新生成」（按类型分别看各自的最后一条） */
const regenerableIdOf = (chat) =>
  (chat.kind ?? 'text') === 'vision' ? visionRegenerableId.value : textRegenerableId.value

/**
 * 最后一条消息的内容变化时滚动到底部
 *
 * 只盯最后一条，不对整个 chatList 做 deep watch ——
 * 长对话下每来一个流式分片就深遍历全量历史，开销随对话长度线性增长。
 * flush: 'post' 保证 DOM 已经更新完再量 scrollHeight。
 *
 * ⚠️ 思考链也算:等模型开口的时候页面上唯一在变的就是它,
 *    不跟着滚的话用户盯着的是半截不动的内容,更以为卡死了。
 */
watch(
  () => {
    const last = chatList.value[chatList.value.length - 1]
    return `${last?.content || ''}\u0000${last?.thinking || ''}`
  },
  () => scrollToBottom(),
  { flush: 'post' }
)

/* ──────────────────────────────────────────────────────────────────────
 * 历史消息(分页加载)
 * ────────────────────────────────────────────────────────────────────── */

/**
 * 一页拉多少条历史消息
 *
 * <p>⚠️ 后端一条消息 = 一轮问答里的**一条**(提问或回答),
 *    所以 20 条 ≈ 10 轮。绝大多数会话一轮都用不完,
 *    一次拉完最省事;真的聊了很多轮,再靠「往上一滑」往上翻。
 */
const HISTORY_PAGE_SIZE = 20

/** 下一页的游标(= 上一页最老那条的锚点);空串 = 没有更早的了 */
const historyCursor = ref('')
/** 还有更早的消息吗 */
const historyHasMore = ref(false)
/** 正在往上翻页(防止连点触发并发请求) */
const loadingOlder = ref(false)
/** 已经加载了多少条历史消息(问候语不算) */
const historyMessageCount = ref(0)

/**
 * 这个会话一共多少轮 —— 后端数出来的(归档里 user 消息的条数)。
 *
 * <p>⚠️ 为什么前端需要这个数:分页加载时窗口只装得下一部分消息,
 *    而「第 k 轮」必须是从**会话开头**数起的(反馈上报拿 turnIndex 当定位标识)。
 *    不知道总数,长会话里的轮次号就会整体偏移。
 *    老后端没这个字段 → 0 → 轮次号退化成「从窗口起点算」的相对值。
 */
const totalTurns = ref(0)

/**
 * 窗口里**已归档**的提问条数(= 页面加载的 + 本地发出去被后端记下的)
 *
 * <p>总轮数里有还没加载进来的,也有刚发出去后端还没记的 ——
 *    这个数就是「窗口里已经算数的那部分」,拿它和总轮数一减,
 *    就知道窗口前面还压着几轮。
 */
const archivedInWindow = ref(0)

/**
 * 窗口前面还有几轮(窗口里最早那条之前有多少轮)
 *
 * <p>= 总轮数 - 窗口里已归档的轮次数。
 */
const baseTurn = ref(0)

/**
 * 把后端存的消息转成前端的气泡
 *
 * <p>⚠️ 这里**不**给消息编号轮次:轮次要在整个窗口上一起数
 *    (见 assignTurns)—— 分页加载时窗口会变,单独编号对不上。
 *
 * @param {Array<object>} list 后端的消息数组(按时间正序)
 * @returns {Array<object>} 前端的气泡数组
 */
const mapHistory = (list) => {
  const out = []
  for (const m of list) {
    if (!m) continue
    const base = { id: `h-${m.id}`, kind: 'text', content: m.content || '', done: true }
    if (m.role === 'user') {
      out.push({ ...base, role: 'user' })
    } else {
      out.push({
        ...base,
        role: 'assistant',
        // ⚠️ 失败轮次:新后端会把失败原因存进正文(刷新后看到的就是它);
        //    但**改之前**存的老数据正文是空的 —— 补一句说明,
        //    别让用户看到一个空气泡,以为模型啥也没说就结束了
        failed: m.status === 'error' && !m.content ? '这次回答没有完成（生成出错了）。' : '',
        // status=interrupted = 生成到一半被打断(比如刷新了页面),正文是残缺的
        interrupted: m.status === 'interrupted',
      })
    }
  }
  return out
}

/**
 * 重新给消息编号轮次
 *
 * <p>窗口变了(翻页、发了新消息)就得重算:
 *    窗口前面还有几轮 = 总轮数 - 窗口里**已归档**的轮次数。
 *
 * <p>⚠️ 后端没报总轮数(老版本)时只能按窗口的起点算 —— 轮次号是相对的,
 *    页面显示不受影响,只有反馈上报的定位标识会偏。
 */
const renumberTurns = () => {
  baseTurn.value = baseTurnOf(totalTurns.value, archivedInWindow.value)
  assignTurns(chatList.value, baseTurn.value)
}

/**
 * 拉这个会话的历史消息(**最新的一页**)
 *
 * <p>⚠️ 为什么不是「一次性拉全量」:
 *    长会话一次全拉,首屏要等后端把几百条消息全查出来、全传回来、全渲染出来;
 *    分页之后首屏只等一页,更早的内容等用户往上一滑再要。
 *
 * <p>⚠️ 用的是 POST /chat/message/list(游标分页):不传游标拿到的就是**最新**的一页,
 *    把返回的 nextCursor 传回去才是更早的一页(见 api/conversation.js)。
 */
const loadHistory = async () => {
  const uuid = chatId.value
  if (!uuid) return
  loadingHistory.value = true
  try {
    const res = await conversationApi.messages({ chatId: uuid, size: HISTORY_PAGE_SIZE })
    // ⚠️ 拉的过程中用户可能已经切走/发过消息了 ——
    //    对不上就丢掉这次的结果,别把别人的消息塞进来。
    if (chatId.value !== uuid) return
    historyCursor.value = res.nextCursor
    historyHasMore.value = res.hasMore
    // ⚠️ 绝对赋值(不是累加):换会话时这里要把上一个会话的数清掉
    totalTurns.value = res.totalTurns
    archivedInWindow.value = countUserTurns(res.items)
    historyMessageCount.value = res.items.length
    chatList.value = res.items.length ? mapHistory(res.items) : [{ ...GREETING }]
    renumberTurns()
    scrollToBottom(true)
  } catch (e) {
    console.error('拉历史消息失败: ', e)
    chatList.value = [{ ...GREETING }]
  } finally {
    loadingHistory.value = false
  }
}

/**
 * 往上面翻一页(更早的消息)
 *
 * <p>⚠️ prepend 之后**必须把滚动位置挪回去**:
 *    上面凭空多出一屏内容,不管的话用户看到的是「画面猛地跳了一下」——
 *    他正盯着的那条消息直接被顶出屏幕了,像是点错了。
 *    办法:记住加载前的 scrollHeight,prepend 完再把 scrollTop 加上新增加的高度。
 */
const loadOlderHistory = async () => {
  if (loadingOlder.value || !historyHasMore.value || !historyCursor.value) return
  const uuid = chatId.value
  loadingOlder.value = true
  const el = chatScrollRef.value
  const prevHeight = el?.scrollHeight ?? 0
  const prevTop = el?.scrollTop ?? 0
  try {
    const res = await conversationApi.messages({
      chatId: uuid,
      size: HISTORY_PAGE_SIZE,
      cursor: historyCursor.value,
    })
    // 拉的过程中用户切了会话 → 这次的结果作废
    if (chatId.value !== uuid) return
    historyCursor.value = res.nextCursor
    historyHasMore.value = res.hasMore
    // ⚠️ 取两边的较大值:翻页的请求可能在「刚才那一轮被归档」之前就发出去了,
    //    那时候后端数出来的总轮数还少一轮 —— 直接赋值会把轮次号整体拉低一格。
    if (res.totalTurns > totalTurns.value) totalTurns.value = res.totalTurns
    archivedInWindow.value += countUserTurns(res.items)
    historyMessageCount.value += res.items.length
    if (res.items.length) {
      chatList.value = [...mapHistory(res.items), ...chatList.value]
      renumberTurns()
      // 把滚动位置挪回去(见上面的说明)
      await nextTick()
      if (el) el.scrollTop = prevTop + (el.scrollHeight - prevHeight)
    }
  } catch (e) {
    console.error('加载更早的消息失败: ', e)
  } finally {
    loadingOlder.value = false
  }
}

/* ──────────────────────────────────────────────────────────────────────
 * 首页 → 聊天页 的消息交接
 * ────────────────────────────────────────────────────────────────────── */

/**
 * 消费首页交接过来的消息(有图就走看图说话,没图就走文字对话)
 *
 * <p>⚠️ 交接的东西是**认会话**的(见 utils/handoff.js):
 *    对不上当前会话就不碰 —— 消息不会丢,它还在槽子里,
 *    等用户回到那个会话时才会发出去。
 *
 * <p>⚠️ 发送之前先问一句「这条消息是不是已经发过了」——
 *    判断依据是**会话历史**,不是本地标记:
 *
 *    <p>交接是「建会话 → 跳过去 → 拉历史 → 发消息」四步,
 *       用户在这中间按了 F5 的话:拉历史的请求被浏览器掐断,
 *       旧页面照样往下走 → 把消息「取走清空」了,
 *       可发消息的请求也跟着旧页面一起没了 →
 *       刷新后的新页面接手时槽子里已经空了,**用户的消息就这么丢了**。
 *
 *    <p>所以槽位不靠本地标记清空,而是等**历史里出现这条消息**(说明发出去了)再清。
 *       新页面接手时先看历史:历史里已经有了 → 不重发;还没有 → 照发。
 *       于是「刷新丢消息」和「刷新重发一遍」两个问题一起没了。
 *
 * <p>⚠️ 取消息和发消息之间**不能有 await**:
 *    中间一旦让出事件循环,用户就可能点侧边栏切到别的会话去 ——
 *    那样这条消息就发到别人的会话里了(而且后端记忆也会串)。
 *    所以这里的顺序是:同步取 → 同步塞进气泡 → 才 await。
 */
const consumeHandoff = async () => {
  const uuid = chatId.value

  const handoff = peekHandoff(uuid)
  if (!handoff) return

  // 历史里已经有这条消息了 → 之前那次发送其实成功了(页面中途被刷新过)
  // ⚠️ 这个会话是刚建的(建会话只占个坑,不存消息),
  //    所以历史里出现同一条用户消息,就是「这条已经发过了」。
  if (
    handoff.message &&
    chatList.value.some((c) => c.role === 'user' && c.content === handoff.message)
  ) {
    clearHandoff()
    return
  }

  if (handoff.file) {
    // 带图 → 走看图问答那条链路(图片已经在首页压缩好了,直接用)
    // 预览地址的所有权从首页转到这里 —— 首页那边已经不再回收它了
    adoptImage({ file: handoff.file, previewUrl: handoff.previewUrl })
    message.value = handoff.message
    await sendVisionMessage()
    // ⚠️ 这条路**不管成没成都清空**:图片的 blob 地址只活到本页面结束
    //    (组件一卸载就被回收了),留着也没法重发 —— 留着只会让下次进来时
    //    拿着一张死链图片再发一次。
    clearHandoff()
    return
  }

  message.value = handoff.message
  const ok = await sendTextMessage()
  // ⚠️ 只有真发出去了才清空槽位:发失败(模型报错/网络断了)就留着,
  //    下次进这个会话还能重试(历史里没有它 → 会再发一次)。
  if (ok) clearHandoff()
}

/* ──────────────────────────────────────────────────────────────────────
 * 发送
 * ────────────────────────────────────────────────────────────────────── */

/** 正在跑的流的控制器(用来中途掐断) */
let streamController = null

/** 看图说话那条链路的请求控制器（用来中途掐断） */
let visionController = null

/**
 * 用户主动点了「停止生成」
 *
 * <p>⚠️ 要把它和「页面自己掐断的」(切会话 / 离开页面)分开:
 *    前者是用户的正常操作,气泡里该写一句「已停止生成」;
 *    后者是页面不要这条流了,不该在气泡里留话。
 */
let userStopped = false

/** 掐掉正在跑的流 */
const stopStream = () => {
  if (streamController) {
    streamController.abort()
    streamController = null
  }
}

/**
 * 用户点了「停止生成」
 *
 * <p>两条链路(文字对话 / 看图说话)都要掐 —— 万一用户是在看图说话时点的呢。
 */
const handleStop = () => {
  userStopped = true
  stopStream()
  visionController?.abort()
}

/**
 * 思考链最多留多长(字)
 *
 * <p>⚠️ 思考链可能很长(实测一两千字),全留着气泡会越来越重;
 *    而且有用的是**最后**那几段(它在说什么、准备干什么),
 *    所以超长就从**前面**截掉。
 */
const THINKING_MAX = 4000

/**
 * 攒思考链
 *
 * @param {string} current 已有的思考链
 * @param {string} add     新来的一段
 * @returns {string} 新的思考链
 */
const appendThinking = (current, add) => {
  const next = (current || '') + (add || '')
  return next.length > THINKING_MAX ? next.slice(next.length - THINKING_MAX) : next
}

/**
 * 发起一次流式请求，把正文写进第 replyIndex 条消息
 *
 * 单独抽出来是因为「发送」和「重新生成」共用同一套流式逻辑 ——
 * 重新生成只是把同样的提问再发一次、写到同一条气泡里。
 *
 * @param {string} userMessage 用户提问原文
 * @param {number} replyIndex  要写入的回复消息下标
 * @returns {Promise<{completed: boolean, archived: boolean}>}
 *   completed —— 这一轮是不是正常走完了(出错/被掐断 = false)
 *   archived  —— 后端有没有把这一轮记进归档(= 会话的总轮数要不要 +1)
 */
const startStream = async (userMessage, replyIndex) => {
  // 通过 chatList 取（而不是直接持有 push 进去的原始对象）才能触发 Vue 响应式更新
  // ⚠️ 可能取不到:流跑到一半用户切了会话,chatList 已经被换掉了。
  //    所以每次用之前都要判空 —— 否则会在这儿抛 TypeError,白屏。
  const reply = () => chatList.value[replyIndex]

  // 这一轮不是用户主动停的(上一次停过了,别把标记带过来)
  userStopped = false

  const controller = new AbortController()
  streamController = controller

  // 这一轮是否正常走完 —— 交接那边要靠它决定「消息算不算发出去了」
  let completed = false
  // 这一轮有没有被后端记进归档。
  // ⚠️ 请求压根没送到后端(连不上/被网关掐了)时它压根不存在 ——
  //    这时候总轮数不能给它加上,否则后面每一轮的编号都整体偏一格。
  let archived = false

  try {
    // ⚠️ URL 由接口层拼(api/conversation.js):组件里不出现任何后端地址,
    //    后端换路径/加参数只改那一处。
    //
    // ⚠️ 这里是 **POST**,不能用 EventSource(它只能发 GET)——
    //    走的是 utils/sse.js 那层(基于 @microsoft/fetch-event-source)。
    //
    // ⚠️ 联网搜索:用户开着、但当前模型不支持的话,这次不联网 ——
    //    发 networkSearch=true 后端会直接 400(它不静默降级),
    //    所以这里降级成 false,同时告诉用户「本次没联网」,
    //    别让人以为「开了却没搜」是模型能力之外的事。
    const webSearch = modelStore.webSearchStatus
    if (webSearch.reason) antMessage.info(webSearch.reason)

    // 累计的流式回答文本（只累加正文，不含思考链）
    let responseText = ''
    // 后端发来的失败原因（如「模型输出被 max_tokens 截断…」）。
    // 后端用 event:error 事件下发,这里存下来,收尾时优先展示,别被通用文案盖掉。
    let serverError = ''

    await conversationApi.completion({
      message: userMessage,
      chatId: chatId.value,
      modelName: modelStore.code,
      networkSearch: webSearch.enabled,
      tools: toolStore.toolsParam,
      signal: controller.signal,
      onFrame: ({ event, data }) => {
        // ⚠️ 必须解析:后端用 JSON 信封,data 是 {"v":"正文"} 而不是正文本身。
        //    parseChunkPayload 同时认新旧两种格式,前后端谁先上线都行。
        const payload = parseChunkPayload(data)
        const target = reply()
        // ⚠️ 收到帧 = 后端已经在处理这一轮了 → 它会把它记进归档
        archived = true
        if (!target) return
        if (event === 'message') {
          responseText += payload
          target.content = responseText
          // ⚠️ **收到分片 ≠ 出正文了**:
          //    有些模型第一帧只丢一个换行/一个空格过来。不看内容就撤掉加载动画的话,
          //    屏幕上会空出一段「动画没了、字也没有」的时间 —— 比一直转着更像卡死。
          //    真正有没有东西给用户看,看累积的正文是不是空的。
          target.pending = !responseText.trim()
        } else if (event === 'thinking') {
          // 思考链:**不渲染进正文**(它是模型的内部推理,混进去会污染最终回答),
          // 但要攒起来单独显示 —— 等模型开口可能很久(要先调工具),
          // 这期间后端 SSE 一个字节都不发,只转圈用户会以为卡死了;
          // 思考链里写着它在干什么(「我先并行查询北京、上海…」),那才是有用的等待反馈。
          // 正文已经开始输出后就不再退回「正在思考」状态
          if (!responseText) {
            target.pending = true
            target.thinking = appendThinking(target.thinking, payload)
          }
        } else if (event === 'error') {
          serverError = payload
          // ⚠️ 原因要**记在气泡上**,不能只在「内容为空」时才显示 ——
          //    模型常常先说一两句才失败(比如被内容审核拦下、或第二轮超时),
          //    那时内容不为空,错误就整个被吞掉了:用户看到半截回答,像成功了一样,
          //    根本不知道这一轮其实没答完。
          if (target) target.failed = payload
        }
      },
    })

    // 流正常结束却一个字都没有 → 给个能看的提示，别留个空气泡
    const target = reply()
    if (target && !target.content) {
      target.content = serverError || '抱歉，模型这次没返回内容，请再试一次。'
      target.failed = '' // 原因已经当正文了,别再在下面显示一遍
    }
    // ⚠️ 走完了,但后端报告过失败(event:error)→ 不算成功
    completed = !serverError
    // 流正常结束 = 后端处理完了 → 这一轮进了归档
    archived = true
  } catch (e) {
    const target = reply()
    // ⚠️ 流跑到一半用户切了会话,chatList 已经被换掉了 —— 这条气泡没了,
    //    没什么可收拾的(但结果要return出去,别让调用方拿到 undefined)
    if (!target) return { completed, archived }
    if (e.name === 'AbortError') {
      // ⚠️ 请求已经发出去了(中止发生在发送之后),后端会把它记成一轮「被中断」——
      //    总轮数要算上它,不然后面每一轮的编号都少一格
      archived = true
      if (userStopped) {
        // 用户主动点了「停止」—— 已经答出来的一半留着,下面标一句「已停止生成」
        // (正文一个字都没有时,那行提示就是全部内容,不让气泡空着)
        target.stopped = true
      } else {
        // 页面自己掐掉的(切会话/离开页面)—— 已经收到一半就留着
        target.content = target.content || '已取消。'
      }
    } else {
      console.error('发送消息错误: ', e)
      const reason = e.message || '抱歉，请求出错了，请稍后重试。'
      if (target.content) {
        // 已经有部分正文就留着(用户还能看到模型答了一半的内容),把失败原因标在下面
        target.failed = reason
      } else {
        target.content = reason
      }
    }
  } finally {
    const target = reply()
    if (target) {
      target.pending = false
      // done：输出结束 —— 操作栏（朗读/复制/重新生成/点赞/点踩）这时候才出现
      target.done = true
    }
    if (streamController === controller) streamController = null
    isSending.value = false
    // 侧边栏的会话列表要跟着更新(标题、消息数、最后更新时间)
    sessionStore.loadChats({ reset: true })
  }
  return { completed, archived }
}

/**
 * 问一次「这张图里是什么」
 *
 * 走的是 **fetch + ReadableStream**，不是 EventSource ——
 * 上传文件必须用 POST multipart，而 EventSource 只能发 GET。
 *
 * @param {File} file      要看的图
 * @param {string} question 问什么
 * @param {number} replyIndex 写到第几条回复
 */
const runVisionRequest = async (file, question, replyIndex) => {
  // ⚠️ 可能取不到:流跑到一半用户切了会话,chatList 已经被换掉了(同 startStream)
  const reply = () => chatList.value[replyIndex]
  // 这一轮不是用户主动停的
  userStopped = false
  const controller = new AbortController()
  visionController = controller
  // 后端说「模型没吐出正文」时给的原因(比如思考链把 max_tokens 吃光了)
  let serverError = ''

  try {
    await sendVisionStream({
      file,
      message: question,
      model: visionModel,
      signal: controller.signal,
      onThinking: (text) => {
        // 正文还没出来时维持「正在思考…」;出正文了就撤掉
        // ⚠️ 思考链也要攒起来单独显示(同文字对话那条链路)
        const target = reply()
        if (target && !target.content) {
          target.pending = true
          target.thinking = appendThinking(target.thinking, text)
        }
      },
      onServerError: (reason) => {
        serverError = reason
        // ⚠️ 同文字对话:失败原因要记在气泡上,不能只在「内容为空」时才显示
        const t = reply()
        if (t) t.failed = reason
      },
      onChunk: (_delta, all) => {
        const target = reply()
        if (!target) return
        target.content = all
        // ⚠️ 同文字对话:空分片不算「出正文了」,加载动画要继续转
        //    (不然会空出一段「动画没了、字也没有」的时间)
        target.pending = !all.trim()
      },
    })
    // 流正常结束却一个字都没有 → 给个能看的提示，别留个空气泡
    const target = reply()
    if (target && !target.content) {
      target.content = serverError || '抱歉，模型这次没返回内容，请再试一次。'
      target.failed = '' // 原因已经当正文了,别再在下面显示一遍
    }
  } catch (e) {
    const target = reply()
    if (!target) return
    if (e.name === 'AbortError') {
      if (userStopped) {
        // 用户主动点了「停止」—— 答出来的一半留着,下面标一句「已停止生成」
        target.stopped = true
      } else {
        target.content = target.content || '已取消。'
      }
    } else {
      console.error('看图说话失败: ', e)
      const reason = e.message || '抱歉，请求出错了，请稍后重试。'
      if (target.content) {
        // 已经收到一部分正文就留着（用户还能看到模型答了一半的内容），把失败原因标在下面
        target.failed = reason
      } else {
        target.content = reason
      }
    }
  } finally {
    const target = reply()
    if (target) {
      target.pending = false
      target.done = true
    }
    if (visionController === controller) visionController = null
    isSending.value = false
  }
}

/**
 * 发送按钮的状态:能不能发 + 发不了的话为什么
 *
 * <p>两个信息放一起算 —— 拆成两个 computed 的话,
 *    以后加一条规则忘了同步另一个,就会出现「按钮灰着却说不出为什么」。
 */
const sendState = computed(() => {
  if (isSending.value) return { disabled: true, hint: '正在发送…' }
  // ⚠️ 历史消息还在加载时**不能发**:
  //    加载完会把 chatList 整个换掉(chatList.value = list)——
  //    这时候乐观推进去的「用户提问 + 占位回复」会被一起冲掉,
  //    而模型的回答还在往那个下标写 → 用户的消息就这么没了。
  if (loadingHistory.value) return { disabled: true, hint: '正在加载历史消息…' }
  if (preparingImage.value) return { disabled: true, hint: '正在压缩图片…' }
  // ⚠️ 带图了 → 走看图问答:问题可以留空(让模型自己描述这张图)
  if (attachment.value) return { disabled: false, hint: '' }
  if (!message.value.trim()) return { disabled: true, hint: '说点什么再发' }
  return { disabled: false, hint: '' }
})

// 发送消息
const sendMessage = async () => {
  if (isSending.value || preparingImage.value) return
  // ⚠️ 历史还没加载完就别发 —— 会被加载完的「整体替换」冲掉(见 sendState)
  if (loadingHistory.value) return
  // 一个输入框,带没带图决定走哪条链路:
  //   带图 → /v9/ai/generateStream(多模态,无状态)
  //   没图 → /chat/completion(带聊天记忆)
  if (attachment.value) return sendVisionMessage()
  return sendTextMessage()
}

/**
 * 发一条纯文字提问
 *
 * @returns {Promise<boolean>} 这一轮是不是正常走完了
 */
const sendTextMessage = async () => {
  const userMessage = message.value.trim()
  if (!userMessage) return false
  // ⚠️ 同上:历史没加载完不能发
  //    (首页交接过来的那条消息是在历史加载完之后才发的,不受影响)
  if (loadingHistory.value) return false

  // 标记为发送中（按钮置灰、避免重复发送）
  isSending.value = true

  // 用户消息 + 占位的回复一起推，保证一次渲染出来，不会有中间的空白帧
  chatList.value.push({ id: genId(), role: 'user', kind: 'text', content: userMessage })
  // 添加一个占位的回复消息。pending 表示"还没出正文",用来显示「正在思考…」
  // turn：这一轮是本次会话的第几轮 —— 交给 renumberTurns 统一编号
  //   (问候语是第 0 轮，没有对应的提问，所以不显示「重新生成」按钮)
  chatList.value.push({ id: genId(), role: 'assistant', kind: 'text', content: '', pending: true, done: false, failed: '', turn: 0, thinking: '' })
  const replyIndex = chatList.value.length - 1
  // 编号:第几轮(窗口前面压着几轮 + 窗口里的第几条提问)
  // ⚠️ 分页加载时窗口前面还压着别的轮次,不能简单数窗口里的提问条数 ——
  //    renumberTurns 拿后端报的总轮次算出那个偏移(见 renumberTurns 的说明)
  renumberTurns()

  // 清空输入框(高度会自己收回去 —— 输入框组件盯着内容变化)
  message.value = ''
  // 焦点回到输入框，方便连续追问
  inputRef.value?.focus()

  // 强制滚到底：用户刚发了消息，无条件跟随
  scrollToBottom(true)

  const { completed, archived } = await startStream(userMessage, replyIndex)
  // ⚠️ 后端把这一轮记进归档了 → 会话的总轮数 +1
  //    (没记的话就不能加:总轮数是轮次号的基准,多算一轮后面全偏)
  if (archived) {
    totalTurns.value += 1
    archivedInWindow.value += 1
    renumberTurns()
  }
  return completed
}

/**
 * 发一条「看图说话」的提问
 */
const sendVisionMessage = async () => {
  const att = attachment.value
  if (!att) return
  // ⚠️ 历史没加载完不能发(会被加载完的「整体替换」冲掉,见 sendState)
  if (loadingHistory.value) return

  // 什么都没写就让模型自己描述（后端也有一份默认值，这里自己给更可控）
  const question = message.value.trim() || DEFAULT_QUESTION
  isSending.value = true

  // 轮次：看图说话自己一套编号，不跟文字对话混(renumberTurns 里分开数)
  chatList.value.push({
    id: genId(),
    role: 'user',
    kind: 'vision',
    content: question,
    // 缩略图给气泡用；file 留着给「重新生成」——
    //   /v9 是无状态的，重新生成就是把同一张图再发一次，不用回滚任何东西
    image: { previewUrl: att.previewUrl, name: att.name },
    file: att.file,
    turn: 0,
  })
  chatList.value.push({
    id: genId(),
    role: 'assistant',
    kind: 'vision',
    content: '',
    pending: true,
    done: false,
    failed: '',
    turn: 0,
    thinking: '',
  })
  // 给这一轮编号(看图说话的轮次单独数,见 renumberTurns)
  renumberTurns()
  // ⚠️ 必须在**推完回复消息之后**再算下标 ——
  //    早一行的话这个下标指向的是用户消息，模型的回答会写进用户气泡里，
  //    而真正的回复气泡一直停在「正在思考…」(done 永远是 false，操作栏不出现)。
  const replyIndex = chatList.value.length - 1

  // 图已经随消息发出去了，输入框复位
  // ⚠️ 直接置空,不走 removeImage():气泡里的缩略图还在用这个预览地址,
  //    这时候回收掉,用户看到的就是一张裂图。
  attachment.value = null
  message.value = ''
  inputRef.value?.focus()
  scrollToBottom(true)

  await runVisionRequest(att.file, question, replyIndex)
}

/**
 * 回滚最后一轮（重新生成的前置动作）
 *
 * ⚠️ 为什么必须有这一步：后端按 chatId 存对话记忆（[u1,a1,u2,a2,…]），
 *    直接把同一个提问再发一次，模型会**看到上一版答案**再去回答 ——
 *    变成「在旧答案上改写」，而不是 ChatGPT 那种「换一个答案」。
 *
 * <p>后端这个接口两处存储一起回滚：记忆窗口（模型看的）+ 归档（用户看的）。
 *    只退记忆窗口的话，刷新页面会看到同一个问题问了两遍。
 *
 * @returns {Promise<boolean>} 是否成功回滚
 */
const rollbackLastTurn = async () => {
  return conversationApi.rollbackLastTurn(chatId.value)
}

/**
 * 重新生成：把上一轮的回答重答一遍
 *
 * @param {string} messageId 要重新生成的那条回复的消息 id
 */
const handleRegenerate = async (messageId) => {
  if (isSending.value) return

  const idx = chatList.value.findIndex((c) => c.id === messageId)
  if (idx <= 0) return
  const target = chatList.value[idx]
  if ((target.kind ?? 'text') === 'vision') return regenerateVision(idx)
  return regenerateText(idx)
}

/**
 * 重新生成一条**文字**回答
 *
 * 要先回滚后端记忆，否则模型是在旧答案上改写（见 rollbackLastTurn 的说明）。
 */
const regenerateText = async (idx) => {
  // 只允许重新生成最后一条回答 —— 后端只能回滚最后一轮。
  // 中间那条即使被点到了也不能放行（按钮本来就不显示，这里是兜底）
  if (chatList.value[idx].id !== textRegenerableId.value) return
  // 重新生成的依据是它上面那条用户提问
  const question = chatList.value[idx - 1]
  if (!question || question.role !== 'user') return

  isSending.value = true
  try {
    // 1. 先回滚记忆（见 rollbackLastTurn 的说明）
    const rolled = await rollbackLastTurn()
    if (!rolled) {
      antMessage.info('回滚最后一轮失败，暂时不能重新生成')
      isSending.value = false
      return
    }

    // 2. 清空当前气泡，重新流式请求（写回同一条消息）
    const target = chatList.value[idx]
    target.content = ''
    target.pending = true
    target.done = false
    target.interrupted = false
    target.stopped = false // ⚠️ 上一轮的「已停止」标记也要清掉
    target.failed = '' // ⚠️ 上一轮的失败标记要清掉,不然重试时那个错误还挂在下面
    target.thinking = '' // ⚠️ 上一轮的思考链也要清掉,不然两轮的思考混在一起看
    scrollToBottom(true)

    await startStream(question.content, idx)
  } catch (e) {
    console.error('重新生成失败: ', e)
    antMessage.info('重新生成失败，请稍后重试')
    isSending.value = false
  }
}

/**
 * 重新生成一条**看图说话**的回答
 *
 * ⚠️ 不用回滚：/v9/ai 是无状态的，没有记忆文件可回滚 ——
 *    直接把同一张图 + 同一个问题再发一次就行。
 */
const regenerateVision = async (idx) => {
  if (chatList.value[idx].id !== visionRegenerableId.value) return
  const question = chatList.value[idx - 1]
  if (!question || question.role !== 'user' || !question.file) return

  isSending.value = true
  const target = chatList.value[idx]
  target.content = ''
  target.pending = true
  target.done = false
  target.stopped = false // ⚠️ 上一轮的「已停止」标记也要清掉
  target.failed = '' // ⚠️ 上一轮的失败标记要清掉,不然重试时那个错误还挂在下面
  target.thinking = '' // ⚠️ 上一轮的思考链也要清掉,不然两轮的思考混在一起看
  scrollToBottom(true)

  await runVisionRequest(question.file, question.content, idx)
}

/**
 * 这条回复是本次会话的第几轮（从 1 开始；问候语是 0）
 *
 * 后端的记忆文件是 [u1,a1,u2,a2,…] 这种交替结构，
 * 「第 k 轮的回答」对应记忆里第 2k-1 条 —— 拿它当反馈的定位标识。
 * 规则和理由写在 utils/chat-turn.js 里。
 */
const turnIndexOf = (messageId) => turnIndexOfMessage(chatList.value, messageId)

/**
 * 点赞 / 点踩
 *
 * @param {string} messageId 消息 id
 * @param {string} rating     'up' | 'down' | ''（空 = 取消）
 */
const handleFeedback = (messageId, rating) => {
  feedbackMap.value[messageId] = rating
  if (!rating) return

  const msg = chatList.value.find((c) => c.id === messageId)
  const isVision = (msg?.kind ?? 'text') === 'vision'

  // 上报后端（接口还没上线时失败也无妨，本地状态照常生效）
  // 取消点赞/点踩暂不上报 —— 后端按「最后一条记录为准」处理
  feedbackApi.submit({
    // ⚠️ 看图说话用自己的 chatId：它没有记忆，
    //    共用一个的话反馈里的 turnIndex 会和文字对话的撞车
    chatId: isVision ? visionChatId : chatId.value,
    turnIndex: turnIndexOf(messageId),
    rating,
  })
}

/* ──────────────────────────────────────────────────────────────────────
 * 看图说话:图片的状态在上面(和 chatList 放在一起),
 * 拖拽/粘贴这些交互在 ChatInputBox 组件里。
 * ────────────────────────────────────────────────────────────────────── */

/**
 * 看图说话专用的 chatId —— 只用于「点赞/点踩」上报时做区分。
 *
 * ⚠️ /v9/ai 是无状态的,压根不收 chatId,也没有对应的记忆文件。
 *    但反馈接口是共用的(POST /v2/ai/feedback),如果不换个 id,
 *    看图说话的轮次号会和文字对话的轮次号混在一起 —— 后端只是往 JSONL 里追加一行,
 *    不校验,但事后对账时反馈就指错回答了。
 */
const visionChatId = (() => {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid || `web-vision-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
})()

/**
 * 待发送的图片、压缩状态、图片按钮的禁用态 —— 都在上面的 useAttachment 里。
 *
 * <p>拖拽/粘贴这些交互在 ChatInputBox 组件里(它才是那个「放置区」),
 *    这里只管「拿到一张图之后怎么办」。
 */

/** 放大的图片预览（点遮罩或按 Esc 关闭 —— Esc 由 ImagePreview 组件自己监听） */
const previewUrl = ref('')

const openPreview = (image) => {
  if (image?.previewUrl) previewUrl.value = image.previewUrl
}

/**
 * 看图说话用哪个模型 —— 默认留空 = 后端的 `app.multimodal.default-model` 说了算
 *
 * 为什么要留这个口子:
 *   后端现在的默认模型是 `qwen-omni`(阿里百炼),而开发环境**没配百炼的 API key**,
 *   点一次就会收到 503「provider 'bailian' 没有配置 API key」。
 *   而 minimax(MiniMax-M3)既配了 key 又支持图片,是能直接用的。
 *
 *   前端**不写死**模型名 —— 那是后端配置的事,写死了以后后端换了模型前端还在用旧的。
 *   这里只留一个网址参数当逃生口:
 *      http://localhost:5173/#/?visionModel=m3
 *   （后端那边把 `app.multimodal.default-model` 改成 m3 之后,就不用带这个参数了。）
 */
const urlParam = (name) => {
  const hash = location.hash || ''
  const q = hash.indexOf('?')
  const fromHash = q === -1 ? '' : hash.slice(q + 1)
  const params = new URLSearchParams(`${location.search}&${fromHash}`)
  return (params.get(name) || '').trim()
}

const visionModel = urlParam('visionModel')

/** 看图说话那条链路的请求控制器（用来中途掐断） */
// （声明在上面「发送」那一节,这里不再重复）

// 组件挂载后初始化
onMounted(async () => {
  // ⚠️ 工具清单不在这里拉 —— Layout 挂载时拉一次就够了(整个应用共用一份)。
  //    这里再拉一次会用 localStorage 里的旧值覆盖用户刚在页面上做的勾选。

  // 盯内容高度:Markdown 渲染完高度会再变一次,得重新贴底(见 watchContentHeight)
  watchContentHeight()

  await loadHistory()
  await consumeHandoff()
})

// 组件卸载时自动关闭连接
onBeforeUnmount(() => {
  stopStream()
  // ⚠️ 走 fetch 的那条链路不会自动断,得手动 abort ——
  //    否则组件没了请求还在跑,白白烧后端的 token
  visionController?.abort()
  // 高度观察器也得撤 —— 不然组件没了它还在回调
  contentObserver?.disconnect()
  // object URL 的回收在 useAttachment 里(它自己记着自己创建过哪些)
})

/**
 * 切换会话时(同一个组件复用,只是路由参数变了)
 *
 * ⚠️ 正在跑的流必须掐断:不然它的分片会继续往 replyIndex 写,
 *    而 chatList 已经被新会话的历史换掉了 —— 回答会串到别人的会话里。
 */
watch(
  () => chatId.value,
  async (uuid) => {
    stopStream()
    visionController?.abort()
    chatList.value = []
    feedbackMap.value = {}
    await loadHistory()
    await consumeHandoff()
  }
)
</script>

<style scoped>
.quesiton-container {
  font-size: 16px;
  line-height: 28px;
  color: #262626;
  padding: calc((44px - 28px) / 2) 20px;
  box-sizing: border-box;
  white-space: pre-wrap;
  word-break: break-word;
  background-color: #eff6ff;
  border-radius: 14px;
  max-width: calc(100% - 48px);
  position: relative;
}

/* ---------- 看图说话 ---------- */

/* 提问气泡里的图片 */
.vision-thumb {
  display: block;
  max-width: 100%;
  max-height: 220px;
  width: auto;
  border-radius: 10px;
  margin-bottom: 6px;
  cursor: zoom-in;
}


/* ---------- 聊天区滚动条：颜色淡一点，不抢正文视线 ---------- */
.chat-scroll {
  /* Firefox */
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.16) transparent;
}
/* Chrome / Edge / Safari */
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
