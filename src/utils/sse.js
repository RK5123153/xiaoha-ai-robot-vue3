/**
 * SSE 传输层 —— 基于微软的 `@microsoft/fetch-event-source`
 *
 * ── 为什么用库,而不是自己拆帧 ────────────────────────────────────────
 *
 * 教程里推荐这个库,推荐得对:
 *   · SSE 的帧格式是**规范**(event/data/id/retry 字段、多行 data、注释行、
 *     「冒号后只剥一个空格」……),自己实现一遍是把自己绑在规范细节上;
 *   · 库是微软维护的,规范变了他们跟着改;
 *   · 解析是字节级扫描(subarray,不拷贝),比「字符串缓冲区 + 拼字符串」省分配。
 *
 * ⚠️ 但**不能直接用** —— 这个库有两条默认行为对 POST 是灾难性的:
 *
 *   1. `openWhenHidden` 默认 false:它监听 visibilitychange,
 *      标签页一被藏起来就 abort,切回来时**重新 POST 一次**。
 *      GET 叫「断线重连」,POST 叫「同一条提问被后端收了两遍」。
 *   2. `onerror` 默认不抛异常时会**无限重连** —— 每重连一次就是重发一次。
 *
 * 所以这个文件是**一层壳**:把库的旋钮拧到适合 POST 的位置,
 * 再补上这个项目要的三样东西(空闲超时 / 后端错误原因 / 取消的语义),
 * 页面和接口层**只跟这一层打交道**,永远不直接调 fetchEventSource。
 *
 * ── 这一层加的三样东西(库里没有)────────────────────────────────────
 *
 *   1. **空闲超时**:后端**不发心跳**(思考阶段一个字节都不发),
 *      连接真死了和「模型在想」从外面看一模一样 → 3 分钟没等到完整帧就掐断。
 *   2. **后端的失败原因**:库默认的 onopen 只看 content-type,
 *      后端那句「provider 'bailian' 没有配置 API key」会被吃掉;
 *      这里把 JSON 错误体里的 message 挖出来原样抛出去。
 *   3. **取消的语义**:库收到 abort 是**正常 resolve**(不算错),
 *      上层分不出「用户主动停了」和「流正常结束」→ 这里把它还原成 AbortError。
 *
 * ── 为什么还留着「JSON 信封」那套 ───────────────────────────────────
 *
 * SSE 规范里 data 的值如果以一个空格开头,这个空格会被**浏览器**剥掉。
 * 后端改成「前置一个空格」只能救**单行**分片,多行分片续行照样少一个空格 ——
 * 缩进被吃掉,代码块就散了,而且前端修不了(空格已经没了)。
 * 把内容包进 JSON 就彻底绕开:data 值以 `{` 开头,没有空格可剥,
 * 而且 JSON 会把换行转义成 \n,一个分片永远只占一行。
 * → 后端用 JSON 信封,前端用 {@link parseChunkPayload} 拆信封(两种格式都认,
 *   前后端谁先上线都行)。
 */

import { fetchEventSource } from '@microsoft/fetch-event-source'
import { combineSignals, readErrorMessage } from '@/api/base.js'

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
 * 发一个 SSE 请求,逐帧回调
 *
 * @param {object} params
 * @param {string} params.url 要请求的地址
 * @param {string} [params.method] 默认 POST(这个项目两条链路都是 POST)
 * @param {object} [params.headers] 请求头
 * @param {string|FormData} [params.body] 请求体
 * @param {AbortSignal} [params.signal] 调用方的取消信号(用户切会话/点停止)
 * @param {(frame: {event: string, data: string}) => void} params.onFrame 每帧回调
 * @param {number} [params.idleTimeout] 空闲多久算断了;0 = 不限
 * @returns {Promise<void>} 流结束(或出错)才 resolve/reject
 * @throws {Error} 失败时抛;message 是能直接展示给人看的中文原因
 */
