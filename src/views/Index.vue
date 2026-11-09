<template>
    <!-- h-dvh 动态视口高度：移动端浏览器地址栏收起/弹出时，输入框不会掉出屏幕
         overflow-hidden：页面本身不滚动，滚动交给下面的聊天区 -->
    <div class="h-dvh max-w-3xl mx-auto flex flex-col overflow-hidden">
      <!-- 聊天记录区域：自己滚动，输入框始终钉在底部 -->
    <!-- @click="handleContentClick"：复制按钮是 v-html 注入的，Vue 绑不到它，只能在容器上做事件委托 -->
    <div
      class="chat-scroll flex-1 min-h-0 overflow-y-auto pt-4 px-4 pb-2"
      ref="chatScrollRef"
      @scroll="handleScroll"
      @click="handleContentClick"
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
            <div class="w-full max-w-[80%] mb-2 markdown-body">
              <!-- 思考态提示：后端把推理过程放在 event:thinking 里，出正文前先给个反馈 -->
              <div v-if="chat.pending" class="flex items-center gap-2 text-sm text-gray-400 mb-1">
                <span class="inline-block w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse"></span>
                <span>正在思考…</span>
              </div>
              <div class="markdown-content" v-html="renderMarkdown(chat.content)"></div>
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
import MarkdownIt from 'markdown-it'
import texmath from 'markdown-it-texmath'
import katex from 'katex'
import hljs from 'highlight.js/lib/common'
import SvgIcon from '@/components/SvgIcon.vue'
// KaTeX 自带字体和排版样式，必须全局引入（不能 scope，否则字体路径会失效）
import 'katex/dist/katex.min.css'

// Markdown 渲染器
// html: false  禁用内嵌 HTML，避免 XSS
// breaks: true 单个换行即换行，贴合聊天气泡的阅读习惯
// linkify: true 自动把裸链接识别成可点击链接
const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
})

/**
 * 数学公式渲染（KaTeX）
 *
 * 为什么要专门搞一套：大模型输出数学公式用的是 LaTeX（\frac、\lim、\int…），
 * markdown-it 完全不认识这些，只会原样吐出 "\lim_{x\to a}"，用户看到的是一堆反斜杠。
 *
 * 选了 KaTeX 而不是 MathJax：
 *   - KaTeX 同步渲染，不会有 MathJax 那种"公式先空白再突然排版"的跳动（流式输出时尤其明显）
 *   - 体积小、无需加载额外字体脚本
 *   - 支持的 LaTeX 子集已经覆盖绝大多数场景
 *
 * 分隔符同时开了两套：
 *   - brackets: \(...\) 行内、\[...\] 块级 —— 大模型最常用的写法
 *   - dollars:  $...$ 行内、$$...$$ 块级 —— 人工编辑和部分模型会用
 * 混着开的好处是模型爱用哪种都能渲染，不用去改后端的 system prompt。
 */
md.use(texmath, {
  engine: katex,
  delimiters: ['dollars', 'brackets'],
  katexOptions: { throwOnError: false },
})

/**
 * ⚠️ texmath 的坑：它注册块级规则时没带 alt 链。
 *
 * markdown-it 的 paragraph 规则只会用「alt 里含 paragraph」的规则去判断
 * 「这一行是不是另起一个块」。texmath 的 math_block 不在 alt 里，于是
 *   极限运算法则
 *   \[                        ← 紧跟在文字后面，没有空行
 *   \lim_{x\to a}...
 * 整段会被当成一个段落吞掉，块级公式规则根本没机会执行，
 * 公式里的 \[ \] 又会被 markdown-it 的转义规则吃掉（变成 [ ]）。
 * 补上 alt 之后，公式块就能正常终止段落。
 */
md.block.ruler.__rules__.forEach((rule) => {
  if (rule.name.startsWith('math_')) {
    rule.alt = ['paragraph', 'reference', 'blockquote']
  }
})
md.block.ruler.__cache__ = null

