<template>
    <div class="h-screen max-w-3xl mx-auto flex flex-col">
      <!-- 聊天记录区域 -->
    <div class="flex-1 overflow-y-auto pt-4 px-4" ref="chatScrollRef">
        <!-- 遍历聊天记录 -->
        <template v-for="(chat, index) in chatList" :key="index">
          <!-- 用户提问消息（靠右） -->
          <div v-if="chat.role === 'user'" class="flex justify-end mb-4">
            <div class="quesiton-container">
              <p class="whitespace-pre-wrap break-words">{{ chat.content }}</p>
            </div>
          </div>

          <!-- 大模型回复消息（靠左） -->
          <div v-else class="flex mb-4">
            <!-- 头像 -->
            <div class="flex-shrink-0 mr-3">
              <div class="w-8 h-8 rounded-full flex items-center justify-center border border-gray-200">
                <SvgIcon name="deepseek-logo" customCss="w-5 h-5"></SvgIcon>
              </div>
            </div>
            <!-- 回复的内容（Markdown 渲染） -->
            <div class="p-1 max-w-[80%] mb-2 markdown-body">
              <div v-html="renderMarkdown(chat.content)"></div>
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
            ref="textareaRef"
          ></textarea>
          <!-- 发送按钮 -->
        <div class="flex justify-end">
          <button
          @click="sendMessage"
          :disabled="isSending || !message.trim()"
          :class="[
            'flex items-center justify-center rounded-full w-8 h-8 border transition-colors',
            isSending || !message.trim()
              ? 'bg-gray-300 border-gray-300 cursor-not-allowed'
              : 'bg-[#4d6bfe] border-[#4d6bfe] hover:bg-[#3b5bef]'
          ]">
            <SvgIcon name="up-arrow" :customCss="['w-5 h-5', isSending || !message.trim() ? 'text-gray-100' : 'text-white']"></SvgIcon>
          </button>
        </div>
        </div>
        <div class="flex items-center justify-center text-xs text-gray-400 mt-2">内容由 AI 生成，请仔细甄别</div>
      </div>
    </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import MarkdownIt from 'markdown-it'
import SvgIcon from '@/components/SvgIcon.vue'

// Markdown 渲染器
// html: false  禁用内嵌 HTML，避免 XSS
// breaks: true 单个换行即换行，贴合聊天气泡的阅读习惯
// linkify: true 自动把裸链接识别成可点击链接
const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
})

// 渲染 Markdown 内容
const renderMarkdown = (content) => md.render(content || '')

const message = ref('')
const textareaRef = ref(null)
const chatScrollRef = ref(null)
const isSending = ref(false)

// 自动调整文本域高度的方法
const autoResize = () => {
  const textarea = textareaRef.value
  if (textarea) {
    textarea.style.height = 'auto'
    textarea.style.height = textarea.scrollHeight + 'px'
  }
}

// 自动滚动到底部
const scrollToBottom = async () => {
  await nextTick()
  if (chatScrollRef.value) {
    chatScrollRef.value.scrollTop = chatScrollRef.value.scrollHeight
  }
}

// 键盘事件：Enter 发送，Shift+Enter 换行
const handleKeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
  // Shift+Enter 不拦截，走浏览器默认行为（插入换行）
}

// 组件挂载后初始化
onMounted(() => {
  autoResize()
  scrollToBottom()
  textareaRef.value?.focus()
})

// 聊天记录（默认问候语）
const chatList = ref([
  { role: 'assistant', content: '我是小哈智能 AI 助手！✨ 我可以帮你解答各种问题，无论是学习、工作，还是日常生活中的小困惑，都可以找我聊聊。有什么我可以帮你的吗？😊' }
])

