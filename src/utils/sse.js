/**
 * SSE 分片负载解析
 *
 * ── 为什么要包一层 JSON ─────────────────────────────────────────────
 *
 * SSE 规范里有一条容易踩的规则：data 字段的值如果以一个空格开头，
 * 这个空格会被**浏览器**剥掉。
 *
 * Spring 的 SseEmitter 写出来的是「data:」+ 原文（冒号后面没有空格），
 * 于是原文的第一个空格就成了那个「会被剥掉的空格」：
 *
 *   模型原文      "### 标题"
 *   Spring 写出   data:### 标题
 *   浏览器收到    "### 标题"   ← 空格没了
 *
 * 后果就是教程里那个现象：`### 标题` 被拆成 `###` / ` 标题` 两个分片时，
 * 第二个分片开头的空格被吃掉，拼回来变成 `###标题`，
 * 而 CommonMark 要求 ATX 标题的 `#` 后面必须有空格，
 * 于是标题降级成普通段落 —— 这就是「偶尔部分格式转换不正确」。
 *
 * 后端现在的做法是「前置一个空格」(.data(" " + chunk))，
 * 让那个被剥掉的空格变成我们自己补的那个，模型的空格就保住了。
 * **单行分片确实修好了**，但多行分片修不好：
 * Spring 会把多行内容拆成多个 data 行，而浏览器是**逐行**剥空格的，
 * 于是只有第一行被补偿，续行照样少一个空格：
 *
 *   模型原文      "第一行\n    return x"
 *   Spring 写出   data: 第一行
 *                 data:    return x
 *   浏览器收到    "第一行\n   return x"   ← 缩进少了一个空格
 *
 * 代码块里的缩进被吃掉一个空格，嵌套列表也会被拆散 ——
 * 而且前端**修不了**：空格已经没了，前端无从得知原来有几个。
 *
 * 把内容包进 JSON 就彻底绕开了这个坑：
 *   - data 值以 `{` 开头，没有空格可剥
 *   - JSON 会把换行转义成 \n，一个分片永远只占一行，不会被拆成多个 data 行
 *   - 缩进、空白全部原样保留
 *
 * ── 为什么这里要兼容两种格式 ───────────────────────────────────────
 *
 * 后端改成 JSON 信封、前端改成解析 JSON，这两件事是分开上线的。
 * 如果前端只认 JSON，后端还没更新时整条回复会变成乱码；
 * 如果后端只发 JSON、前端还没更新，用户会看到满屏 {"v":"..."}。
 *
 * 所以这里两种都认：新格式走 JSON.parse，旧格式原样返回。
 * 无论先改前端还是先改后端，页面都是正常的。
 */

/**
 * 信封的识别：必须是 {"v": 开头
 *
 * 为什么不直接 JSON.parse 所有分片？
 *   1. 快路径 —— 绝大多数分片不是 JSON，省一次 try/catch
 *   2. 旧格式的模型正文里可能**本身就是**一段 JSON（比如用户问「给我一段 JSON」），
 *      那种情况下必须原样显示，不能被当成信封拆开
 */