/**
 * KaTeX 渲染结果缓存
 *
 * 流式输出时，每来一个分片整条消息都要重新渲染一遍，
 * 同一条消息里的公式会被反复渲染 N 次。公式内容是稳定的，缓存一下能省掉大量重复计算。
 */
const katexCache = new Map()
const KATEX_CACHE_MAX = 300

const renderMath = (tex, displayMode) => {
  const key = (displayMode ? 'D:' : 'I:') + tex
  const cached = katexCache.get(key)
  if (cached !== undefined) return cached

  let html
  try {
    // throwOnError: false —— 流式输出时公式往往是"半截"的，
    // 比如只收到 \lim_{x\to，让它抛异常会把整条消息渲染挂掉。
    // 关掉之后 KaTeX 会把这段渲染成红色错误提示，等后续分片补齐就自动正常了。
    html = katex.renderToString(tex, { throwOnError: false, displayMode })
  } catch (e) {
    html = md.utils.escapeHtml(tex)
  }

  if (katexCache.size >= KATEX_CACHE_MAX) katexCache.clear()
  katexCache.set(key, html)
  return html
}

// 覆盖 texmath 默认的 <section><eqn> 模板，换成语义清楚的 class，方便自己写样式
md.renderer.rules.math_inline = (tokens, idx) =>
  `<span class="math-inline">${renderMath(tokens[idx].content, false)}</span>`
md.renderer.rules.math_inline_double = (tokens, idx) =>
  `<div class="math-block">${renderMath(tokens[idx].content, true)}</div>`
md.renderer.rules.math_block = (tokens, idx) =>
  `<div class="math-block">${renderMath(tokens[idx].content, true)}</div>`
md.renderer.rules.math_block_eqno = (tokens, idx) =>
  `<div class="math-block">${renderMath(tokens[idx].content, true)}</div>`

/**
 * 链接：新标签页打开
 *
 * 聊天里的链接多半是文档/官网，让它开新标签比较顺手；
 * 同时补 rel="noopener noreferrer"，防止新页面通过 window.opener 反向操纵本页。
 */
const defaultLinkOpen =
  md.renderer.rules.link_open ||
  ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options))

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const targetIndex = tokens[idx].attrIndex('target')
  if (targetIndex < 0) {
    tokens[idx].attrPush(['target', '_blank'])
  } else {
    tokens[idx].attrs[targetIndex][1] = '_blank'
  }
  tokens[idx].attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpen(tokens, idx, options, env, self)
}

// 代码块渲染：套一层 .code-block 容器，右上角标出语言
// 默认 fence 渲染只输出 <pre><code class="language-x">，语言信息没有可视化位置
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  const info = (token.info || '').trim()
  const lang = info ? info.split(/\s+/)[0] : ''
  const content = token.content

  // ```math / ```latex / ```tex —— 模型的公式有时会用代码块包着，直接当公式渲染
  if (['math', 'latex', 'tex'].includes(lang.toLowerCase())) {
    return `<div class="math-block">${renderMath(content, true)}</div>`
  }

  const escaped = md.utils.escapeHtml(content)
  // 代码高亮：只在认识这个语言时才高亮，未知语言保持原样（避免 hljs 自动探测拖慢渲染）
  let body = escaped
  if (lang && hljs.getLanguage(lang)) {
    try {
      body = hljs.highlight(content, { language: lang, ignoreIllegals: true }).value
    } catch (e) {
      body = escaped
    }
  }

  const label = lang ? `<span class="code-lang">${md.utils.escapeHtml(lang)}</span>` : ''
  const cls = lang ? ` class="language-${md.utils.escapeHtml(lang)}"` : ''
  // 复制按钮：内容不放在 data 属性里，点击时从 <code> 的 textContent 取，避免转义踩坑
  return `<div class="code-block">${label}<button type="button" class="code-copy" title="复制代码">复制</button><pre><code${cls}>${body}</code></pre></div>`
}

/**
 * 需要保护、不做「中英文补空格」的内容：代码块、行内代码、数学公式
 *
 * 数学公式尤其重要：LaTeX 里空格是有意义的，
 * \frac{1}{2} 被插成 \frac{1 }{ 2} 就直接渲染错了。
 * 顺序有讲究：$$...$$ 必须排在 $...$ 前面，否则块级公式会被行内规则先吃掉。
 */
