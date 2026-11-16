<template>
    <!-- h-dvh 动态视口高度：移动端浏览器地址栏收起/弹出时，输入框不会掉出屏幕
         overflow-hidden：页面本身不滚动，滚动交给下面的聊天区 -->
    <div class="h-dvh max-w-3xl mx-auto flex flex-col overflow-hidden">
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
        <!-- 遍历聊天记录 -->
        <template v-for="(chat, index) in chatList" :key="chat.id">
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

      <!-- 发送消息输入框 -->
      <div class="w-full mb-5 shrink-0">
        <div
          class="bg-gray-100 rounded-3xl px-4 py-3 flex flex-col mx-4 border border-gray-200 transition-colors"
          :class="{ 'is-dropping': isDragOver }"
          @dragenter.prevent="onDragEnter"
          @dragover.prevent
          @dragleave.prevent="onDragLeave"
          @drop.prevent="onDrop"
          @paste="onPaste"
        >
          <!-- 已选中的图片（还没发出去） -->
          <div v-if="attachment" class="mb-2">
            <ImageChip
              :attachment="attachment"
              :busy="preparingImage"
              @remove="clearAttachment"
              @preview="openPreview(attachment)"
            />
          </div>

          <!-- 看图说话模式的提示：把「无状态」这件事说在前面，别让用户误以为模型记得上一张图 -->
          <p v-if="mode === 'vision'" class="hint mb-1.5">
            看图说话是「一张图 + 一个问题」的独立问答，不带聊天记忆
          </p>

          <textarea
            v-model="message"
            :placeholder="mode === 'vision' ? '描述这张图…（留空就让模型自己描述）' : '给小哈 AI 机器人发送消息（Enter 发送，Shift + Enter 换行）'"
            class="bg-transparent border-none outline-none w-full text-sm resize-none min-h-[24px]"
            rows="2"
            @input="autoResize"
            @keydown="handleKeydown"
            @compositionstart="handleCompositionStart"
            @compositionend="handleCompositionEnd"
            ref="textareaRef"
          ></textarea>
          <!-- 发送按钮 -->
        <div class="flex justify-end items-center gap-2">
          <!-- 看图说话才需要选图；文字模式下不显示，免得以为文字也能带图 -->
          <ImagePicker
            v-if="mode === 'vision'"
            :disabled="isSending || preparingImage"
            @pick="onPickImage"
          />
          <button
          @click="sendMessage"
          :disabled="sendDisabled"
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

      <!-- 轻提示：接口未就绪之类的临时状态，3 秒后自动消失 -->
      <div v-if="toast" class="toast">{{ toast }}</div>

      <!-- 图片放大预览：点遮罩或按 Esc 关闭 -->
      <div v-if="previewUrl" class="preview-overlay" @click="previewUrl = ''">
        <img :src="previewUrl" class="preview-img" alt="预览" @click.stop />
      </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import SvgIcon from '@/components/SvgIcon.vue'
import StreamMarkdownRender from '@/components/StreamMarkdownRender.vue'
import MessageActions from '@/components/MessageActions.vue'
import ImagePicker from '@/components/ImagePicker.vue'
import ImageChip from '@/components/ImageChip.vue'
import { parseChunkPayload } from '@/utils/sse.js'
import { lastRegenerableId, turnIndexOf as turnIndexOfMessage } from '@/utils/chat-turn.js'
import { API_BASE } from '@/utils/api.js'
import { prepareImage, isImageFile } from '@/utils/image.js'
import { sendVisionStream, DEFAULT_QUESTION } from '@/utils/vision.js'

/** 两种对话模式。kind 会记在每条消息上，用来决定走哪条后端链路 */
const MODES = [
  { value: 'text', label: '文字对话' },
  { value: 'vision', label: '看图说话' },
]

/** 当前模式：text = 文字对话(有记忆) / vision = 看图说话(无状态) */
const mode = ref('text')

const message = ref('')
const textareaRef = ref(null)
const chatScrollRef = ref(null)
const isSending = ref(false)

/** 轻提示文案（空字符串 = 不显示） */
const toast = ref('')
let toastTimer = null
const showToast = (text) => {
  toast.value = text
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = ''
  }, 3000)
}

/** 生成消息 id */
const genId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

