/**
 * Markdown 渲染管线
 *
 * 分成「同步解析」和「异步增强」两段：
 *
 *   1. 同步段：markdown-it 解析出 HTML 骨架，公式/代码/流程图先留成占位符
 *   2. 异步段：需要重库的地方（KaTeX / highlight.js / mermaid）动态 import 进来，
 *              再把占位符替换成真正的内容
 *
 * 为什么要拆两段：
 *   - markdown-it 很小（~110 KB），首屏就要用（问候语也是 markdown），静态引入；
 *   - KaTeX 273 KB、highlight.js 190 KB、mermaid 按需 —— 这些只在真的出现
 *     公式/代码块/流程图时才下载。首屏 JS 从 791 KB 降到 ~180 KB。
 *   - 拆成两段还顺带解决了「流式输出时闪烁」的问题：
 *     增强是在 HTML 字符串里完成的，不是渲染完再改 DOM，
 *     所以不会出现「先显示原始 LaTeX、再变成公式」的一帧跳动。
 *
 * 另外：解析器是模块级单例。聊天区是 v-for，每条消息一个组件实例，
 * 在组件里 new MarkdownIt() 会变成 N 份解析器 + N 份缓存。
 */
import MarkdownIt from 'markdown-it'
import texmath from 'markdown-it-texmath'
import taskLists from 'markdown-it-task-lists'
import { looksLikeMermaid, renderMermaidSvg } from './mermaid.js'

/**
 * MarkdownIt 实例
 *
 * 配置逐条说明：
 *   html: false       禁用内嵌 HTML，避免 XSS（AI 回复是不可信输入）
 *   breaks: true      单个换行即换行，贴合聊天气泡的阅读习惯
 *   linkify: true     自动把裸链接识别成可点击链接
 *
 * 教程里常见的另外几个选项，这里特意没开：
 *   typographer: true 会把 " 变成 “”、... 变成 …、-- 变成 –，是在改写用户看到的原文，
 *                  对聊天场景是"惊喜"而不是"优化"，需要的话在这里开即可（不影响代码和公式）
 *   xhtmlOut: true    HTML5 里没有意义，<br /> 和 <br> 等价，纯属噪音
 *   langPrefix        "language-" 本来就是 markdown-it 的默认值，这行等于没写
 */
export const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
})

// 任务列表（GFM）：- [x] 已完成 / - [ ] 待办
// AI 很爱用这种格式输出待办清单
md.use(taskLists, { label: false, labelAfter: false })

/**
 * 数学公式渲染（KaTeX）
 *
 * 分隔符同时开了两套：
 *   - brackets: \(...\) 行内、\[...\] 块级 —— 大模型最常用的写法
 *   - dollars:  $...$ 行内、$$...$$ 块级 —— 人工编辑和部分模型会用
 * 混着开的好处是模型爱用哪种都能渲染，不用去改后端的 system prompt。
 *
 * engine 传的是占位实现：下面的 renderer 规则全部被我们覆盖了，
 * texmath 自己的渲染路径根本不会被调用（也就不会真的去 require katex）。
 */