const PROTECT_RE = /(```[\s\S]*?```|`[^`\n]+`|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$\n]*\$)/g

/**
 * 文本规范化：修复合 LLM 输出的「中英文之间缺空格」问题
 *
 * 背景：模型在 tokenize/detokenize 时会漏掉部分空格，典型表现：
 *   "Spring的 Java"  → "Spring 的 Java"
 *   "Weneed"         → "We need"
 * 这类问题源于模型输出层，属于模型/tokenizer 的固有缺陷，后端转发链路是无损的。
 * 这里在渲染前做一次幂等修正作为兜底 —— 所有规则都只在「缺空格」时才补，
 * 重复执行不会产生双空格。
 *
 * ⚠️ 关于「Markdown 标记后补空格」那几条（###xxx → ### xxx）：
 *   这类缺空格的真实原因是 SSE 传输层吃掉了分片开头的空格（后端问题），
 *   不是模型拼错 —— 模型输出的 "### 简单理解" 是带空格的。
 *   后端修复后，这几条规则就成了冗余（但幂等无害，留着当兜底）。
 *   代码块内的空格丢失同样源于 SSE，且**无法在前端修复**
 *   （浏览器已把空格吃掉，前端无从得知原值），必须在后端解决。
 *
 * 注意：代码块、行内代码和数学公式必须先保护起来，否则会破坏内容。
 */
const normalizeText = (text) => {
  if (!text) return ''

  // 按代码块/公式切分:只对普通文本段做规范化,避免破坏代码和公式内容
  // split 带捕获组时,分隔符本身会留在结果数组里,奇数下标即需要保护的部分
  return text
    .split(PROTECT_RE)
    .map((part, i) => (i % 2 === 1 ? part : normalizeSegment(part)))
    .join('')
}

// 规范化单个文本段(不含代码块)
const normalizeSegment = (s) => {
  // 行首标题标记后补空格:###xxx → ### xxx
  // (?![#\s]) 排除「# 后面还是 #」和「# 后面是空格」,保证重复执行不会叠加
  s = s.replace(/^(\s*)(#{1,6})(?![#\s])/gm, '$1$2 ')

  // 行首无序列表后补空格:-xxx → - xxx,+xxx → + xxx
  // - 和 + 后面跟 * 是安全的(内容以加粗开头),所以只排除空白
  s = s.replace(/^(\s*)([-+])(?!\s)/gm, '$1$2 ')

  // 行首 * 列表项后补空格:*xxx → * xxx
  // 这里必须排除 * ,否则 **加粗** 的开标记会被误判成列表项
  s = s.replace(/^(\s*)\*(?![*\s])/gm, '$1* ')

  // 行首有序列表后补空格:1.xxx → 1. xxx
  s = s.replace(/^(\s*)(\d+\.)(?!\s)/gm, '$1$2 ')

  // 中英文之间补空格(仅在缺失时补,已有空格的不受影响)
  s = s.replace(/([一-龥])([A-Za-z0-9])/g, '$1 $2')
  s = s.replace(/([A-Za-z0-9])([一-龥])/g, '$1 $2')

  return s
}

// 渲染 Markdown 内容
const renderMarkdown = (content) => md.render(normalizeText(content))

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

/**
 * 代码块「复制」按钮
 *
 * 按钮是 Markdown 渲染器拼出来的 HTML（v-html 注入），
 * Vue 的事件绑定管不到它，所以只能在聊天区容器上做事件委托：
 * 点一下看命中的是不是 .code-copy，是就把同一个代码块里的 <code> 文本复制走。
 *
 * 两个坑：
 * 1. 内容不放 data-* 属性里 —— 代码里的引号/换行要转义两遍，很容易出错；
 *    直接读 <code>.textContent，天然拿到原始文本（高亮用的 <span> 不影响 textContent）。
 * 2. navigator.clipboard 只在 https / localhost 等安全上下文可用，
 *    页面用 http 访问时 writeText 直接 undefined，要留 execCommand 兜底。
 */
const handleContentClick = async (event) => {
  const target = event.target
  if (!target || typeof target.closest !== 'function') return
  const btn = target.closest('.code-copy')
  if (!btn) return

  const code = btn.parentElement?.querySelector('pre code')
  if (!code) return
  const text = code.textContent || ''

  const ok = await copyText(text)
  btn.textContent = ok ? '已复制' : '复制失败'
  // 1.5 秒后恢复原样，避免用户以为按钮坏了
  setTimeout(() => {
    btn.textContent = '复制'
  }, 1500)
}

const copyText = async (text) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch (e) {
    // 权限被拒时走下面的兜底
  }

  // 兜底：老办法（已被多数浏览器标记为 deprecated，但在非安全上下文里仍可用）
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch (e) {
    return false
  }
}

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
    es.addEventListener('thinking', (event) => {
      if (!event.data) return
      // 正文已经开始输出后就不再退回「正在思考」状态
      if (!responseText) reply().pending = true
    })

    // 后端的失败原因事件:必须在 es.onerror 赋值之前注册,
    // 事件处理器按注册顺序触发,这样 onerror 里能读到已经填好的 serverError。
    es.addEventListener('error', (event) => {
      if (event.data) serverError = event.data
    })

    // 正文事件:event: message,是 EventSource 的默认事件类型,onmessage 就能收到
    es.onmessage = (event) => {
      if (event.data) {
        // 持续追加流式回答
        responseText += event.data

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

/* 首块不留白 —— 放在样式块末尾，见文件底部同名规则 */

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

/* 代码块：独立容器 + 边框，和 inline code 区分开，边界更清晰 */
.markdown-body :deep(.code-block) {
  position: relative;
  background: #f7f8fa;
  border: 1px solid #e8eaed;
  border-radius: 8px;
  margin: 0.6em 0;
  overflow: hidden;
}

/* 左上角语言标签（```python → python） */
.markdown-body :deep(.code-lang) {
  position: absolute;
  top: 0;
  left: 0;
  padding: 1px 10px 2px;
  font-size: 11px;
  line-height: 1.6;
  color: #4b5563;
  background: #eef0f3;
  border-bottom-right-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  pointer-events: none;
  user-select: none;
}

