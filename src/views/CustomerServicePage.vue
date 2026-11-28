<template>
  <!--
    AI 智能客服对话页。

    ⚠️ 它**不在 Layout 里面**(路由是顶层的,不是 Layout 的 children) ——
       客服问答是**无状态**的:后端不接聊天记忆、也不把这一轮归档到会话表。
       所以左边栏那份「历史对话列表」对它没有意义 ——
       摆在那儿只会让人以为刚才那轮问答被存下来了(其实刷新就没了)。

    ⚠️ 因此这一页**自己带一个顶栏**:返回 + 标题 + 重新开始。
       没有 Layout 的壳,返回按钮就是唯一的出口,得给足。
  -->
  <div class="h-dvh flex flex-col overflow-hidden bg-white text-gray-800">
    <!-- 顶栏:返回 / 标题 / 重新开始 -->
    <header class="app-header shrink-0 flex items-center gap-1.5 h-12 px-3">
      <a-tooltip title="返回首页" placement="bottom">
        <button
          type="button"
          class="p-1.5 -ml-1 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
          aria-label="返回首页"
          @click="goHome"
        >
          <ArrowLeftOutlined class="text-lg" />
        </button>
      </a-tooltip>

      <h1 class="ml-1 truncate text-[15px] font-medium text-gray-800">智能客服</h1>

      <!-- 顶栏右侧一组 -->
      <div class="ml-auto flex items-center gap-1">
        <!--
          重新开始。
          ⚠️ 客服这一页没有「历史对话列表」可以回来,所以清空只能靠这个按钮 ——
             没有它的话,问乱了只能刷新页面(刷新会把整段对话清掉)。
        -->
        <a-tooltip v-if="canReset" title="清空对话，重新开始" placement="bottomRight">
          <button
            type="button"
            class="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            aria-label="清空对话"
            @click="resetConversation"
          >
            <ClearOutlined class="text-lg" />
          </button>
        </a-tooltip>

        <!--
          问答文件管理。
          ⚠️ 客服能答什么,取决于知识库里有哪些 Markdown 问答文件 ——
             这一页没有「历史对话列表」可以回来,也就没有别的地方能管这些文件,
             入口只能摆在这儿。
        -->
        <a-tooltip title="问答文件管理" placement="bottomRight">
          <button
            type="button"
            class="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            aria-label="问答文件管理"
            @click="filesOpen = true"
          >
            <FileTextOutlined class="text-lg" />
          </button>
        </a-tooltip>
      </div>
    </header>

    <!-- 聊天记录区域:自己滚动,输入框钉在底部 -->
    <div
      ref="scrollRef"
      data-chat-scroll
      class="chat-scroll flex-1 min-h-0 overflow-y-auto pt-4 px-4 pb-2"
      @scroll="handleScroll"
    >
      <!-- 内容限宽:宽屏上不让气泡拉成一整行 -->
      <div ref="contentRef" class="mx-auto w-full max-w-3xl">
        <template v-for="msg in messages" :key="msg.id">
          <!-- 用户提问(靠右) -->
          <div v-if="msg.role === 'user'" data-msg class="flex justify-end mb-4">
            <div class="quesiton-container">
              <p class="whitespace-pre-wrap break-words">{{ msg.content }}</p>
            </div>
          </div>

          <!-- 客服回答(靠左) -->
          <div v-else data-msg class="flex items-start mb-4">
            <!--
              头像:和主聊天页用**同一个** logo(现在是耳机标记)——
              两边都是「小哈 AI」在回答,头像不一样会让用户以为是两个助手。
            -->
            <div class="flex-shrink-0 mr-2.5 pt-0.5">
              <BrandLogo class="w-6 h-6" />
            </div>

            <div class="w-full max-w-[80%] mb-2">
              <!--
                思考链:单独一块、灰字、小字,**不混进正文**。
                客服这条链路要先做一次向量检索(还要调 embedding 接口),
                等它的时候后端一个字节都不发 —— 光一个「正在思考…」用户会以为卡死了。

                ⚠️ 判据是「**有没有思考链**」,不是「还在不在等」:
                   思考链是这一轮的一部分,正文出来了它也还在(用户可能要回看)。
              -->
              <ThinkingPanel v-if="msg.thinking" :text="msg.thinking" :phase="phaseOf(msg)" />
              <!-- 没有思考链 → 至少给个转圈 -->
              <div
                v-else-if="msg.pending"
                class="flex items-center gap-2 text-sm text-gray-400 mb-1"
              >
                <LoadingDots size="sm" label="正在思考" />
                <span aria-hidden="true">正在思考…</span>
              </div>

              <StreamMarkdownRender :content="msg.content" />

              <!-- 用户主动点了「停止」:正文是半截的,标一下免得以为客服就答这么多 -->
              <p v-if="msg.stopped && !msg.pending" class="text-sm text-gray-400 mt-1">
                已停止生成。
              </p>
              <!--
                这一轮出错了:正文很可能只说了一半(检索失败、模型报错…),
                把原因亮出来 —— 不然用户看到的是半截回答,会以为它已经答完了。
              -->
              <p
                v-if="msg.failed && !msg.pending"
                class="text-sm text-amber-600 mt-1.5 whitespace-pre-wrap"
              >{{ msg.failed }}</p>

              <!--
                消息底部的操作栏:只留「朗读 / 复制」。
                ⚠️ 点赞/点踩在这里**没有**:客服问答是无状态的(没有「第 k 轮」),
                   反馈接口要的是 (chatId, turnIndex) —— 拿客服页的轮次去上报,
                   会把主对话的反馈记录搅乱(见 MessageActions 的 showFeedback)。
                ⚠️ 「重新生成」在这里也**没有**:客服场景后端把温度固定成 0
                   (同一个问题要给同一个答案),再问一遍答案一模一样 ——
                   给一个按钮,按了跟没按一样。
              -->
              <MessageActions
                v-if="msg.done && msg.content"
                :content="msg.content"
                :show-feedback="false"
                :can-regenerate="false"
              />
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- 输入框 -->
    <div class="w-full mb-5 shrink-0 px-4">
      <div class="mx-auto w-full max-w-3xl">
        <ChatInputBox
          ref="inputRef"
          v-model="message"
          :send-disabled="sendState.disabled"
          :send-hint="sendState.hint"
          :streaming="isSending"
          placeholder="向小哈 AI 智能客服询问（Enter 发送，Shift + Enter 换行）"
          hint="智能客服只依据知识库内容作答，不联网、不查实时信息"
          :show-capabilities="false"
          :show-image-picker="false"
          @send="sendMessage"
          @stop="handleStop"
        />
      </div>
    </div>

    <!--
      问答文件管理抽屉。
      ⚠️ 放在这一页而不是「设置页」:客服这一页本来就没有侧边栏、没有别的入口,
         知识库文件是这页用户唯一需要「维护」的东西。
    -->
    <KnowledgeFileDrawer v-model:open="filesOpen" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
