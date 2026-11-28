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
 * 再补上这个项目要的四样东西(空闲超时 / 后端错误原因 / 取消的语义 / 断在哪),
 * 页面和接口层**只跟这一层打交道**,永远不直接调 fetchEventSource。
 *
 * ── 这一层加的四样东西(库里没有)────────────────────────────────────
 *
 *   1. **空闲超时**:后端**不发心跳**(思考阶段一个字节都不发),
 *      连接真死了和「模型在想」从外面看一模一样 → 太久没等到完整帧就掐断。
 *      ⚠️ 但**页面藏起来时不按墙上时钟判超时**(见下面的 HIDDEN_IDLE_TIMEOUT)。
 *   2. **后端的失败原因**:库默认的 onopen 只看 content-type,
 *      后端那句「provider 'bailian' 没有配置 API key」会被吃掉;
 *      这里把 JSON 错误体里的 message 挖出来原样抛出去。
 *   3. **取消的语义**:库收到 abort 是**正常 resolve**(不算错),
 *      上层分不出「用户主动停了」和「流正常结束」→ 这里把它还原成 AbortError。
 *   4. **「线是在哪儿断的」**:页面在后台时浏览器会回收长连接,
 *      这跟「后端没起来」是两回事 —— 后者让用户去重启后端,后者重启一点用没有。
 *      这里把两者分开,给出对得上的原因。
 *
 * ── 后端心跳(event: ping)──────────────────────────────────────────
 *
 * 后端**目前还没发**心跳;这一层已经先认了它:收到就在传输层消化掉
 * (证明「线还通着」,顺便把空闲上限收紧到 60 秒),**不往上层传** ——
 * 页面不需要知道有这东西,传上去还得每个页面都写一遍「忽略 ping」。
 * 后端哪天加上了,前端不用改。
 *
 * ── 为什么还留着「JSON 信封」那套 ───────────────────────────────────
 *
 * SSE 规范里 data 的值如果以一个空格开头,这个空格会被**浏览器**剥掉。
 * 后端改成「前置一个空格」只能救**单行**分片,多行分片续行照样少一个空格 ——
 * 缩进被吃掉,代码块就散了,而且前端修不了(空格已经没了)。
 * 把内容包进 JSON 就彻底绕开:data 值以 `{` 开头,没有空格可剥,
 * 而且 JSON 会把换行转义成 \n,一个分片永远只占一行。
 * → 拆信封的 {@link parseChunkPayload} 和**事件协议**一起放在
 *   {@code utils/stream-events.js}(那一层管「帧是什么意思」,本层只管「字节怎么变成帧」)。
 */

import { fetchEventSource } from '@microsoft/fetch-event-source'
import { combineSignals, readErrorMessage } from '@/api/base.js'

/**
 * 空闲多久算「流断了」(ms)—— 页面**可见**时
 *
 * <p>⚠️ 为什么给得这么宽(5 分钟):
 *   <ul>
 *     <li>后端**没有心跳机制** —— 思考阶段它一个字节都不发(只有具名事件),
 *         所以模型「想得久」和「连接死了」从外面看是一样的:什么都不来。</li>
 *     <li>后端的模型超时是 240 秒(app.models.*.timeout-seconds),
 *         整条流的总时限是 300 秒(app.sse.timeout-ms)。
 *         <b>前端不能比后端先放弃</b> —— 早于 300 秒掐流,
 *         等于把后端本来还能答出来的请求砍掉,用户白等一场、答案还丢了。</li>
 *   </ul>
 *   所以这里取 300 秒:和后端的总时限一样长,后端先收尾,前端只是兜底。
 */
const DEFAULT_IDLE_TIMEOUT = 300000

