<template>
  <!-- h-dvh 动态视口高度：移动端浏览器地址栏收起/弹出时，输入框不会掉出屏幕
       overflow-hidden：页面本身不滚动，滚动交给下面的聊天区 -->
  <div class="h-full flex flex-col overflow-hidden">
    <!-- 模式切换：文字对话(有聊天记忆) / 看图说话(无状态) -->
    <div class="shrink-0 pt-3 flex justify-center">
      <div class="inline-flex items-center gap-1 p-1 rounded-full bg-gray-100">
        <button
          v-for="m in MODES"
          :key="m.value"
          type="button"
          class="mode-tab"
          :class="{ 'is-active': mode === m.value }"
          @click="switchMode(m.value)"
        >{{ m.label }}</button>
      </div>
    </div>

    <!-- 聊天记录区域：自己滚动，输入框始终钉在底部 -->
    <div
      class="chat-scroll flex-1 min-h-0 overflow-y-auto pt-4 px-4 pb-2"
      ref="chatScrollRef"
      @scroll="handleScroll"
    >
      <!-- 历史加载中 -->
      <div v-if="loadingHistory" class="flex justify-center py-8">
        <span class="inline-block w-2 h-2 rounded-full bg-gray-300 animate-pulse"></span>
      </div>

      <!-- 内容限宽:宽屏上不让气泡拉成一整行(一行字太长不好读) -->
      <div class="mx-auto w-full max-w-3xl">
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
          </div>
        </div>

        <!-- 大模型回复消息（靠左） -->
        <div v-else class="flex items-start mb-4">
          <!-- 头像 -->
          <div class="flex-shrink-0 mr-3">
            <div class="w-8 h-8 rounded-full flex items-center justify-center border border-gray-200">
              <BrandLogo class="w-5 h-5" />
            </div>
          </div>
          <!-- 回复的内容（Markdown 渲染） -->
          <div class="w-full max-w-[80%] mb-2">
            <!-- 思考态提示：后端把推理过程放在 event:thinking 里，出正文前先给个反馈 -->
            <div v-if="chat.pending" class="flex items-center gap-2 text-sm text-gray-400 mb-1">
              <span class="inline-block w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse"></span>
              <span>正在思考…</span>
            </div>
            <!-- 后端存下来的「被打断」的回答：正文是残缺的,标一下免得以为模型就答这么多 -->
            <p
              v-if="chat.interrupted && !chat.pending && !chat.content"
              class="text-sm text-gray-400"
            >这次回答没有完成（生成被中断了）。</p>
            <StreamMarkdownRender :content="chat.content" />
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
          :send-disabled="sendDisabled"
          :placeholder="mode === 'vision' ? '描述这张图…（留空就让模型自己描述）' : '给小哈 AI 机器人发送消息（Enter 发送，Shift + Enter 换行）'"
          :allow-image="mode === 'vision'"
          :show-tools="mode === 'text'"
          :hint="mode === 'vision' ? '看图说话是「一张图 + 一个问题」的独立问答，不带聊天记忆' : ''"
          @send="sendMessage"
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
import MessageActions from '@/components/MessageActions.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import ChatInputBox from '@/components/ChatInputBox.vue'
import ImagePreview from '@/components/ImagePreview.vue'
import { parseChunkPayload, readSseStream } from '@/utils/sse.js'
import { lastRegenerableId, turnIndexOf as turnIndexOfMessage } from '@/utils/chat-turn.js'
import { chatApi, conversationApi } from '@/utils/api.js'
import { useAttachment } from '@/utils/attachment.js'
import { sendVisionStream, DEFAULT_QUESTION } from '@/utils/vision.js'
import { handoff, loadChats, modelState, toolsParam, resolveWebSearch } from '@/utils/chat-store.js'
import DisclaimerBar from '@/components/DisclaimerBar.vue'

const route = useRoute()

/** 两种对话模式。kind 会记在每条消息上，用来决定走哪条后端链路 */
const MODES = [
  { value: 'text', label: '文字对话' },
  { value: 'vision', label: '看图说话' },
]

/** 当前模式：text = 文字对话(有记忆) / vision = 看图说话(无状态) */
const mode = ref('text')

/**
 * 本次会话的 uuid —— 来自路由(/chat/:uuid)
 *
 * ⚠️ 现在会话是**后端管理的**:后端建会话时给一个 uuid,前端拿它当地址。
 * 刷新页面 / 把链接发给别人,打开的都是同一个会话 —— 这才像聊天软件。
 */