// 这里给 message 起别名:页面里已经有叫 message 的变量(输入框的草稿)
import { message as antMessage } from 'ant-design-vue'
import StreamMarkdownRender from '@/components/StreamMarkdownRender.vue'
import LoadingDots from '@/components/LoadingDots.vue'
import ThinkingPanel from '@/components/ThinkingPanel.vue'
import MessageActions from '@/components/MessageActions.vue'
import ChatInputBox from '@/components/ChatInputBox.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import KnowledgeFileDrawer from '@/components/KnowledgeFileDrawer.vue'
import { parseChunkPayload } from '@/utils/sse.js'
import { appendThinking, phaseOf } from '@/utils/thinking.js'
import { customerServiceApi } from '@/api/customer-service.js'
import { useServiceStore } from '@/stores/service.js'
import { useDraft } from '@/composables/useDraft.js'

const router = useRouter()

/**
 * 对话记录放在 store 里 —— 切去主对话页再切回来,这段问答还在
 * (客服这一页没有「历史对话列表」可以回来,store 是唯一的去处)
 */
const serviceStore = useServiceStore()
const { messages } = storeToRefs(serviceStore)

/** 输入框里的草稿(客服只有一份,不分会话) */
const { text: message } = useDraft(ref('customer-service'))

/** 输入框组件(要拿它的 focus) */
const inputRef = ref(null)
/** 聊天区的滚动容器 */
const scrollRef = ref(null)
/** 聊天内容的容器(高度会变 —— 盯它就知道内容什么时候稳定了) */
const contentRef = ref(null)
/** 正在流式输出 */
const isSending = ref(false)
/** 问答文件管理抽屉是否打开 */
const filesOpen = ref(false)

/**
 * 本次问答的标识
 *
 * <p>⚠️ 客服问答是**无状态**的:后端不接聊天记忆、也不归档。
 *    这个 id 只用来把后端日志里的同一轮问答串起来 —— 传不传都不影响作答。
 */
