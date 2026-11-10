<template>
    <!-- h-dvh 动态视口高度：移动端浏览器地址栏收起/弹出时，输入框不会掉出屏幕
         overflow-hidden：页面本身不滚动，滚动交给下面的聊天区 -->
    <div class="h-dvh max-w-3xl mx-auto flex flex-col overflow-hidden">
      <!-- 聊天记录区域：自己滚动，输入框始终钉在底部 -->
    <div
      class="chat-scroll flex-1 min-h-0 overflow-y-auto pt-4 px-4 pb-2"
      ref="chatScrollRef"
      @scroll="handleScroll"
    >
        <!-- 遍历聊天记录 -->
        <template v-for="(chat, index) in chatList" :key="index">
          <!-- 用户提问消息（靠右） -->
          <div v-if="chat.role === 'user'" class="flex justify-end mb-4">
            <div class="quesiton-container">
              <p class="whitespace-pre-wrap break-words">{{ chat.content }}</p>
            </div>
          </div>

          <!-- 大模型回复消息（靠左） -->
          <div v-else class="flex items-start mb-4">
            <!-- 头像 -->
            <div class="flex-shrink-0 mr-3">
              <div class="w-8 h-8 rounded-full flex items-center justify-center border border-gray-200">
                <SvgIcon name="deepseek-logo" customCss="w-5 h-5"></SvgIcon>
              </div>
            </div>
            <!-- 回复的内容（Markdown 渲染） -->
            <!-- 不要给这里加顶部内边距：会让正文比头像低一截，对不齐 -->
            <!-- w-full：不加的话这个 flex 子项会「收缩到内容宽度」，表格/代码块就没法撑满，
                 而表格列一多就会挤成一团。文字是左对齐的，撑满宽度不影响观感 -->
            <div class="w-full max-w-[80%] mb-2">
              <!-- 思考态提示：后端把推理过程放在 event:thinking 里，出正文前先给个反馈 -->
              <div v-if="chat.pending" class="flex items-center gap-2 text-sm text-gray-400 mb-1">
                <span class="inline-block w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse"></span>
                <span>正在思考…</span>
              </div>
              <StreamMarkdownRender :content="chat.content" />
            </div>
          </div>
        </template>
    </div>

      <!-- 发送消息输入框 -->
      <div class="w-full mb-5 shrink-0">
        <div class="bg-gray-100 rounded-3xl px-4 py-3 flex flex-col mx-4 border border-gray-200">
          <textarea
            v-model="message"
            placeholder="给小哈 AI 机器人发送消息（Enter 发送，Shift + Enter 换行）"
            class="bg-transparent border-none outline-none w-full text-sm resize-none min-h-[24px]"
            rows="2"
            @input="autoResize"
            @keydown="handleKeydown"
            @compositionstart="handleCompositionStart"
            @compositionend="handleCompositionEnd"
            ref="textareaRef"
          ></textarea>
          <!-- 发送按钮 -->
        <div class="flex justify-end">
          <button
          @click="sendMessage"
          :disabled="isSending || !message.trim()"
          aria-label="发送消息"
          title="发送（Enter）"
          class="flex items-center justify-center bg-[#4d6bfe] text-white rounded-full w-8 h-8 border border-[#4d6bfe] hover:bg-[#3b5bef] transition-colors
                 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#4d6bfe]">
            <SvgIcon name="up-arrow" customCss="w-5 h-5"></SvgIcon>
          </button>
        </div>
        </div>
        <div class="flex items-center justify-center text-xs text-gray-400 mt-2">内容由 AI 生成，请仔细甄别</div>
      </div>
    </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import SvgIcon from '@/components/SvgIcon.vue'
import StreamMarkdownRender from '@/components/StreamMarkdownRender.vue'
import { parseChunkPayload } from '@/utils/sse.js'

const message = ref('')
const textareaRef = ref(null)
const chatScrollRef = ref(null)
const isSending = ref(false)

/** 输入框最大高度（px）。超过就在输入框内部滚动，不把整个页面挤爆 */
const MAX_INPUT_HEIGHT = 300

/**
 * 自动调整文本域高度
 *
 * 关键点：
 * 1. 先把 height 归零再量 scrollHeight —— 否则删字时高度只增不减，框会越撑越大
 * 2. 量到的高度要封顶，超过 MAX_INPUT_HEIGHT 就让输入框自己滚
 */