/* 右上角复制按钮：默认淡出，鼠标移进代码块才显形（不然整屏都是按钮，很吵） */
.markdown-body :deep(.code-copy) {
  position: absolute;
  top: 5px;
  right: 7px;
  z-index: 1;
  padding: 2px 9px;
  font-size: 11px;
  line-height: 1.6;
  color: #4b5563;
  background: #eef0f3;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, color 0.15s ease, background 0.15s ease;
}
.markdown-body :deep(.code-block:hover .code-copy) {
  opacity: 1;
}
.markdown-body :deep(.code-copy:hover) {
  color: #1f2937;
  background: #e2e6ea;
}

/* 兜底：没有走 .code-block 的裸 <pre> */
.markdown-body :deep(pre) {
  background: #f7f8fa;
  border: 1px solid #e8eaed;
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

/* .code-block 内的 pre 由容器负责边框和背景，这里清掉自身的 */
.markdown-body :deep(.code-block pre) {
  background: transparent;
  border: none;
  /* 顶部留出标签行的高度，免得语言标签压住第一行代码 */
  padding: 2.1em 1em 0.9em;
  border-radius: 0;
  margin: 0;
  overflow-x: auto;
}
.markdown-body :deep(.code-block pre code) {
  background: transparent;
  padding: 0;
  display: block;
  font-size: 0.85em;
}

/* ---------- 数学公式（KaTeX） ---------- */
/* 块级公式：居中，超宽时自己横向滚动，不撑破聊天区 */
.markdown-body :deep(.math-block) {
  margin: 0.8em 0;
  padding: 0.2em 0;
  text-align: center;
  overflow-x: auto;
  overflow-y: hidden;
}
/* KaTeX 自带的 .katex-display 有 margin: 1em 0，会让公式上下留白过大 */
.markdown-body :deep(.katex-display) {
  margin: 0;
}
/* 行内公式：跟着正文基线走，不要因为 KaTeX 的高度把整行顶高 */
.markdown-body :deep(.math-inline) {
  line-height: inherit;
}
.markdown-body :deep(.math-inline .katex) {
  font-size: 1.05em;
}
/* 公式在窄屏下不要换行错位，交给 .math-block 横向滚动 */
.markdown-body :deep(.katex) {
  white-space: nowrap;
}

/* ---------- 代码高亮配色（highlight.js token，scoped 版） ----------
   没有引入整份 hljs 主题 CSS：全局主题会把 token 颜色带到其它地方，
   这里只给 .markdown-body 里的 token 上色。 */
.markdown-body :deep(.hljs-comment),
.markdown-body :deep(.hljs-quote) {
  color: #6a737d;
  font-style: italic;
}
.markdown-body :deep(.hljs-keyword),
.markdown-body :deep(.hljs-selector-tag),
.markdown-body :deep(.hljs-literal),
.markdown-body :deep(.hljs-doctag),
.markdown-body :deep(.hljs-operator) {
  color: #d73a49;
}
.markdown-body :deep(.hljs-string),
.markdown-body :deep(.hljs-regexp),
.markdown-body :deep(.hljs-addition),
.markdown-body :deep(.hljs-attribute) {
  color: #032f62;
}
.markdown-body :deep(.hljs-number),
.markdown-body :deep(.hljs-symbol),
.markdown-body :deep(.hljs-bullet),
.markdown-body :deep(.hljs-link) {
  color: #005cc5;
}
.markdown-body :deep(.hljs-title),
.markdown-body :deep(.hljs-section),
.markdown-body :deep(.hljs-title.class_),
.markdown-body :deep(.hljs-title.function_) {
  color: #6f42c1;
}
.markdown-body :deep(.hljs-type),
.markdown-body :deep(.hljs-built_in),
.markdown-body :deep(.hljs-class .hljs-title) {
  color: #e36209;
}
.markdown-body :deep(.hljs-variable),
.markdown-body :deep(.hljs-template-variable),
.markdown-body :deep(.hljs-params),
.markdown-body :deep(.hljs-punctuation) {
  color: #24292e;
}
.markdown-body :deep(.hljs-tag),
.markdown-body :deep(.hljs-name) {
  color: #22863a;
}
.markdown-body :deep(.hljs-attr),
.markdown-body :deep(.hljs-selector-class),
.markdown-body :deep(.hljs-selector-id) {
  color: #6f42c1;
}
.markdown-body :deep(.hljs-meta) {
  color: #6a737d;
}
.markdown-body :deep(.hljs-deletion) {
  color: #b31d28;
  background: #ffeef0;
}
.markdown-body :deep(.hljs-emphasis) {
  font-style: italic;
}
.markdown-body :deep(.hljs-strong) {
  font-weight: 600;
}

.markdown-body :deep(a) {
  color: #4d6bfe;
  text-decoration: underline;
  /* 长 URL 不换行会撑破气泡 */
  overflow-wrap: anywhere;
}

/* 模型偶尔会贴图片链接：不限制宽度的话大图会把气泡撑破 */
.markdown-body :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  margin: 0.3em 0;
  display: block;
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

/* ─────────────────────────────────────────────────────────────
   首块不留白：否则正文会比头像低一截（首行 margin-top + 行高半行距叠加约 6px），
   头像看着像「吊」在文字上方。

   两个坑：
   1. :deep() 会保留前面的子代组合符。写成 .markdown-body > :deep(p) 只能命中
      .markdown-body 的直接子元素 —— 而渲染出来的 p/h2 都在 .markdown-content 里，命中不到。
   2. 这条规则的特异性要不低于 .code-block（同样是 0,3,0），所以放在样式块最后，
      靠源码顺序取胜 —— 消息以代码块开头时也能归零。
   ───────────────────────────────────────────────────────────── */
.markdown-body .markdown-content > :deep(:first-child) {
  margin-top: 0;
}
</style>
  