const chatId = (() => {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid || `web-service-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
})()

/** 生成消息 id */
const genId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

/** 回首页 */
const goHome = () => {
  router.push({ name: 'home' })
}

/** 能不能「重新开始」(只有欢迎语的时候不用给这个按钮) */
const canReset = computed(() => messages.value.length > 1)

/**
 * 清空对话,重新开始
 *
 * <p>⚠️ 正在流式输出时不能清 —— 流的分片还在往那条气泡里写,
 *    清完它又冒出来一条「幽灵消息」。
 *    这时候给一句提示,别让人以为按钮坏了。
 */
const resetConversation = () => {
  if (isSending.value) {
    antMessage.info('正在回答中，等它答完再清空')
    return
  }
  serviceStore.reset()
  nextTick(() => scrollToBottom(true))
}

/* ──────────────────────────────────────────────────────────────────────
 * 滚动到底部
 *
 * ⚠️ 这里和 ChatPage.vue 是同一套逻辑,原因也一样:
 *   Markdown 是**异步渲染**的(渲染管线是动态 import 的)——
 *   气泡高度会在数据到齐之后**再长一次**。
 *   只在「拿到分片」那一刻滚一次底的话,位置停在「当时的底部」,
 *   用户看到的是**半截对话**。
 *   所以除了盯最后一条消息,还得用 ResizeObserver 盯内容高度。
 * ────────────────────────────────────────────────────────────────────── */

/** 是否「贴底」:用户已经往上翻去看旧内容时,就别把他拽回底部 */
const stickToBottom = ref(true)
/** 上一次已知的滚动位置(用来判断「位置是不是真的动了」) */
let lastScrollTop = 0

const handleScroll = () => {
  const el = scrollRef.value
  if (!el) return
  // ⚠️ 只在**位置真的动了**的时候更新贴底状态:
  //    内容长高(等 Markdown 渲染完)也会触发 scroll 事件,那时位置没动 ——
  //    用户其实还贴着底,不能因为内容变高就判定「他往上翻了」。
  if (el.scrollTop !== lastScrollTop) {
    stickToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight <= 24
    lastScrollTop = el.scrollTop
  }
}

/**
 * 滚到底部
 * @param {boolean} force 强制滚动(用户刚发消息时用)
 */
const scrollToBottom = async (force = false) => {
  await nextTick()
  const el = scrollRef.value
  if (!el) return
  if (!force && !stickToBottom.value) return
  el.scrollTop = el.scrollHeight
}

/** 内容高度观察器 */
let contentObserver = null
/** 上一次看到的内容高度(判断「长高之前贴不贴底」用的) */
let lastContentHeight = 0

const watchContentHeight = () => {
  if (!window.ResizeObserver || !contentRef.value) return
  contentObserver?.disconnect()
  lastContentHeight = 0
  contentObserver = new ResizeObserver(() => {
    const el = scrollRef.value
    if (!el) return
    const height = el.scrollHeight
    // ⚠️ 用**长高之前**的高度判断贴不贴底:
    //    内容是在下面长高的,拿长高后的高度算就错了 ——
    //    中间多出来的那截空档会被当成「用户往上翻了」,于是再也回不到底。
    const wasAtBottom = lastContentHeight - el.scrollTop - el.clientHeight <= 24
    lastContentHeight = height
    if (!wasAtBottom) return
    stickToBottom.value = true
    el.scrollTop = height
  })
  contentObserver.observe(contentRef.value)
}

/**
 * 最后一条消息变化时滚到底部
 *
 * <p>只盯最后一条,不对整个 messages 做 deep watch ——
 *    长对话下每来一个流式分片就深遍历全量历史,开销随对话长度线性增长。
 */
watch(
  () => {
    const last = messages.value[messages.value.length - 1]
    return `${last?.content || ''}\u0000${last?.thinking || ''}`
  },
  () => scrollToBottom(),
  { flush: 'post' }
)

/* ──────────────────────────────────────────────────────────────────────
 * 发送
 * ────────────────────────────────────────────────────────────────────── */

/** 正在跑的流的控制器(用来中途掐断) */
let streamController = null

/**
 * 用户主动点了「停止生成」
 *
 * <p>要把它和「页面自己掐断的」(离开页面)分开:
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

/** 用户点了「停止生成」 */
const handleStop = () => {
  userStopped = true
  stopStream()
}

/**
 * 发送按钮的状态:能不能发 + 发不了的话为什么
 */
const sendState = computed(() => {
  if (isSending.value) return { disabled: true, hint: '正在回答…' }
  if (!message.value.trim()) return { disabled: true, hint: '说点什么再发' }
  return { disabled: false, hint: '' }
})

/**
 * 发一条提问
 */
const sendMessage = async () => {
  if (isSending.value || sendState.value.disabled) return
  const question = message.value.trim()
  if (!question) return

  isSending.value = true
  userStopped = false

  // 用户提问 + 占位的回答,一起推(一次渲染出来,中间不会空一帧)
  messages.value.push({ id: genId(), role: 'user', content: question })
  messages.value.push({
    id: genId(),
    role: 'assistant',
    content: '',
    pending: true,
    done: false,
    failed: '',
    thinking: '',
  })
  // ⚠️ 必须在**推完之后**再算下标 —— 早一行的话这个下标指向的是用户消息,
  //    客服的回答会写进用户气泡里,而真正的回答气泡一直停在「正在思考…」。
  const replyIndex = messages.value.length - 1

  message.value = ''
  inputRef.value?.focus()
  scrollToBottom(true)

  await runStream(question, replyIndex)
}

/**
 * 发起一次流式请求,把正文写进第 replyIndex 条消息
 *
 * @param {string} question 用户提问原文
 * @param {number} replyIndex 要写入的回答消息下标
 */
const runStream = async (question, replyIndex) => {
  const controller = new AbortController()
  streamController = controller

  // 累积的正文(只累加正文,不含思考链)
  let responseText = ''
  // 后端发来的失败原因(它用 event:error 事件下发)
  let serverError = ''

  try {
    await customerServiceApi.chat({
      question,
      chatId,
      signal: controller.signal,
      onFrame: ({ event, data }) => {
        // ⚠️ 必须解析:后端用 JSON 信封,data 是 {"v":"正文"} 而不是正文本身
        const payload = parseChunkPayload(data)
        // ⚠️ 可能取不到:用户已经离开这一页,消息数组被换掉了
        const target = messages.value[replyIndex]
        if (!target) return
        if (event === 'message') {
          responseText += payload
          target.content = responseText
          // ⚠️ **收到分片 ≠ 出正文了**:
          //    有些模型第一帧只丢一个换行/一个空格过来。不看内容就撤掉加载动画的话,
          //    屏幕上会空出一段「动画没了、字也没有」的时间 —— 比一直转着更像卡死。
          target.pending = !responseText.trim()
        } else if (event === 'thinking') {
          // 思考链不混进正文,但要攒起来单独显示(等检索/等模型的时候,
          // 后端可能一个字节都不发,只转圈用户会以为卡死了)
          // ⚠️ **一律攒起来**,不管正文出没出:后端一帧里可能同时有正文和思考链,
          //    只在「还没出正文」时攒的话,思考链的后半截会被整段丢掉
          target.thinking = appendThinking(target.thinking, payload)
          // 但「正在思考」的提示只在正文还没开始时显示
          if (!responseText) {
            target.pending = true
          }
        } else if (event === 'error') {
          serverError = payload
          // ⚠️ 原因要**记在气泡上**,不能只在「内容为空」时才显示 ——
          //    客服常常先说一两句才失败,那时内容不为空,错误就整个被吞掉了。
          target.failed = payload
        }
      },
    })

    // 流正常结束却一个字都没有 → 给个能看的提示,别留个空气泡
    const target = messages.value[replyIndex]
    if (target && !target.content) {
      target.content = serverError || '抱歉，这次没查到什么，请换个说法再问一次。'
      target.failed = '' // 原因已经当正文了,别再在下面显示一遍
    }
  } catch (e) {
    const target = messages.value[replyIndex]
    if (!target) return
    if (e.name === 'AbortError') {
      if (userStopped) {
        // 用户主动点了「停止」—— 已经答出来的一半留着,下面标一句「已停止生成」
        target.stopped = true
      } else {
        // 页面自己掐掉的(离开这一页)—— 已经收到一半就留着
        target.content = target.content || '已取消。'
      }
    } else {
      console.error('智能客服问答失败: ', e)
      // ⚠️ sse.js 那层已经把网络错误翻译成中文了,
      //    后端给的原因(比如「知识库里没有相关内容」)也是原样透出来的。
      const reason = e.message || '抱歉，请求出错了，请稍后重试。'
      if (target.content) {
        // 已经有部分正文就留着,把失败原因标在下面
        target.failed = reason
      } else {
        target.content = reason
      }
    }
  } finally {
    const target = messages.value[replyIndex]
    if (target) {
      target.pending = false
      // done:输出结束 —— 操作栏这时候才出现
      target.done = true
    }
    if (streamController === controller) streamController = null
    isSending.value = false
  }
}

onMounted(() => {
  watchContentHeight()
  // 进页面时贴到底(欢迎语只有一条,但对话是从 store 里恢复的,可能已经很长)
  scrollToBottom(true)
})

onBeforeUnmount(() => {
  // ⚠️ 页面没了,请求也得掐 —— 不然它还在烧后端的 token,
  //    而且分片会继续往已经没人看的消息里写。
  stopStream()
  contentObserver?.disconnect()
})
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