/**
 * 页面**看不见**时的空闲上限(ms)
 *
 * <p>⚠️ 这是教程(《联网搜索 Bug 修复:连接断开问题》)漏掉的另一半:
 *   教程给的 {@code openWhenHidden: true} 只解决了「库自己主动 abort」这一半 ——
 *   另一半是**我们自己这个空闲看门狗**:它按墙上时钟算,页面切到后台 3 分钟
 *   照样掐流。而那 3 分钟里模型可能正在联网搜索 / 等工具(后端一个字节都不发),
 *   掐了它,用户切回来看到的就是半截答案 —— 正是教程里说的
 *   「勾选联网搜索时切到别的界面,就答不出来」。
 *
 * <p>页面藏着的时候用户根本看不见「转圈」,按墙上钟判超时对谁都没意义。
 * 但**也不能真的放到无限**:dev 的 vite 代理会把「上游连接被重置」吞掉
 * (浏览器那边表现为一直挂着、不报错),真死了一条线就永远挂着,用户切回来只看到一个
 * 转圈的空气泡。所以给一个**比后端总时限(app.sse.timeout-ms = 5 分钟)还宽**的兜底:
 *   <ul>
 *     <li>比后端宽 → 绝不会掐掉一条后端本来还能答完的流;</li>
 *     <li>不是无限 → 万一有连接真的楔住了,10 分钟后也会收场。</li>
 *   </ul>
 */
const HIDDEN_IDLE_TIMEOUT = 600000

/**
 * 见过后端心跳之后的空闲上限(ms)
 *
 * <p>后端发心跳(event: ping)说明「线还通着」—— 那之后长时间没动静就真的是断了,
 * 可以用短得多的上限,用户不用干等 5 分钟才发现连接死了。
 * 没见过心跳(老后端)就还按 {@link DEFAULT_IDLE_TIMEOUT} 兜底,别误杀慢请求。
 */