export const streamSse = async ({
  url,
  method = 'POST',
  headers = {},
  body,
  signal,
  onFrame,
  idleTimeout = DEFAULT_IDLE_TIMEOUT,
}) => {
  // 自己的控制器:空闲超时用它掐断(调用方的 signal 是另一回事,下面合起来)
  const timeoutController = new AbortController()
  let timedOut = false

  /**
   * 空闲看门狗
   *
   * <p>每来一帧就重新计时 —— 「多久没有**完整的一帧**」才是用户体感上的等待。
   */
  let timer = null
  const arm = () => {
    if (!idleTimeout) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      timedOut = true
      timeoutController.abort()
    }, idleTimeout)
  }

  // 调用方的取消 + 我们的超时,合成一个信号交给库
  const combined = combineSignals(timeoutController.signal, signal)

  try {
    arm()
    await fetchEventSource(url, {
      method,
      headers: {
        // ⚠️ **故意不写** `Accept: text/event-stream`
        //
        // 库会自己塞一个 `Accept: text/event-stream`(源码:`if (!headers.accept) headers.accept = ...`),
        // 那个头去不掉。我们用 `*/*` 顶掉它 ——
        // 后端看到的 Accept 是「什么都行」,和「完全不发这个头」是同一个意思。
        // (实测:带 `*/*` 时后端 503 的 JSON 错误体和完全不带 Accept 一模一样。)
        //
        // 为什么要在意这个头:老后端在 `Accept: text/event-stream` 下返回 503 会给**空 body**,
        // 失败原因就看不见了(见 api/conversation.js 的注释)。
        accept: '*/*',
        ...headers,
      },
      body,
      signal: combined,

      // ⚠️⚠️ **必须**开着:关掉的话,标签页一被藏起来库就 abort 掉请求,
      //    切回来时**重新 POST 一次** —— 同一条提问被后端收两遍,记忆里多一轮。
      openWhenHidden: true,

      /**
       * 连接建立后、开始读流之前
       *
       * <p>⚠️ 库默认的 onopen 只看 content-type,不是 text/event-stream 就抛一句英文,
       *    后端真正的原因(「provider 没配 API key」)会被吃掉 —— 这里自己挖。
       */
      onopen: async (res) => {
        if (!res.ok) {
          const err = new Error(await readErrorMessage(res))
          // 标记一下:这是「后端给的原因」,别被翻译成「网络连接失败」
          err.kind = 'http'
          throw err
        }
        const ct = (res.headers.get('content-type') || '').toLowerCase()
        // ⚠️ 不是流的话,帧解析器会「安静地」一帧都读不出来 ——
        //    用户只看到「模型这次没返回内容」,真相是网关返回了一张 HTML 错误页。
        if (ct && !ct.includes('text/event-stream')) {
          const err = new Error(`后端返回的不是流式响应（${ct}），多半是网关或代理出错了`)
          err.kind = 'http'
          throw err
        }
      },

      /**
       * 每来一帧
       *
       * <p>⚠️ 库里无名帧的事件类型是**空串** `''`,而 SSE 规范是 `message` ——
       *    这里统一成 `message`,页面那边就不用管这个差别了。
       */
      onmessage: (msg) => {
        arm()
        onFrame?.({ event: msg.event || 'message', data: msg.data })
      },

      onclose: () => {},

      /**
       * 出错
       *
       * <p>⚠️ **必须抛出去**:不抛的话库会按 retry 间隔无限重连 ——
       *    对 POST 来说,每次重连就是**把同一条提问重发一遍**。
       */
      onerror: (err) => {
        throw err
      },
    })

    // 走到这儿说明是「正常结束」或者「被 abort 了」
    if (timedOut) throw new Error('连接超时，模型长时间没有回应')
    if (signal?.aborted) {
      // ⚠️ 库收到 abort 是**正常 resolve**,不算错 —— 上层靠这个区分「用户主动停了」
      //    和「流正常结束」,这里把它还原成 AbortError。
      const err = new Error('已取消')
      err.name = 'AbortError'
      throw err
    }
  } catch (e) {
    // 用户自己掐断的(切会话/点停止)—— 原样抛出去,上层认 e.name
    if (e.name === 'AbortError') throw e
    // 空闲超时有专门的人话文案,别再翻译
    if (timedOut) throw new Error('连接超时，模型长时间没有回应')
    // 后端给的原因(403/503 + JSON 错误体)—— 原样透出,别盖掉
    if (e.kind === 'http') throw e
    // 网络层面的失败(后端没起、端口不通、跨域被拒)
    if (isNetworkError(e)) {
      throw new Error('网络连接失败，请检查后端服务是否在运行')
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 是不是「网络层面的失败」
 *
 * <p>各家浏览器的说法不一样:
 *   Chrome/Edge:「Failed to fetch」(TypeError)
 *   Firefox:「NetworkError when attempting to fetch resource.」
 *   Safari:「Load failed」
 * 判断不出来的时候宁可**不翻译** —— 显示原始错误比显示一句不对的话好。
 *
 * @param {any} e
 * @returns {boolean}
 */
const isNetworkError = (e) => {
  if (!e) return false
  const msg = String(e.message || '')
  return (
    e instanceof TypeError ||
    /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(msg)
  )
}

/**
 * 信封的识别:必须是 {"v": 开头
 *
 * <p>为什么不直接 JSON.parse 所有分片?
 *   1. 快路径 —— 绝大多数分片不是 JSON,省一次 try/catch
 *   2. 旧格式的模型正文里可能**本身就是**一段 JSON(比如用户问「给我一段 JSON」),
 *      那种情况下必须原样显示,不能被当成信封拆开
 */
const ENVELOPE_HEAD = /^\{\s*"v"\s*:/

/**
 * 解析一个 SSE 分片的负载
 *
 * @param {string} raw event.data 的原始内容
 * @returns {string} 分片正文;空输入返回空字符串
 */
export const parseChunkPayload = (raw) => {
  if (typeof raw !== 'string' || raw === '') return ''
  // 旧格式(后端还没改成 JSON 信封):原样返回
  if (!ENVELOPE_HEAD.test(raw)) return raw

  try {
    const parsed = JSON.parse(raw)
    // 只要有字符串类型的 v 字段就当信封拆开 —— 不要求「只有 v 一个键」。
    // 后端以后给信封加字段(seq / type / done)时,前端不用跟着改。
    // 代价是模型正文正好写成 {"v":...} 时会被拆开,但那种情况很罕见。
    if (parsed && typeof parsed.v === 'string') return parsed.v
  } catch {
    // 不是合法 JSON(半截分片、被截断的信封)→ 退回旧格式的处理方式
  }
  return raw
}