const autoResize = () => {
  const textarea = textareaRef.value
  if (!textarea) return
  textarea.style.height = 'auto'
  // scrollHeight 是内容高度，和当前 height 无关
  const contentHeight = textarea.scrollHeight
  textarea.style.height = Math.min(contentHeight, MAX_INPUT_HEIGHT) + 'px'
  textarea.style.overflowY = contentHeight > MAX_INPUT_HEIGHT ? 'auto' : 'hidden'
}

/**
 * 是否「贴底」
 *
 * 用途：流式输出时，如果用户已经往上翻去看历史消息，就不该再把他拽回底部。
 * 只有贴着底部（或强制滚动）时才跟随滚动。
 */
const stickToBottom = ref(true)

// 用户手动滚动时更新贴底状态
const handleScroll = () => {
  const el = chatScrollRef.value
  if (!el) return
  // 距底部 24px 以内视为贴底（留一点余量，避免滚动条本身造成抖动）
  stickToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight <= 24
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

/** 输入法组字状态：中文输入法选词时会触发 Enter，必须和「发送」区分开 */
const isComposing = ref(false)
/** 最近一次输入法结束的时间戳：部分浏览器在 compositionend 之后还会补发一个 Enter */
let composingEndedAt = 0

const handleCompositionStart = () => {
  isComposing.value = true
}

const handleCompositionEnd = () => {
  isComposing.value = false
  composingEndedAt = Date.now()
}

/**
 * 键盘事件：Enter 发送，Shift+Enter 换行
 *
 * ⚠️ 中文输入法（最容易被忽略的坑）：
 *   用拼音打字时按 Enter 是「选词」，不是「发送」。不加判断的话，
 *   用户每选一次词就会把半句话发出去。
 *   三个信号一起看才稳：
 *     1. e.isComposing  —— 标准属性，组字期间为 true
 *     2. e.keyCode === 229 —— 老浏览器的组字标记
 *     3. isComposing.value —— 我们自己在 compositionstart/end 里维护的状态
 *   另外部分浏览器在 compositionend 之后还会补发一个 Enter 的 keydown，
 *   用时间戳把这一小段时间内的 Enter 吞掉（人手动再按一次至少隔 150ms，误伤不到）。
 */
const handleKeydown = (e) => {
  if (e.key !== 'Enter') return
  // 组字中 / 刚结束组字：Enter 是选词，不发送
  if (e.isComposing || e.keyCode === 229 || isComposing.value) return
  if (Date.now() - composingEndedAt < 100) return
  // Shift+Enter 不拦截，走浏览器默认行为（插入换行）
  if (e.shiftKey) return
  e.preventDefault()
  sendMessage()
}

// 组件挂载后初始化
onMounted(() => {
  autoResize()
  scrollToBottom(true)
  textareaRef.value?.focus()
})

// 聊天记录（默认问候语）
const chatList = ref([
  { role: 'assistant', content: '我是小哈智能 AI 助手！✨ 我可以帮你解答各种问题，无论是学习、工作，还是日常生活中的小困惑，都可以找我聊聊。有什么我可以帮你的吗？😊' }
])

/**
 * 最后一条消息的内容变化时滚动到底部
 *
 * 只盯最后一条，不对整个 chatList 做 deep watch ——
 * 长对话下每来一个流式分片就深遍历全量历史，开销随对话长度线性增长。
 * flush: 'post' 保证 DOM 已经更新完再量 scrollHeight。
 */
watch(
  () => chatList.value[chatList.value.length - 1]?.content,
  () => scrollToBottom(),
  { flush: 'post' }
)

/**
 * 本次会话的 chatId —— 对应后端多轮对话记忆里的 conversationId。
 *
 * 为什么每次刷新页面都换一个新的:
 *   后端按 chatId 存上下文,而前端刷新后聊天记录是空的。如果沿用旧 chatId,
 *   后端还留着上一段对话,模型会顺着「用户看不见的上下文」回答,显得答非所问。
 *   每次刷新换新 id,前后端状态始终对得上。
 *   同一次页面停留期间(连续追问)id 不变,多轮记忆照常生效。
 */
const chatId = (() => {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid || `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
})()

// SSE 连接
let eventSource = null

// 关闭 SSE 连接
const closeSSE = () => {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
}

// 组件卸载时自动关闭连接
onBeforeUnmount(() => {
  closeSSE()
})

// 发送消息
const sendMessage = async () => {
  // 校验发送的消息不能为空，或正在发送中
  if (!message.value.trim() || isSending.value) return

  const userMessage = message.value.trim()
  // 标记为发送中（按钮置灰、避免重复发送）
  isSending.value = true

  // 用户消息 + 占位的回复一起推，保证一次渲染出来，不会有中间的空白帧
  chatList.value.push({ role: 'user', content: userMessage })
  // 添加一个占位的回复消息。pending 表示"还没出正文",用来显示「正在思考…」
  chatList.value.push({ role: 'assistant', content: '', pending: true })
  const replyIndex = chatList.value.length - 1
  // 通过 chatList 取（而不是直接持有 push 进去的原始对象）才能触发 Vue 响应式更新
  const reply = () => chatList.value[replyIndex]

  // 清空输入框并把高度收回去。
  // v-model 的值是异步刷新的，必须等 DOM 更新完再量高度，否则量到的还是旧内容的高度
  message.value = ''
  await nextTick()
  autoResize()
  // 焦点回到输入框，方便连续追问
  textareaRef.value?.focus()

  // 强制滚到底：用户刚发了消息，无条件跟随
  scrollToBottom(true)

  try {
    // 建立 SSE 连接
    eventSource = new EventSource(
      `http://localhost:8080/v2/ai/generateStream?message=${encodeURIComponent(userMessage)}&chatId=${encodeURIComponent(chatId)}`
    )
    const es = eventSource

    // 累计的流式回答文本（只累加正文，不含思考链）
    let responseText = ''
    // 后端发来的失败原因（如「模型输出被 max_tokens 截断…」）。
    // 后端用 event:error 事件下发,这个事件同样会触发 es.onerror,
    // 所以先把原因存下来,等 onerror 统一处理时优先展示,别被通用文案盖掉。
    let serverError = ''

    // 思考链事件:后端把模型的推理过程单独放在 event:thinking 里。
    // 这里只用它来维持「正在思考…」提示,不渲染进正文,避免污染最终回答。
    // 负载格式和正文一样(JSON 信封 / 旧版纯文本),这里不关心内容,只看有没有数据。
    es.addEventListener('thinking', (event) => {
      if (!event.data) return
      // 正文已经开始输出后就不再退回「正在思考」状态
      if (!responseText) reply().pending = true
    })

    // 后端的失败原因事件:必须在 es.onerror 赋值之前注册,
    // 事件处理器按注册顺序触发,这样 onerror 里能读到已经填好的 serverError。
    es.addEventListener('error', (event) => {
      // ⚠️ 也要解析:后端改成 JSON 信封后,这里拿到的是 {"v":"原因"} 而不是原因本身
      if (event.data) serverError = parseChunkPayload(event.data)
    })

    // 正文事件:event: message,是 EventSource 的默认事件类型,onmessage 就能收到
    es.onmessage = (event) => {
      if (event.data) {
        // 持续追加流式回答
        // ⚠️ 必须解析:后端改成 JSON 信封后,event.data 是 {"v":"正文"} 而不是正文本身。
        //    parseChunkPayload 同时认新旧两种格式,前后端谁先上线都行。
        responseText += parseChunkPayload(event.data)

        // 更新最后一条消息
        reply().content = responseText
        reply().pending = false
      }
    }

    // 处理错误
    es.onerror = () => {
      // EventSource 的收尾分两种,靠 readyState 区分(不能用 error.eventPhase,那个值恒为 2):
      //   readyState === CLOSED(2)     → 永久性失败(HTTP 非 2xx / 406 / CORS 被拒),浏览器不会重连
      //   readyState === CONNECTING(0) → 服务端正常结束了响应(或网络抖动),浏览器准备重连
      // 只有前者才是真错误;后者是流正常结束的表现。
      const hardFailed = es.readyState === EventSource.CLOSED
      // 一个字都没收到正文 → 不管哪种收尾都是失败,给出提示而不是留一个空气泡
      if (hardFailed || !responseText) {
        // 后端给了具体原因就用后端的,没给才退回通用文案
        reply().content = serverError || '抱歉，请求出错了，请稍后重试。'
      }
      reply().pending = false

      // 关闭 SSE、解除发送中状态
      // 必须 close:否则浏览器会按重连策略再发一次同样的请求,AI 会重复回答一遍
      closeSSE()
      isSending.value = false
    }
  } catch (error) {
    console.error('发送消息错误: ', error)
    // 提示用户“请求出错”
    reply().content = '抱歉，请求出错了，请稍后重试。'
    reply().pending = false
    isSending.value = false
  }
}
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
  