/**
 * 从网址里取一个参数
 *
 * ⚠️ 这个项目用的是 **hash 路由**(createWebHashHistory),网址长这样:
 *      http://localhost:5173/#/?visionModel=m3
 *    查询参数在 **# 后面**,`location.search` 是空的!
 *    所以 hash 和 search 两处都得看。
 *
 * @param {string} name 参数名
 * @returns {string} 没有就是空字符串
 */
const urlParam = (name) => {
  const hash = location.hash || ''
  const q = hash.indexOf('?')
  const fromHash = q === -1 ? '' : hash.slice(q + 1)
  const params = new URLSearchParams(`${location.search}&${fromHash}`)
  return (params.get(name) || '').trim()
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
const visionModel = urlParam('visionModel')

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
// 每条消息都带 id：操作栏的反馈状态、重新生成都要按 id 定位到具体那一条
// done 表示「这条消息输出完了」——操作栏只在 done 之后出现
// kind 表示这条消息属于哪种对话：'text' 走 /v2(有记忆) / 'vision' 走 /v9(无状态)
const chatList = ref([
  {
    id: genId(),
    role: 'assistant',
    kind: 'text',
    content: '我是小哈智能 AI 助手！✨ 我可以帮你解答各种问题，无论是学习、工作，还是日常生活中的小困惑，都可以找我聊聊。有什么我可以帮你的吗？😊',
    done: true,
    // 问候语不是某一轮提问的回答，turn = 0 → 不显示「重新生成」
    turn: 0,
  },
])

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

// SSE 连接
let eventSource = null

// 关闭 SSE 连接
const closeSSE = () => {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
}

/** 看图说话那条链路的请求控制器（用来中途掐断） */
let visionController = null

// 组件卸载时自动关闭连接
onBeforeUnmount(() => {
  closeSSE()
  // ⚠️ 走 fetch 的那条链路不会自动断,得手动 abort ——
  //    否则组件没了请求还在跑,白白烧后端的 token
  visionController?.abort()
  // object URL 不回收会一直占着内存(每个都是一个 Blob 的引用)
  objectUrls.forEach((url) => URL.revokeObjectURL(url))
  objectUrls.length = 0
})

/* ──────────────────────────────────────────────────────────────────────
 * 看图说话：图片的选择、压缩、预览
 * ────────────────────────────────────────────────────────────────────── */

/** 待发送的图片：{ id, file, previewUrl, name, size } */
const attachment = ref(null)

/** 正在处理（压缩）图片 —— 大图要缩放，有几百毫秒的空档 */
const preparingImage = ref(false)

/** 拖拽悬停在输入框上（高亮提示「可以放这儿」） */
const isDragOver = ref(false)

/**
 * 创建过的 object URL
 *
 * 统一在组件卸载时回收。图片发出去之后缩略图还要留在气泡里，
 * 所以中途不能随便 revoke —— 只在「确定没人再引用」时才释放。
 */
const objectUrls = []

/**
 * 释放一个 object URL（如果还有消息在用它，就留着）
 *
 * @param {string} url
 */
const releaseObjectUrl = (url) => {
  if (!url) return
  // 消息气泡里的缩略图还在用这个 URL → 不能回收
  if (chatList.value.some((c) => c.image?.previewUrl === url)) return
  const i = objectUrls.indexOf(url)
  if (i !== -1) {
    objectUrls.splice(i, 1)
    URL.revokeObjectURL(url)
  }
}

/**
 * 选好一张图（点了按钮 / 粘贴 / 拖拽都走这里）
 *
 * @param {File} file
 */
const onPickImage = async (file) => {
  if (!file || isSending.value) return
  preparingImage.value = true
  try {
    // 压缩到大后端能收的体积（Spring 容器默认只收 1MB）
    const { file: prepared } = await prepareImage(file)
    const previewUrl = URL.createObjectURL(prepared)
    objectUrls.push(previewUrl)

    const old = attachment.value
    attachment.value = {
      id: genId(),
      file: prepared,
      previewUrl,
      name: prepared.name,
      size: prepared.size,
    }
    // 换掉的旧图没人引用了才回收
    if (old) releaseObjectUrl(old.previewUrl)
  } catch (e) {
    console.error('图片处理失败: ', e)
    showToast(e.message || '这个文件不能当图片用')
  } finally {
    preparingImage.value = false
  }
}

/** 移除待发送的图片 */
const clearAttachment = () => {
  const old = attachment.value
  attachment.value = null
  if (old) releaseObjectUrl(old.previewUrl)
}

/** 拖拽进入计数器：dragenter/dragleave 会在子元素间反复触发，用计数才不会闪 */
let dragDepth = 0

const onDragEnter = () => {
  if (mode.value !== 'vision') return
  dragDepth++
  isDragOver.value = true
}

const onDragLeave = () => {
  if (mode.value !== 'vision') return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) isDragOver.value = false
}