const chatId = computed(() => route.params?.uuid || '')

/** 历史消息加载中 */
const loadingHistory = ref(false)

/* 工具开关的状态在 store 里(utils/chat-store.js):首页和聊天页共用同一份勾选。 */
/* ──────────────────────────────────────────────────────────────────────
 * 输入框
 *
 * <p>输入框**本身**是 ChatInputBox 组件 —— 自动长高、Enter 发送、拖图、粘贴图
 *    这些都在组件里。这里只留「页面特有」的那部分:草稿文字、待发送的图片、
 *    以及发出去之后干什么。
 * ────────────────────────────────────────────────────────────────────── */

const message = ref('')
/** 输入框组件(要拿它的 focus) */
const inputRef = ref(null)
const chatScrollRef = ref(null)
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
 */
watch(
  () => chatList.value[chatList.value.length - 1]?.content,
  () => scrollToBottom(),
  { flush: 'post' }
)

/* ──────────────────────────────────────────────────────────────────────
 * 历史消息
 * ────────────────────────────────────────────────────────────────────── */

/**
 * 把后端存的消息转成前端的气泡
 *
 * <p>⚠️ 轮次(turn)要自己数:后端存的消息里没有「第几轮」这个字段,
 *    它只按 user/assistant 交替存。前端要靠它算反馈的 turnIndex
 *    (一条回答是它上面那条提问的「第 k 轮」的回答)。
 *
 * @param {Array<object>} list 后端的消息数组(按时间正序)
 * @returns {Array<object>} 前端的气泡数组
 */
