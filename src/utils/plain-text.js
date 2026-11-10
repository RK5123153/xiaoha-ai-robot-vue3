/**
 * Markdown → 纯文本
 *
 * 用途：语音朗读。把 Markdown 原文直接丢给 TTS 引擎的话，
 * 引擎会把 ```、**、$…$ 一个个念出来（"反引号"、"星号"、"美元符号"），
 * 体验非常差，所以先剥成纯文本再念。
 *
 * 核心手法：**先挖坑再填**。
 * 代码块、行内代码、转义符这三样内容必须**原样保留**，
 * 如果直接对全文做正则，后面的规则会误伤它们：
 *   - 代码块里的 `$x$` 会被当成公式删掉
 *   - `\*不是斜体\*` 里的星号会被当成斜体标记吃掉
 * 所以先把它们替换成一个占位符，处理完别的规则之后再填回去。
 */

/** 常见 HTML 实体 → 字符（模型偶尔会直接输出实体） */
const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
}

/**
 * 把 Markdown 原文转成适合朗读的纯文本
 *
 * @param {string} input Markdown 原文
 * @returns {string} 纯文本
 */
export const toPlainText = (input) => {
  if (!input) return ''
  let text = String(input)

  // ── 存起来的「原样保留」片段，最后填回去 ──
  //
  // 占位符用 NUL 字符包裹：正文里不可能出现这个字符，不会误伤。
  // ⚠️ 这里用 String.fromCharCode(0) 而不是写死的转义序列：
  //    源码里放真实的 NUL 字符，编辑器会把整个文件当成二进制（打不开、diff 全乱）。
  const SENTINEL = String.fromCharCode(0)
  const KEEP_RE = new RegExp(`${SENTINEL}P(\\d+)${SENTINEL}`, 'g')
  const keep = []
  const protect = (content) => {
    keep.push(content)
    return `${SENTINEL}P${keep.length - 1}${SENTINEL}`
  }

  // 1. mermaid 流程图：读不出来（"flowchart TD A 减减 大于 B"），整块丢掉
  //    注意结尾的 (?:```|$) —— 流式输出时围栏可能还没闭合
  text = text.replace(/```mermaid[\s\S]*?(?:```|$)/gi, '\n')

  // 2. 围栏代码块：内容原样保留（围栏标记和语言标签去掉）
  //    没闭合的围栏（流式输出中）：从 ``` 一直吃到结尾
  text = text.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_m, code) => protect(code))
  text = text.replace(/```[^\n]*\n?([\s\S]*)$/g, (_m, code) => protect(code))

  // 3. 行内代码：内容原样保留（只去掉反引号）
  text = text.replace(/`([^`\n]+)`/g, (_m, code) => protect(code))

  // 4. 数学公式：整块丢掉（念 LaTeX 源码没意义）
  //    ⚠️ 必须排在「转义符」那一步**前面**：
  //    \[ x^2 \] 和 \( x \) 里的反斜杠会被转义规则先吃掉，
  //    公式就没法识别了（会漏成 "[ x^2 ]"）。
  //    连左右的空格一起吞掉再补一个空格，免得留下「公式   在这」这种空隙
  //    顺序有讲究：块级（$$…$$ / \[…\]）必须排在行内前面
  text = text.replace(/[ \t]*\$\$[\s\S]*?\$\$[ \t]*/g, ' ')
  text = text.replace(/[ \t]*\\[[\s\S]*?\\][ \t]*/g, ' ')
  text = text.replace(/[ \t]*\\\([\s\S]*?\\\)[ \t]*/g, ' ')
  text = text.replace(/[ \t]*\$[^$\n]*\$[ \t]*/g, ' ')

  // 5. 转义符：\* → *、\_ → _ ……（转义过的字符要原样保留，
  //    否则 \*不是斜体\* 里的星号会被后面的斜体规则吃掉）
  text = text.replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, (_m, ch) => protect(ch))

  // 6. 图片：只留 alt 文本
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')

  // 7. 链接：留链接文字，去掉 URL（念 URL 很难听）
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')

  // 8. 强调 / 删除线：只留文字
  //    粗体斜体必须排在粗体前面，否则 ***xxx*** 会被当成 粗体+残留星号
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
  text = text.replace(/~~([^~]+)~~/g, '$1')
  text = text.replace(/__([^_]+)__/g, '$1')
  // 斜体：前后不能是字母/数字，否则 "a*b*c" 这种会被误伤
  text = text.replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1$2')

  // 9. 标题：去掉 # 号（ATX）
  text = text.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
  // Setext 标题的下划线（Title\n=====）
  text = text.replace(/^[ \t]{0,3}=+[ \t]*$/gm, '')

  // 10. 引用：去掉 >
  text = text.replace(/^[ \t]{0,3}>[ \t]?/gm, '')

  // 11. 列表：去掉列表符号和任务列表标记
  text = text.replace(/^[ \t]{0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+/gm, '')
  text = text.replace(/^[ \t]{0,3}\[[ xX]\][ \t]*/gm, '')

  // 12. 表格：分隔行（|---|---|）整行丢掉，其余把 | 换成空格
  text = text.replace(/^[ \t]{0,3}\|?[ \t]*:?-{1,}:?[ \t]*(\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/gm, '')
  text = text.replace(/\|/g, ' ')

  // 13. 水平线
  text = text.replace(/^[ \t]{0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/gm, '')

  // 14. HTML 实体
  text = text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, entity) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[entity.toLowerCase()] ?? m
  })

  // 15. 把之前挖走的片段填回来
  text = text.replace(KEEP_RE, (_m, i) => keep[Number(i)] ?? '')

  // 16. 合并多余空行（念出来不会有区别，但文本更干净）
  text = text.replace(/[ \t]+$/gm, '')
  text = text.replace(/\n{3,}/g, '\n\n')

  return text.trim()
}