md.use(texmath, {
  engine: {
    renderToString: (tex) => `<span class="math-pending" data-display="0">${md.utils.escapeHtml(tex)}</span>`,
  },
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
 * 删除线 ~~文字~~
 *
 * markdown-it 核心只实现 CommonMark，GFM 的删除线要额外插件，
 * 而官方插件 markdown-it-strikethrough 已经在 npm 上 404 下架了，所以手写一条规则。
 *
 * 行为对齐 GFM：
 *   - 只认成对的 ~~；单个 ~ 不处理（中文里 ~ 用得多，容易误伤成删除线）
 *   - 内容不能为空（~~~~ 不算删除线）
 *   - 不能跨段落
 *
 * 插在 emphasis 前面：GFM 里 ~~ 的优先级和 * / _ 一样高，
 * 这样 ~~**加粗**~~ 里的加粗也能正常解析。
 */
md.inline.ruler.before('emphasis', 'strikethrough', (state, silent) => {
  const src = state.src
  const start = state.pos
  // 0x7e = '~'
  if (src.charCodeAt(start) !== 0x7e || src.charCodeAt(start + 1) !== 0x7e) return false

  // 找配对的 ~~（不能跨段落）
  let pos = start + 2
  let end = -1
  while (pos < state.posMax) {
    const ch = src.charCodeAt(pos)
    // 0x0a = '\n'，遇到空行说明跨段落了
    if (ch === 0x0a && src.charCodeAt(pos + 1) === 0x0a) return false
    if (ch === 0x7e && src.charCodeAt(pos + 1) === 0x7e) {
      end = pos
      break
    }
    pos++
  }
  // 没找到配对的，或者内容是空的（~~~~），都当普通文本
  if (end < 0 || end === start + 2) return false
  if (silent) return true

  const open = state.push('s_open', 's', 1)
  open.markup = '~~'

  // 内容还要继续按行内语法解析，这样 ~~**加粗**~~ 里的加粗才生效
  const inner = []
  state.md.inline.parse(src.slice(start + 2, end), state.md, state.env, inner)
  for (const token of inner) state.tokens.push(token)

  const close = state.push('s_close', 's', -1)
  close.markup = '~~'

  state.pos = end + 2
  return true
})

md.renderer.rules.s_open = () => '<del>'
md.renderer.rules.s_close = () => '</del>'

/**
 * 公式占位符
 *
 * 同步段先吐出 <span class="math-pending" data-display="0">转义后的TeX</span>，
 * 异步段再把它换成 KaTeX 的 HTML。
 * TeX 放在标签的文本内容里（而不是 data 属性），省掉一层属性转义的坑。
 */
const mathPlaceholder = (tex, displayMode) =>
  `<span class="math-pending" data-display="${displayMode ? 1 : 0}">${md.utils.escapeHtml(tex)}</span>`

// 覆盖 texmath 默认的 <section><eqn> 模板，换成自己的占位符
md.renderer.rules.math_inline = (tokens, idx) => mathPlaceholder(tokens[idx].content, false)
md.renderer.rules.math_inline_double = (tokens, idx) => mathPlaceholder(tokens[idx].content, true)
md.renderer.rules.math_block = (tokens, idx) => mathPlaceholder(tokens[idx].content, true)
md.renderer.rules.math_block_eqno = (tokens, idx) => mathPlaceholder(tokens[idx].content, true)

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

/** 语言名只允许这些字符，免得拼到 class 里出问题 */
const sanitizeLang = (lang) => lang.replace(/[^a-zA-Z0-9_+#.-]/g, '')

/** 闭合围栏长什么样：整行只有同一种围栏字符，至少 3 个 */
const FENCE_MARKER_RE = /^(`{3,}|~{3,})$/

/**
 * 判断代码块的围栏（``` / ~~~）闭合了没有
 *
 * 背景：流式输出时，模型正在写的代码块往往还没收到收尾的 ```。
 * markdown-it 遇到没闭合的围栏，会照样把它解析成一个 fence token
 * （内容就是「到目前为止写到的部分」）。
 * 对普通代码块无所谓 —— 反正面板里显示的就是半截代码。
 * 但对 mermaid 来说，半截的源码**必然**解析失败：
 *   每个流式分片都会重新渲染整条消息 → 每个分片都去解析一次半截的流程图
 *   → 每个分片都失败一次 → （在没开 suppressErrorRendering 时）每个分片
 *     都会在 body 里留下一个「Syntax error in text」的报错图。
 *   一次回答攒出上百个报错图，就是这么来的。
 *
 * 所以这里要提前判断「围栏闭合了没有」，没闭合就别让异步段去解析。
 *
 * 实现：照着 markdown-it 自己判定围栏闭合的逻辑去源文本里找收尾围栏 ——
 * 从围栏所在行往下找第一个「整行只有同种围栏字符、且长度不短于开围栏」的行。
 *
 * 两种情况一律当作「已闭合」（保守，判错的后果只是多解析几次，不会出错图）：
 *   1. 拿不到源文本（比如测试里直接 md.render() 没传 env）
 *   2. 围栏嵌在引用 / 列表里（level > 0）—— 那些行前面有 > 或缩进，
 *      按行首匹配容易判错
 *
 * @param {object} token markdown-it 的 fence token
 * @param {string} src   传给 md.render() 的原文
 * @returns {boolean}
 */
const isFenceClosed = (token, src) => {
  if (!src) return true
  if (!token || typeof token.map?.[0] !== 'number') return true
  // 嵌在引用 / 列表里的围栏：行首有 > 或缩进，判断容易出错，保守处理
  if (token.level > 0) return true

  const markup = token.markup || '```'
  const char = markup[0]
  // markdown-it 会先把 \r\n 统一成 \n，行号才对得上
  const lines = src.replace(/\r\n?|\n/g, '\n').split('\n')

  for (let i = token.map[0] + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line[0] !== char) continue
    if (!FENCE_MARKER_RE.test(line)) continue
    // 收尾围栏不能比开围栏短
    if (line.length < markup.length) continue
    return true
  }
  return false
}

/**
 * 代码块渲染：套一层 .code-block 容器，左上角标出语言，右上角放复制按钮
 * 默认 fence 渲染只输出 <pre><code class="language-x">，语言信息没有可视化位置
 *
 * 高亮交给异步段：这里先输出转义好的原文，异步段拿到 highlight.js 再着色。
 */
md.renderer.rules.fence = (tokens, idx, options, env) => {
  const token = tokens[idx]
  const info = (token.info || '').trim()
  const lang = sanitizeLang(info ? info.split(/\s+/)[0] : '')
  const content = token.content

  // ```math / ```latex / ```tex —— 模型的公式有时会用代码块包着，直接当公式渲染
  if (['math', 'latex', 'tex'].includes(lang.toLowerCase())) {
    return mathPlaceholder(content, true)
  }

  // ```mermaid —— 流程图，交给异步段用 mermaid 渲染
  if (lang.toLowerCase() === 'mermaid') {
    // data-closed：围栏闭合了没有。流式输出时流程图往往还没写完，
    // 没闭合的源码必然解析失败，异步段会直接跳过（见 isFenceClosed 的说明）
    const closed = isFenceClosed(token, env?.src)
    return `<div class="mermaid-pending" data-closed="${closed ? '1' : '0'}"><pre class="mermaid-source">${md.utils.escapeHtml(content)}</pre></div>`
  }

  const escaped = md.utils.escapeHtml(content)
  const label = lang ? `<span class="code-lang">${md.utils.escapeHtml(lang)}</span>` : ''
  const cls = lang ? ` class="language-${lang}"` : ''
  // data-hl="1"：告诉异步段「这段还没高亮」
  const hlMark = lang ? ' data-hl="1"' : ''
  // 复制按钮：内容不放在 data 属性里，点击时从 <code> 的 textContent 取，避免转义踩坑
  return `<div class="code-block">${label}<button type="button" class="code-copy" title="复制代码">复制</button><pre><code${cls}${hlMark}>${escaped}</code></pre></div>`
}

/**
 * 需要保护、不做「中英文补空格」的内容：代码块、行内代码、数学公式
 *
 * 数学公式尤其重要：LaTeX 里空格是有意义的，
 * \frac{1}{2} 被插成 \frac{1 }{ 2} 就直接渲染错了。
 * 顺序有讲究：$$...$$ 必须排在 $...$ 前面，否则块级公式会被行内规则先吃掉。
 *
 * ⚠️ 第二个分支（^```[\s\S]*）是给**没闭合**的代码块兜底的：
 *   流式输出时模型正在写的代码块还没收到收尾的 ```，
 *   这时候它也是代码（里面的空格同样有意义），不能被规范化规则改。
 *   加上行首锚点（配合 m 标志）是刻意的：只有「行首的 ```」才算围栏，
 *   行文中顺带写出来的 ``` 不会把后面整段都保护掉。
 */
const PROTECT_RE = /(```[\s\S]*?```|^```[\s\S]*|`[^`\n]+`|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$\n]*\$)/gm

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
 *   后端改成 JSON 信封（见 utils/sse.js）之后，这几条规则就成了冗余，
 *   但仍然留着当兜底：后端没更新时，前端自己也能把大部分格式救回来。
 *
 *   代价是「猜」：前端只知道「这里没有空格」，不知道「本来有没有空格」。
 *   所以每条规则都必须排除掉「本来就没空格」的合法写法，
 *   否则会把正常内容改坏（下面每条规则后面的注释都写了各自排除什么）。
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
  //
  // ⚠️ 后面紧跟 - / + / = / 数字时**不能补**：
  //   ---      是水平线,补成 "- --" 侥幸还是水平线,但
  //   标题\n---  是 Setext 二级标题,补成 "- --" 就把标题拆成了「段落 + 水平线」
  //   - 5      是「负五度」不是列表项
  //   后面是空白说明空格本来就在,不用补
  s = s.replace(/^(\s*)([-+])(?![-+=\d\s])/gm, '$1$2 ')

  // 行首 * 列表项后补空格:*xxx → * xxx
  //
  // ⚠️ 两个坑：
  //   1. 后面是 * 时不能补,否则 **加粗** 的开标记会被误判成列表项
  //   2. 这一行里**还有别的 \*** 时多半是斜体的收尾标记(*斜体*),
  //      补了空格会把整段变成列表项,斜体也没了
  s = s.replace(/^(\s*)\*(?![*\s])(?![^\n]*\*)/gm, '$1* ')

  // 行首有序列表后补空格:1.xxx → 1. xxx
  //
  // ⚠️ 只补 1~2 位数的编号：
  //   2024.年发生了很多事   三位以上多半是年份,补了空格会被当成有序列表
  //   1.5 秒              小数点后面是数字,是小数不是列表
  s = s.replace(/^(\s*)(\d{1,2}\.)(?![0-9\s])/gm, '$1$2 ')

  // 中英文之间补空格(仅在缺失时补,已有空格的不受影响)
  s = s.replace(/([一-龥])([A-Za-z0-9])/g, '$1 $2')
  s = s.replace(/([A-Za-z0-9])([一-龥])/g, '$1 $2')

  return s
}

/* ------------------------------------------------------------------
   异步段：把占位符换成真正内容
   ------------------------------------------------------------------ */

/** KaTeX 加载 Promise（只加载一次） */
let katexPromise = null
const loadKatex = async () => {
  if (!katexPromise) {
    // CSS 也一起动态引入：公式没出现时连 KaTeX 的样式表都不用下载
    katexPromise = Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(
      ([mod]) => mod.default ?? mod
    )
  }
  return katexPromise
}

/** highlight.js 加载 Promise（只加载一次） */
let hljsPromise = null
const loadHljs = async () => {
  if (!hljsPromise) {
    hljsPromise = import('./highlight.js').then((mod) => mod.default)
  }
  return hljsPromise
}

/** mermaid 的加载在 utils/mermaid.js 内部完成（它自己动态 import 'mermaid' 包），
    这里只需要拿到渲染函数即可 —— 我们的封装本身只有几 KB，静态引入不影响首屏体积。 */

/** KaTeX 渲染结果缓存：流式输出时同一条消息的公式会被反复渲染 */
const katexCache = new Map()
const KATEX_CACHE_MAX = 300

const MATH_PLACEHOLDER_RE = /<span class="math-pending" data-display="([01])">([\s\S]*?)<\/span>/g
const CODE_PLACEHOLDER_RE = /<code class="language-([^"]*)" data-hl="1">([\s\S]*?)<\/code>/g
// 捕获组 1 = 围栏是否闭合（1 闭合 / 0 没闭合），捕获组 2 = 转义后的源码
const MERMAID_PLACEHOLDER_RE =
  /<div class="mermaid-pending" data-closed="([01])"><pre class="mermaid-source">([\s\S]*?)<\/pre><\/div>/g