/**
 * 放下文件
 *
 * ⚠️ 只认图片:拖进来一个 txt 的话,后端会 400，
 *    而且 Spring AI 会**静默丢掉**非图片附件（症状是「图没发出去，模型只看到一句话」），
 *    所以前端先拦一道，给人话。
 */
const onDrop = (e) => {
  dragDepth = 0
  isDragOver.value = false
  if (mode.value !== 'vision') return
  const files = e.dataTransfer?.files || []
  for (const f of files) {
    if (isImageFile(f)) {
      onPickImage(f)
      return
    }
  }
  showToast('只能把图片拖进来')
}

/**
 * 粘贴图片（截图工具 / 右键复制图片）
 *
 * ⚠️ 不 preventDefault：剪贴板里可能同时有图和字（比如从网页复制一段），
 *    把文字也挡掉的话用户会觉得「粘贴失灵了」。
 */
const onPaste = (e) => {
  if (mode.value !== 'vision') return
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.kind === 'file' && item.type?.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) {
        onPickImage(file)
        return
      }
    }
  }
}

/** 放大的图片预览（点遮罩关闭） */
const previewUrl = ref('')

const openPreview = (image) => {
  if (image?.previewUrl) previewUrl.value = image.previewUrl
}

/** Esc 关掉预览 */
const handlePreviewKeydown = (e) => {
  if (e.key === 'Escape') previewUrl.value = ''
}
onMounted(() => window.addEventListener('keydown', handlePreviewKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', handlePreviewKeydown))

/**
 * 切换对话模式
 *
 * 切走的时候把待发送的图片丢掉 —— 文字模式下留着它没有意义,
 * 下次切回来发现「怎么还挂着一张图」会让人困惑。
 */
const switchMode = (next) => {
  if (mode.value === next) return
  mode.value = next
  if (next !== 'vision') clearAttachment()
}

/* ──────────────────────────────────────────────────────────────────────
 * 发送
 * ────────────────────────────────────────────────────────────────────── */

/**
 * 发起一次流式请求，把正文写进第 replyIndex 条消息
 *
 * 单独抽出来是因为「发送」和「重新生成」共用同一套流式逻辑 ——
 * 重新生成只是把同样的提问再发一次、写到同一条气泡里。
 *
 * @param {string} userMessage 用户提问原文
 * @param {number} replyIndex  要写入的回复消息下标
 */
const startStream = (userMessage, replyIndex) => {
  // 通过 chatList 取（而不是直接持有 push 进去的原始对象）才能触发 Vue 响应式更新
  const reply = () => chatList.value[replyIndex]

  try {
    // 建立 SSE 连接
    eventSource = new EventSource(
      `${API_BASE}/generateStream?message=${encodeURIComponent(userMessage)}&chatId=${encodeURIComponent(chatId)}`
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

        // 更新这条消息
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
      // done：输出结束 —— 操作栏（朗读/复制/重新生成/点赞/点踩）这时候才出现
      reply().done = true

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
    reply().done = true
    isSending.value = false
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
        if (!reply().content) reply().pending = true
      },
      onServerError: (reason) => {
        serverError = reason
      },
      onChunk: (_delta, all) => {
        reply().content = all
        reply().pending = false
      },
    })
    // 流正常结束却一个字都没有 → 给个能看的提示，别留个空气泡
    if (!reply().content) {
      reply().content = serverError || '抱歉，模型这次没返回内容，请再试一次。'
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      reply().content = reply().content || '已取消。'
    } else {
      console.error('看图说话失败: ', e)
      // 已经收到一部分正文就留着（用户还能看到模型答了一半的内容），
      // 什么都没有才用错误原因顶上
      reply().content = reply().content || e.message || '抱歉，请求出错了，请稍后重试。'
    }
  } finally {
    reply().pending = false
    reply().done = true
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
  chatList.value.push({ id: genId(), role: 'assistant', kind: 'text', content: '', pending: true, done: false, turn })
  const replyIndex = chatList.value.length - 1

  // 清空输入框并把高度收回去。
  // v-model 的值是异步刷新的，必须等 DOM 更新完再量高度，否则量到的还是旧内容的高度
  message.value = ''
  await nextTick()
  autoResize()
  // 焦点回到输入框，方便连续追问
  textareaRef.value?.focus()

  // 强制滚到底：用户刚发了消息，无条件跟随
  scrollToBottom(true)

  startStream(userMessage, replyIndex)
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
    turn,
  })
  // ⚠️ 必须在**推完回复消息之后**再算下标 ——
  //    早一行的话这个下标指向的是用户消息，模型的回答会写进用户气泡里，
  //    而真正的回复气泡一直停在「正在思考…」(done 永远是 false，操作栏不出现)。
  const replyIndex = chatList.value.length - 1

  // 图已经随消息发出去了，输入框复位
  attachment.value = null
  message.value = ''
  await nextTick()
  autoResize()
  textareaRef.value?.focus()
  scrollToBottom(true)

  await runVisionRequest(att.file, question, replyIndex)
}