const ENVELOPE_HEAD = /^\{\s*"v"\s*:/

/* ──────────────────────────────────────────────────────────────────────
 * 原始字节流 → SSE 帧
 *
 * 为什么要自己解析:
 *   浏览器的 `EventSource` **只能发 GET** —— 传文件(multipart)必须用 fetch,
 *   而 fetch 拿到的是原始字节流,SSE 的帧结构得自己拆。
 *   /v9/ai 的「上传图片 + 流式回答」走的就是这条路。
 * ────────────────────────────────────────────────────────────────────── */

/**
 * 把一段 SSE 原始文本拆成事件帧
 *
 * 一个事件长这样(Spring 的 SseEmitter 写出来的形式,冒号后**没有**空格):
 *
 *   event:message
 *   data:{"v":"分片原文"}
 *   <空行>
 *
 * @param {string} text 一段完整的 SSE 文本(以空行结尾)
 * @returns {Array<{event: string, data: string}>}
 */
export const parseSseFrames = (text) => {
  const frames = []
  if (!text) return frames

  // 一个事件以「空行」结束。Spring 写的是 \n\n,标准允许 \r\n\r\n
  for (const block of text.split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue

    let event = 'message'
    const dataLines = []

    for (const line of block.split(/\r?\n/)) {
      // 空行、注释行(以冒号开头,后端用它发心跳)
      if (!line || line.startsWith(':')) continue

      const colon = line.indexOf(':')
      const field = colon === -1 ? line : line.slice(0, colon)
      let value = colon === -1 ? '' : line.slice(colon + 1)

      // SSE 规范:冒号后**一个**前导空格要去掉。
      // ⚠️ Spring 写的是 "data:" + 原文(冒号后没有空格),所以这里去掉的那个空格
      //    只可能是协议允许的那一个,不会误伤正文 ——
      //    真正会被吃掉的那个空格早就在浏览器/传输层那一环丢掉了,
      //    后端改用 JSON 信封就是为了绕开它(见本文件开头的说明)。
      if (value.startsWith(' ')) value = value.slice(1)

      if (field === 'event') event = value
      else if (field === 'data') dataLines.push(value)
    }

    // 没有 data 的帧(比如只有 event 名的)没有内容可读,丢掉
    if (dataLines.length) frames.push({ event, data: dataLines.join('\n') })
  }

  return frames
}

/**
 * 空闲多久算「流断了」(ms)
 *
 * <p>⚠️ 为什么给得这么宽(3 分钟):
 *   后端**没有心跳机制** —— 思考阶段它一个字节都不发(只有具名事件)。
 *   所以模型「想得久」和「连接死了」从外面看是一样的:什么都不来。
 *   定得太短会把正常的慢请求掐掉(用户白等一场,答案还丢了),
 *   定得太长又等于没有 —— 3 分钟是「慢到离谱」和「彻底死了」之间的折中。
 */
const DEFAULT_IDLE_TIMEOUT = 180000

/**
 * 读一个分片,带空闲超时
 *
 * <p>⚠️ 用 Promise.race 而不是 AbortSignal:超时是「读这一片读太久」,
 *    不是「取消整个请求」—— 连接本身可能还有救(比如下一个分片就来了)。
 *
 * @param {ReadableStreamDefaultReader} reader
 * @param {number} ms 空闲超时;0 = 不限
 */
const readWithIdleTimeout = async (reader, ms) => {
  if (!ms) return reader.read()
  let timer
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('连接超时,模型长时间没有回应')), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 读干一个 SSE 响应流,逐帧回调
 *
 * ⚠️ 两个容易踩的坑:
 *   1. **UTF-8 字符可能跨分片**:一个汉字是 3 字节,网络分片正好切在中间是常事。
 *      解码必须用 `decode(value, { stream: true })`,否则那半个字会变成乱码。
 *   2. **帧可能跨分片**:`data:` 的内容还没收全就来了下一个分片 ——
 *      所以要按「空行」切,不能按「分片」切。
 *
 * @param {Response} response fetch 的响应(必须是 text/event-stream)
 * @param {(frame: {event: string, data: string}) => void} onFrame 每帧回调
 * @param {object} [options]
 * @param {number} [options.idleTimeout] 空闲多久算断了;0 = 不限
 */
export const readSseStream = async (response, onFrame, { idleTimeout = DEFAULT_IDLE_TIMEOUT } = {}) => {
  if (!response.body) throw new Error('这个浏览器不支持流式读取响应')

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  const drain = (block) => {
    for (const frame of parseSseFrames(block)) onFrame(frame)
  }

  try {
    for (;;) {
      const { done, value } = await readWithIdleTimeout(reader, idleTimeout)
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // 只切「已经收到完整分隔符」的部分,剩下的留在 buffer 里等下一片
      for (;;) {
        const idx = buffer.search(/\r?\n\r?\n/)
        if (idx === -1) break
        const sep = buffer.slice(idx).match(/^\r?\n\r?\n/)[0]
        const block = buffer.slice(0, idx)
        buffer = buffer.slice(idx + sep.length)
        drain(block + sep)
      }
    }

    // 收尾:flush 掉解码器里可能还压着的字节
    buffer += decoder.decode()
    // 后端异常断开时最后一段可能没有空行结尾,别把它丢了
    if (buffer.trim()) drain(buffer)
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* 已经释放了就算了 */
    }
  }
}

/**
 * 解析一个 SSE 分片的负载
 *
 * @param {string} raw event.data 的原始内容
 * @returns {string} 分片正文；空输入返回空字符串
 */
export const parseChunkPayload = (raw) => {
  if (typeof raw !== 'string' || raw === '') return ''
  // 旧格式（后端还没改成 JSON 信封）：原样返回
  if (!ENVELOPE_HEAD.test(raw)) return raw

  try {
    const parsed = JSON.parse(raw)
    // 只要有字符串类型的 v 字段就当信封拆开 —— 不要求「只有 v 一个键」。
    // 后端以后给信封加字段（seq / type / done）时，前端不用跟着改。
    // 代价是模型正文正好写成 {"v":...} 时会被拆开，但那种情况很罕见。
    if (parsed && typeof parsed.v === 'string') return parsed.v
  } catch {
    // 不是合法 JSON（半截分片、被截断的信封）→ 退回旧格式的处理方式
  }
  return raw
}