const HEARTBEAT_IDLE_TIMEOUT = 60000

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
   * 页面在**看不见**的时候,线断过没有?
   *
   * <p>用来分清两种同样表现为「Failed to fetch」的失败:
   *   <ul>
   *     <li>线是在页面藏着的时候断的 → 几乎都是**浏览器回收了后台的长连接**
   *         (切到别的程序、系统休眠、换网络都会)→ 让用户去重启后端是白折腾;</li>
   *     <li>线是在用户眼皮底下断的 → 那才可能是后端真的挂了。</li>
   *   </ul>
   */
  let hiddenDuringStream = false

  /** 见过后端心跳没有 —— 见过就说明「线还通着」这件事是可证的 */
  let sawHeartbeat = false

  /**
   * 空闲看门狗
   *
   * <p>每来一帧就重新计时 —— 「多久没有**完整的一帧**」才是用户体感上的等待。
   *
   * <p>⚠️ 上限是**跟着页面可见性走的**(见 {@link HIDDEN_IDLE_TIMEOUT}):
   *    页面藏着的时候不掐流,切回来了再重新计时。
   */
  let timer = null

  /** 这一刻生效的空闲上限 */
  const currentIdleLimit = () => {
    // 调用方显式关掉了超时(idleTimeout = 0)→ 就别自作主张加回来
    if (!idleTimeout) return 0
    if (isHidden()) return HIDDEN_IDLE_TIMEOUT
    // 见过心跳 → 空这么久就是真的断了,不用让用户干等
    if (sawHeartbeat) return Math.min(idleTimeout, HEARTBEAT_IDLE_TIMEOUT)
    return idleTimeout
  }

  const arm = () => {
    clearTimeout(timer)
    timer = null
    const limit = currentIdleLimit()
    if (!limit) return
    timer = setTimeout(() => {
      timedOut = true
      timeoutController.abort()
    }, limit)
  }

  /**
   * 页面可见性变了 → 换一套空闲上限,重新计时
   *
   * <p>切回前台时重新计时(而不是接着算隐藏期间的时间):
   *   用户刚回来,页面上的「转圈」应该重新给一段完整的等待时间,
   *   而不是一回来就超时。
   */
  const onVisibilityChange = () => {
    if (isHidden()) hiddenDuringStream = true
    arm()
  }
  document.addEventListener('visibilitychange', onVisibilityChange)

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
      //
      //    ⚠️ 但它只解决「库自己主动断」这一半。另一半是**我们自己的空闲看门狗**
      //    (见 HIDDEN_IDLE_TIMEOUT)—— 页面切到后台时它照样会按墙上时钟掐流,
      //    那才是教程里「联网搜索时切到别的界面就答不出来」的真正凶手。
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
        // 后端心跳(event: ping):模型沉默时定期发,用来证明「线还通着」。
        // ⚠️ 只在传输层消化,**不往上层传** —— 页面不需要知道有这东西,
        //    传上去还得每个页面都写一遍「忽略 ping」,漏一个就多一个空分支。
        if (msg.event === 'ping') {
          sawHeartbeat = true
          arm()
          return
        }
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
    //
    // ⚠️ 顺序:先看「用户主动取消」,再看「超时」——
    //    两个同时发生时(用户点停止的那一刻正好到点),用户的意思更该听用户的。
    if (signal?.aborted) {
      // ⚠️ 库收到 abort 是**正常 resolve**,不算错 —— 上层靠这个区分「用户主动停了」
      //    和「流正常结束」,这里把它还原成 AbortError。
      const err = new Error('已取消')
      err.name = 'AbortError'
      throw err
    }
    if (timedOut) throw new Error('连接超时，模型长时间没有回应')
  } catch (e) {
    // 用户自己掐断的(切会话/点停止)—— 原样抛出去,上层认 e.name
    if (e.name === 'AbortError') throw e
    // 空闲超时有专门的人话文案,别再翻译
    if (timedOut) throw new Error('连接超时，模型长时间没有回应')
    // 后端给的原因(403/503 + JSON 错误体)—— 原样透出,别盖掉
    if (e.kind === 'http') throw e
    // 网络层面的失败(后端没起、端口不通、跨域被拒)
    if (isNetworkError(e)) {
      // ⚠️ **别一股脑甩锅给后端**:线是在页面藏着的时候断的,几乎都是浏览器回收了后台的长连接
      //    (教程里那个场景)。让用户去重启后端一点用没有 —— 后端好好的。
      //    ⚠️ 两个信号都要看:
      //      · isHidden()          —— 此刻页面还藏着(线断的时候人不在);
      //      · hiddenDuringStream  —— 这条流期间页面被藏过(报错是切回来之后才处理到的,
      //        比如页面被浏览器冻结过:冻结期间不跑 JS,连接断了要等解冻才报)。
      if (isHidden() || hiddenDuringStream) {
        const err = new Error(
          '连接在页面切到后台期间被中断（浏览器会回收后台的长时间连接）。切回页面后可以重新发送一次；如果反复出现，请检查后端服务是否在运行'
        )
        err.kind = 'disconnected'
        throw err
      }
      const err = new Error('网络连接失败，请检查后端服务是否在运行')
      err.kind = 'network'
      throw err
    }
    throw e
  } finally {
    clearTimeout(timer)
    // ⚠️ 监听器必须摘掉:一条流一个,聊天页能连开好几条,漏摘就攒一堆死监听器。
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

/**
 * 页面现在是不是看不见
 *
 * <p>用 {@code visibilityState} 而不是 {@code document.hidden}:
 *   后者在老内核里可能是 undefined,判断会一律当成「可见」。
 *
 * @returns {boolean}
 */
const isHidden = () => {
  if (typeof document === 'undefined') return false
  return document.visibilityState === 'hidden'
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
 * 信封的识别和拆包 —— **搬到了 {@code utils/stream-events.js}**
 *
 * <p>⚠️ 为什么搬:「帧是什么意思」是**协议层**的事(正文 / 思考链 / 来源 / 重试 / 错误),
 *    和「字节怎么变成帧」(本文件的传输层)是两件事。放一起的话,协议一改
 *    就要动传输层 —— 而传输层是最不该被业务协议牵着走的地方。
 */