// 聊天记录变化时自动滚动到底部
watch(chatList, scrollToBottom, { deep: true })

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

  // 将用户发送的消息添加到 chatList 聊天列表中
  chatList.value.push({ role: 'user', content: userMessage })

  // 点击发送按钮后，清空输入框
  message.value = ''
  // 将输入框的高度重置
  if (textareaRef.value) {
    textareaRef.value.style.height = 'auto'
  }

  // 添加一个占位的回复消息
  chatList.value.push({ role: 'assistant', content: '' })

  try {
    // 建立 SSE 连接
    eventSource = new EventSource(
      `http://localhost:8080/v2/ai/generateStream?message=${encodeURIComponent(userMessage)}`
    )

    // 累计的流式回答文本
    let responseText = ''

    // 处理消息事件
    eventSource.onmessage = (event) => {
      console.log('接收到数据: ', event.data)
      if (event.data) {
        // 持续追加流式回答
        responseText += event.data

        // 更新最后一条消息
        chatList.value[chatList.value.length - 1].content = responseText
      }
    }

    // 处理错误
    eventSource.onerror = (error) => {
      // 通常 SSE 在完成传输后会触发一次 error 事件，这是正常的
      if (error.eventPhase === EventSource.CLOSED) {
        console.log('SSE 正常关闭')
      } else {
        // 提示用户“请求出错”
        chatList.value[chatList.value.length - 1].content = '抱歉，请求出错了，请稍后重试。'
      }

      // 关闭 SSE、解除发送中状态
      closeSSE()
      isSending.value = false
    }
  } catch (error) {
    console.error('发送消息错误: ', error)
    // 提示用户“请求出错”
    chatList.value[chatList.value.length - 1].content = '抱歉，请求出错了，请稍后重试。'
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

/* ---------- Markdown 渲染样式（v-html 注入的内容需用 :deep 穿透 scoped） ---------- */
.markdown-body :deep(p) {
  margin: 0.35em 0;
  line-height: 1.75;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  font-weight: 600;
  line-height: 1.4;
  margin: 1em 0 0.5em;
}
.markdown-body :deep(h1) { font-size: 1.35em; }
.markdown-body :deep(h2) { font-size: 1.2em; }
.markdown-body :deep(h3) { font-size: 1.08em; }
.markdown-body :deep(h4) { font-size: 1em; }

/* 首个标题不额外留白，避免气泡顶部空一大块 */
.markdown-body > :deep(h1:first-child),
.markdown-body > :deep(h2:first-child),
.markdown-body > :deep(h3:first-child) {
  margin-top: 0;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 1.5em;
  margin: 0.35em 0;
}
.markdown-body :deep(ul) { list-style: disc; }
.markdown-body :deep(ol) { list-style: decimal; }
.markdown-body :deep(li) {
  margin: 0.15em 0;
  line-height: 1.75;
}

.markdown-body :deep(strong) {
  font-weight: 600;
}

.markdown-body :deep(blockquote) {
  border-left: 3px solid #d1d5db;
  padding-left: 0.9em;
  margin: 0.5em 0;
  color: #6b7280;
}

.markdown-body :deep(code) {
  background: #f3f4f6;
  padding: 0.15em 0.35em;
  border-radius: 4px;
  font-size: 0.9em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.markdown-body :deep(pre) {
  background: #f3f4f6;
  padding: 0.8em 1em;
  border-radius: 8px;
  overflow-x: auto;
  margin: 0.5em 0;
  line-height: 1.6;
}
.markdown-body :deep(pre code) {
  background: transparent;
  padding: 0;
  font-size: 0.85em;
}

.markdown-body :deep(a) {
  color: #4d6bfe;
  text-decoration: underline;
}

.markdown-body :deep(hr) {
  border: none;
  border-top: 1px solid #e5e7eb;
  margin: 1em 0;
}

.markdown-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0.5em 0;
  font-size: 0.95em;
}
.markdown-body :deep(th),
.markdown-body :deep(td) {
  border: 1px solid #e5e7eb;
  padding: 0.4em 0.6em;
  text-align: left;
}
.markdown-body :deep(th) {
  background: #f9fafb;
  font-weight: 600;
}
</style>
  