/** 把公式占位符换成 KaTeX 的 HTML */
const substituteMath = (html, katex) =>
  html.replace(MATH_PLACEHOLDER_RE, (_m, display, tex) => {
    const source = md.utils.unescapeAll(tex)
    const key = `${display}:${source}`
    const cached = katexCache.get(key)
    if (cached !== undefined) return cached

    let out
    try {
      // throwOnError: false —— 流式输出时公式往往是"半截"的，
      // 比如只收到 \lim_{x\to，让它抛异常会把整条消息渲染挂掉。
      // 关掉之后 KaTeX 会把这段渲染成红色错误提示，等后续分片补齐就自动正常了。
      out = katex.renderToString(source, { throwOnError: false, displayMode: display === '1' })
    } catch (e) {
      out = `<span class="math-error">${md.utils.escapeHtml(source)}</span>`
    }

    if (katexCache.size >= KATEX_CACHE_MAX) katexCache.clear()
    katexCache.set(key, out)
    return out
  })

/** 把代码占位符换成高亮后的 HTML */
const substituteCode = (html, hljs) =>
  html.replace(CODE_PLACEHOLDER_RE, (_m, lang, code) => {
    const source = md.utils.unescapeAll(code)
    const fallback = `<code class="language-${lang}">${md.utils.escapeHtml(source)}</code>`
    // 不认识的语言就原样输出（不报错、不高亮）
    if (!lang || !hljs.getLanguage(lang)) return fallback
    try {
      return `<code class="language-${lang}">${hljs.highlight(source, { language: lang, ignoreIllegals: true }).value}</code>`
    } catch (e) {
      return fallback
    }
  })

