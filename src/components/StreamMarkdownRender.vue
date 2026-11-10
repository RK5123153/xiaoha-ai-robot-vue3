<template>
  <!--
    v-html 注入的内容拿不到 scoped 的 data-v 属性，
    所以下面所有针对渲染结果的样式都必须用 :deep() 穿透。
  -->
  <div class="markdown-body markdown-content" v-html="html" @click="handleClick"></div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { renderMarkdown } from '@/utils/markdown'
import { copyText } from '@/utils/clipboard.js'

/**
 * 流式 Markdown 渲染组件
 *
 * 入参 content 由父组件传入，是**正在流式增长**的 Markdown 原文。
 * 每次内容变化都会重新解析成 HTML 并整体替换。
 */
const props = defineProps({
  content: {
    type: String,
    default: '',
  },
})

const html = ref('')

/**
 * 渲染序号：用来丢弃过期结果
 *
 * 渲染是异步的（要等 KaTeX / highlight.js / mermaid 动态加载），
 * 流式输出时很容易出现「后一个分片先渲染完」的情况。
 * 没有这个序号的话，屏幕上会闪回旧的内容。
 */
let renderSeq = 0

watch(
  () => props.content,
  async (content) => {
    const seq = ++renderSeq
    const result = await renderMarkdown(content)
    // 已经有更新的渲染在跑了，这次的结果直接丢掉
    if (seq !== renderSeq) return
    html.value = result
  },
  { immediate: true }
)

/**
 * 代码块「复制」按钮
 *
 * 按钮是 Markdown 渲染器拼出来的 HTML（v-html 注入），
 * Vue 的事件绑定管不到它，所以只能在组件根元素上做事件委托：
 * 点一下看命中的是不是 .code-copy，是就把同一个代码块里的 <code> 文本复制走。
 *
 * 两个坑：
 * 1. 内容不放 data-* 属性里 —— 代码里的引号/换行要转义两遍，很容易出错；
 *    直接读 <code>.textContent，天然拿到原始文本（高亮用的 <span> 不影响 textContent）。
 * 2. navigator.clipboard 只在 https / localhost 等安全上下文可用，
 *    页面用 http 访问时 writeText 直接 undefined，要留 execCommand 兜底。
 *    —— 这段逻辑抽到 utils/clipboard.js 了，消息底部的「复制」按钮共用同一份。
 */
const handleClick = async (event) => {
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
</script>

<style scoped>
/* ---------- 基础排版 ---------- */
.markdown-body {
  line-height: 1.75;
  color: #262626;
  word-break: break-word;
}

.markdown-body :deep(p) {
  margin: 0.35em 0;
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

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 1.5em;
  margin: 0.35em 0;
}
.markdown-body :deep(ul) { list-style: disc; }
.markdown-body :deep(ol) { list-style: decimal; }
.markdown-body :deep(li) {
  margin: 0.15em 0;
}

/* 嵌套列表换不同的符号，否则三层都是实心圆点，看不出层级 */
.markdown-body :deep(ul ul) { list-style: circle; }
.markdown-body :deep(ul ul ul) { list-style: square; }

/* 序号和圆点染成灰色，别跟正文抢视线 */
.markdown-body :deep(li::marker) {
  color: #9ca3af;
}

.markdown-body :deep(strong) {
  font-weight: 600;
}

/* 删除线 ~~文字~~ */
.markdown-body :deep(del) {
  text-decoration: line-through;
  color: #9ca3af;
}

/* 任务列表 - [x] / - [ ] */
.markdown-body :deep(ul.contains-task-list) {
  list-style: none;
  padding-left: 1.2em;
}
.markdown-body :deep(.task-list-item) {
  list-style: none;
}
.markdown-body :deep(.task-list-item-checkbox) {
  margin: 0 0.45em 0 -1.3em;
  vertical-align: middle;
  accent-color: #4d6bfe;
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

/* ---------- 数学公式（KaTeX） ---------- */
/* 占位符：KaTeX 还在动态加载时，先显示原始 TeX，别留一片空白 */
.markdown-body :deep(.math-pending) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9em;
  color: #6b7280;
}
/* 公式渲染失败（模型写了 KaTeX 不支持的命令） */
.markdown-body :deep(.math-error) {
  color: #dc2626;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9em;
}
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

/* ---------- 流程图（mermaid） ---------- */
.markdown-body :deep(.mermaid-diagram) {
  margin: 0.8em 0;
  text-align: center;
  overflow-x: auto;
}
/* mermaid 生成的 SVG 默认是固定宽度，窄屏下要能缩放 */
.markdown-body :deep(.mermaid-diagram svg) {
  max-width: 100%;
  height: auto;
  /*
    居中靠的是 margin:auto，不是 text-align:center。

    坑：Tailwind 的 preflight 里有 `svg { display: block }`，
    SVG 变成块级盒子后 text-align 对它就完全失效了，
    流程图会死死贴在左边（实测过，靠 text-align 居中是无效的）。
    块级盒子 + margin:auto 才是正路。
  */
  margin: 0 auto;
}
/* 渲染失败时的退路：按代码块显示，等后续分片补齐源码 */
.markdown-body :deep(.mermaid-fallback) {
  margin: 0.6em 0;
}
.markdown-body :deep(.mermaid-fallback pre) {
  background: #f7f8fa;
  border: 1px solid #e8eaed;
  padding: 0.9em 1em;
  border-radius: 8px;
  overflow-x: auto;
  margin: 0;
  line-height: 1.6;
}
.markdown-body :deep(.mermaid-source) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85em;
  white-space: pre;
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
.markdown-body :deep(.hljs-selector-id),
.markdown-body :deep(.hljs-selector-class) {
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

/* ─────────────────────────────────────────────────────────────
   首块不留白：否则正文会比头像低一截（首行 margin-top + 行高半行距叠加约 6px），
   头像看着像「吊」在文字上方。

   两个坑：
   1. :deep() 会保留前面的子代组合符。写成 .markdown-body > :deep(p) 只能命中
      .markdown-body 的直接子元素 —— 而渲染出来的 p/h2 都在 v-html 里，命中不到。
   2. 这条规则的特异性（0,4,0）要高于 .code-block（0,3,0），
      所以放在样式块最后 —— 消息以代码块开头时也能归零。
   ───────────────────────────────────────────────────────────── */
.markdown-body.markdown-content > :deep(:first-child) {
  margin-top: 0;
}
</style>