const mapHistory = (list) => {
  const out = []
  let turn = 0
  for (const m of list) {
    if (!m) continue
    if (m.role === 'user') {
      turn += 1
      out.push({
        id: `h-${m.id}`,
        role: 'user',
        kind: 'text',
        content: m.content || '',
        done: true,
        turn,
      })
    } else {
      out.push({
        id: `h-${m.id}`,
        role: 'assistant',
        kind: 'text',
        content: m.content || '',
        done: true,
        turn,
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
 * 拉这个会话的历史消息
 *
 * <p>⚠️ 用的是 GET /v13/chats/{uuid}(一次性给全量),
 *    不是 POST /chat/message/list(那个是游标正序翻页,第一页给的是**最早**的消息)。
 *    页面要显示的是「最近聊了什么」,一次性拿全量最省事。
 */
const loadHistory = async () => {
  const uuid = chatId.value
  if (!uuid) return
  loadingHistory.value = true
  try {
    const list = await conversationApi.history({ uuid })
    // ⚠️ 拉的过程中用户可能已经切走/发过消息了 ——
    //    对不上就丢掉这次的结果,别把别人的消息塞进来。
    if (chatId.value !== uuid) return
    chatList.value = list.length ? mapHistory(list) : [{ ...GREETING }]
    scrollToBottom(true)
  } catch (e) {
    console.error('拉历史消息失败: ', e)
    chatList.value = [{ ...GREETING }]
  } finally {
    loadingHistory.value = false
  }
}

/* ──────────────────────────────────────────────────────────────────────
 * 首页 → 聊天页 的消息交接
 * ────────────────────────────────────────────────────────────────────── */

/**
 * 消费首页交接过来的消息(有图就走看图说话,没图就走文字对话)
 *
 * <p>用完立刻清空 —— 不清的话,下次进这个页面会把同一条消息**再发一遍**。
 */
const consumeHandoff = async () => {
  const text = handoff.message
  const file = handoff.file
  const preview = handoff.previewUrl

  if (!text && !file) return

  // 先清空,防止 sendMessage 过程中再触发一次
  handoff.message = ''
  handoff.file = null
  handoff.previewUrl = ''

  if (file) {
    // 看图说话:图片已经在首页压缩好了,直接用
    mode.value = 'vision'
    // 预览地址的所有权从首页转到这里 —— 首页那边已经不再回收它了
    adoptImage({ file, previewUrl: preview })
    message.value = text
    await sendVisionMessage()
    return
  }

  message.value = text
  await sendTextMessage()
}

/* ──────────────────────────────────────────────────────────────────────
 * 发送
 * ────────────────────────────────────────────────────────────────────── */

/** 正在跑的流的控制器(用来中途掐断) */
let streamController = null

/** 看图说话那条链路的请求控制器（用来中途掐断） */
let visionController = null

/** 掐掉正在跑的流 */
const stopStream = () => {
  if (streamController) {
    streamController.abort()
    streamController = null
  }
}

/**
 * 发起一次流式请求，把正文写进第 replyIndex 条消息
 *
 * 单独抽出来是因为「发送」和「重新生成」共用同一套流式逻辑 ——
 * 重新生成只是把同样的提问再发一次、写到同一条气泡里。
 *
 * @param {string} userMessage 用户提问原文
 * @param {number} replyIndex  要写入的回复消息下标
 */
const startStream = async (userMessage, replyIndex) => {
  // 通过 chatList 取（而不是直接持有 push 进去的原始对象）才能触发 Vue 响应式更新
  // ⚠️ 可能取不到:流跑到一半用户切了会话,chatList 已经被换掉了。
  //    所以每次用之前都要判空 —— 否则会在这儿抛 TypeError,白屏。
  const reply = () => chatList.value[replyIndex]

  const controller = new AbortController()
  streamController = controller

  try {
    // ⚠️ URL 由接口层拼(utils/api.js):组件里不出现任何后端地址,
    //    后端换路径/加参数只改那一处。
    //
    // ⚠️ 这里是 **POST**,不能用 EventSource(它只能发 GET)——
    //    所以自己 fetch + ReadableStream 读 SSE(帧解析在 utils/sse.js)。
    //
    // ⚠️ 联网搜索:用户开着、但当前模型不支持的话,这次不联网 ——
    //    发 networkSearch=true 后端会直接 400(它不静默降级),
    //    所以这里降级成 false,同时告诉用户「本次没联网」,
    //    别让人以为「开了却没搜」是模型能力之外的事。
    const webSearch = resolveWebSearch()
    if (webSearch.reason) antMessage.info(webSearch.reason)

    const res = await conversationApi.completion({
      message: userMessage,
      chatId: chatId.value,
      modelName: modelState.code,
      networkSearch: webSearch.enabled,
      tools: toolsParam.value,
      signal: controller.signal,
    })

    // 累计的流式回答文本（只累加正文，不含思考链）
    let responseText = ''
    // 后端发来的失败原因（如「模型输出被 max_tokens 截断…」）。
    // 后端用 event:error 事件下发,这里存下来,收尾时优先展示,别被通用文案盖掉。
    let serverError = ''

    await readSseStream(res, ({ event, data }) => {
      // ⚠️ 必须解析:后端用 JSON 信封,data 是 {"v":"正文"} 而不是正文本身。
      //    parseChunkPayload 同时认新旧两种格式,前后端谁先上线都行。
      const payload = parseChunkPayload(data)
      const target = reply()
      if (!target) return
      if (event === 'message') {
        responseText += payload
        target.content = responseText
        target.pending = false
      } else if (event === 'thinking') {
        // 思考链:只用它维持「正在思考…」提示,不渲染进正文,避免污染最终回答。
        // 正文已经开始输出后就不再退回「正在思考」状态
        if (!responseText) target.pending = true
      } else if (event === 'error') {
        serverError = payload
        // ⚠️ 原因要**记在气泡上**,不能只在「内容为空」时才显示 ——
        //    模型常常先说一两句才失败(比如被内容审核拦下、或第二轮超时),
        //    那时内容不为空,错误就整个被吞掉了:用户看到半截回答,像成功了一样,
        //    根本不知道这一轮其实没答完。
        if (target) target.failed = payload
      }
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
      // 自己掐掉的(切会话/离开页面)—— 已经收到一半就留着
      target.content = target.content || '已取消。'
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
    loadChats({ reset: true })
  }
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
      onThinking: () => {
        // 正文还没出来时维持「正在思考…」;出正文了就撤掉
        const target = reply()
        if (target && !target.content) target.pending = true
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
        target.pending = false
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
      target.content = target.content || '已取消。'
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

/** 发送按钮该不该禁用 */
const sendDisabled = computed(() => {
  if (isSending.value || preparingImage.value) return true
  // 看图说话：有图就能发（问题可以留空，让模型自己描述）
  if (mode.value === 'vision') return !attachment.value
  return !message.value.trim()
})

// 发送消息
const sendMessage = async () => {
  if (isSending.value || preparingImage.value) return
  if (mode.value === 'vision') return sendVisionMessage()
  return sendTextMessage()
}

/**
 * 发一条纯文字提问
 */
const sendTextMessage = async () => {
  const userMessage = message.value.trim()
  if (!userMessage) return

  // 标记为发送中（按钮置灰、避免重复发送）
  isSending.value = true

  // 用户消息 + 占位的回复一起推，保证一次渲染出来，不会有中间的空白帧
  chatList.value.push({ id: genId(), role: 'user', kind: 'text', content: userMessage })
  // 添加一个占位的回复消息。pending 表示"还没出正文",用来显示「正在思考…」
  // turn：这是本次会话的第几轮（从 1 开始）——
  //   问候语是第 0 轮，没有对应的提问，所以不显示「重新生成」按钮
  //   ⚠️ 只数**文字**消息：后端的记忆里只有文字轮次，
  //      把看图说话的提问也数进去会跟后端对不上（反馈的 turnIndex 会指错）
  const turn = chatList.value.filter((c) => c.role === 'user' && (c.kind ?? 'text') === 'text').length
  chatList.value.push({ id: genId(), role: 'assistant', kind: 'text', content: '', pending: true, done: false, failed: '', turn })
  const replyIndex = chatList.value.length - 1

  // 清空输入框(高度会自己收回去 —— 输入框组件盯着内容变化)
  message.value = ''
  // 焦点回到输入框，方便连续追问
  inputRef.value?.focus()

  // 强制滚到底：用户刚发了消息，无条件跟随
  scrollToBottom(true)

  await startStream(userMessage, replyIndex)
}

/**
 * 发一条「看图说话」的提问
 */
const sendVisionMessage = async () => {
  const att = attachment.value
  if (!att) return

  // 什么都没写就让模型自己描述（后端也有一份默认值，这里自己给更可控）
  const question = message.value.trim() || DEFAULT_QUESTION
  isSending.value = true

  // 轮次：看图说话自己一套编号，不跟文字对话混
  const turn =
    chatList.value.filter((c) => c.role === 'user' && (c.kind ?? 'text') === 'vision').length + 1

  chatList.value.push({
    id: genId(),
    role: 'user',
    kind: 'vision',
    content: question,
    // 缩略图给气泡用；file 留着给「重新生成」——
    //   /v9 是无状态的，重新生成就是把同一张图再发一次，不用回滚任何东西
    image: { previewUrl: att.previewUrl, name: att.name },
    file: att.file,
    turn,
  })
  chatList.value.push({
    id: genId(),
    role: 'assistant',
    kind: 'vision',
    content: '',
    pending: true,
    done: false,
    failed: '',
    turn,
  })
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
    target.failed = '' // ⚠️ 上一轮的失败标记要清掉,不然重试时那个错误还挂在下面
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
  target.failed = '' // ⚠️ 上一轮的失败标记要清掉,不然重试时那个错误还挂在下面
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
  chatApi.feedback({
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

/**
 * 切换对话模式
 *
 * 切走的时候把待发送的图片丢掉 —— 文字模式下留着它没有意义,
 * 下次切回来发现「怎么还挂着一张图」会让人困惑。
 */
const switchMode = (next) => {
  if (mode.value === next) return
  mode.value = next
  if (next !== 'vision') removeImage()
}

/** 看图说话那条链路的请求控制器（用来中途掐断） */
// （声明在上面「发送」那一节,这里不再重复）

// 组件挂载后初始化
onMounted(async () => {
  // ⚠️ 工具清单不在这里拉 —— Layout 挂载时拉一次就够了(整个应用共用一份)。
  //    这里再拉一次会用 localStorage 里的旧值覆盖用户刚在页面上做的勾选。

  await loadHistory()
  await consumeHandoff()
})

// 组件卸载时自动关闭连接
onBeforeUnmount(() => {
  stopStream()
  // ⚠️ 走 fetch 的那条链路不会自动断,得手动 abort ——
  //    否则组件没了请求还在跑,白白烧后端的 token
  visionController?.abort()
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

/* ---------- 模式切换 ---------- */
.mode-tab {
  padding: 5px 14px;
  border-radius: 9999px;
  font-size: 12px;
  line-height: 18px;
  color: #6b7280;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
}

.mode-tab.is-active {
  color: #262626;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
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