/** 把流程图占位符换成 SVG；渲染失败就退回代码块显示 */
const substituteMermaid = async (html, renderSvg) => {
  const matches = [...html.matchAll(MERMAID_PLACEHOLDER_RE)]
  if (!matches.length) return html

  // ⚠️ 这里必须**逐个占位符**渲染，不能按源码去重。
  // SVG 内部有 id="xxx" / url(#xxx) / #xxx 这些引用，
  // 同一张图在一条消息里出现两次却共用一份 SVG，id 就会重复，
  // 两张图会互相串（箭头指向错位、defs 被抢）。
  // 性能不用担心：mermaid.js 内部有源码缓存，第二次直接复用 SVG 只换 id。
  const rendered = []
  for (const m of matches) {
    const closed = m[1] === '1'
    const escaped = m[2]

    // 围栏还没闭合 → 源码是半截的，解析必然失败，连试都不用试。
    // 流式输出时这条分支命中率极高（一个流程图几十个分片），
    // 每次都去解析 = 白白浪费 CPU，还会刷一堆 mermaid 的报错日志。
    if (!closed) {
      rendered.push(null)
      continue
    }

    const source = md.utils.unescapeAll(escaped)
    // 第一行都不是图类型 → 压根不是 mermaid，别浪费一次 parse，
    // 直接按代码块显示（模型偶尔会在 mermaid 块里写别的东西）
    if (!looksLikeMermaid(source)) {
      rendered.push(null)
      continue
    }
    try {
      rendered.push(await renderSvg(source))
    } catch (e) {
      // 渲染失败（源码写错了，或者 mermaid 自己出 bug）
      // → 保留代码块样子，别把整条消息渲染搞挂
      rendered.push(null)
    }
  }

  let index = 0
  return html.replace(MERMAID_PLACEHOLDER_RE, (_m, _closed, escaped) => {
    const svg = rendered[index++]
    if (svg) return `<div class="mermaid-diagram">${svg}</div>`
    return `<div class="mermaid-fallback"><pre class="mermaid-source">${escaped}</pre></div>`
  })
}

/**
 * 渲染 Markdown 内容（异步）
 *
 * @param {string} content 原始 Markdown 文本（可能是流式输出的半截内容）
 * @returns {Promise<string>} HTML 字符串
 */
export async function renderMarkdown(content) {
  const normalized = normalizeText(content)
  // 把原文带进 env：渲染规则要靠它判断「代码块的围栏闭合了没有」
  // （流式输出时流程图往往还没写完，没闭合的源码解析必然失败）
  let html = md.render(normalized, { src: normalized })

  // 公式
  if (html.includes('math-pending')) {
    const katex = await loadKatex()
    html = substituteMath(html, katex)
  }

  // 代码高亮
  if (html.includes('data-hl="1"')) {
    const hljs = await loadHljs()
    html = substituteCode(html, hljs)
  }

  // 流程图
  if (html.includes('mermaid-pending')) {
    html = await substituteMermaid(html, renderMermaidSvg)
  }

  return html
}