/**
 * 回滚后端记忆里的最后一轮（重新生成的前置动作）
 *
 * ⚠️ 为什么必须有这一步：后端按 chatId 存对话记忆（[u1,a1,u2,a2,…]），
 *    直接把同一个提问再发一次，模型会**看到上一版答案**再去回答 ——
 *    变成「在旧答案上改写」，而不是 ChatGPT 那种「换一个答案」。
 *    而且每点一次就往记忆文件里多追加一轮，聊久了记忆越来越脏。
 *
 * 这个接口后端还没实现（见 docs/ 里的方案文档）。
 * 拿不到就返回 false，前端提示用户，**不硬发请求** ——
 * 硬发会把上面两个问题坐实。
 *
 * @returns {Promise<boolean>} 是否成功回滚
 */
const rollbackLastTurn = async () => {
  try {
    const res = await fetch(`${API_BASE}/chats/${encodeURIComponent(chatId)}/last-turn`, {
      method: 'DELETE',
    })
    return res.ok
  } catch (e) {
    return false
  }
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
      showToast('后端的「回滚最后一轮」接口还不可用，暂时不能重新生成')
      isSending.value = false
      return
    }

    // 2. 清空当前气泡，重新流式请求（写回同一条消息）
    const target = chatList.value[idx]
    target.content = ''
    target.pending = true
    target.done = false
    scrollToBottom(true)

    startStream(question.content, idx)
  } catch (e) {
    console.error('重新生成失败: ', e)
    showToast('重新生成失败，请稍后重试')
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
  fetch(`${API_BASE}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // ⚠️ 看图说话用自己的 chatId：它没有记忆，
      //    共用一个的话反馈里的 turnIndex 会和文字对话的撞车
      chatId: isVision ? visionChatId : chatId,
      turnIndex: turnIndexOf(messageId),
      rating,
    }),
  }).catch(() => {
    // 后端接口还没上线，忽略
  })
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
/* 拖拽悬停：告诉用户「可以放这儿」 */
.is-dropping {
  background: #eff6ff;
  border-color: #4d6bfe;
}

.hint {
  font-size: 11px;
  line-height: 16px;
  color: #9ca3af;
}

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

/* 图片放大预览 */
.preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(17, 24, 39, 0.75);
  cursor: zoom-out;
}

.preview-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 8px;
  cursor: default;
}

/* ---------- 轻提示 ---------- */
.toast {
  position: fixed;
  left: 50%;
  /* 落在输入框上方一点，别把「发送」按钮挡住 */
  bottom: 108px;
  transform: translateX(-50%);
  z-index: 50;
  max-width: 80vw;
  padding: 8px 16px;
  border-radius: 8px;
  background: rgba(31, 41, 55, 0.92);
  color: #fff;
  font-size: 13px;
  line-height: 1.5;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
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
