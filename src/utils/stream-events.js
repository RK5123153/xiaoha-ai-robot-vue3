/**
 * SSE 事件协议 —— 前端认的事件只有这五种，**认的地方只有这一处**。
 *
 * <p>后端（{@code SseChatSupport}）统一封的协议：
 * <pre>
 *   event: message  → 正文分片，data 是 JSON 信封 {"v":"…"}
 *   event: thinking → 思考链增量，data 同上
 *   event: source   → 联网搜索的来源，data 是 JSON 数组 [{"title":"…","url":"…"}]
 *   event: retry    → 厂商把这一轮挂起了，后端要重发一次，data 是 JSON 信封（中文提示）
 *   event: error    → 这一轮没答出来，data 是 JSON 信封（中文原因）
 * </pre>
 *
 * <p>⚠️ <b>为什么不把分流写在页面里</b>：三个地方都要读这条流
 *    （主聊天页 {@code ChatPage.vue}、智能客服页 {@code CustomerServicePage.vue}、
 *    看图说话 {@code utils/vision.js}），各写一份的话，改一处忘了另一处就会
 *    「有的页面认 {@code retry}、有的不认」—— 而这类不一致**不报错**，
 *    只表现为「有时候自动重试了、有时候没有」，极难排查。
 *    所以协议只有这一份：{@link createStreamCollector} 把它包成一个累加器，
 *    页面只管「把累加器的状态写进气泡」。
 *
 * <p>⚠️ <b>认不出的事件直接忽略</b>：后端以后加新事件，前端不会因此炸掉
 *    （老前端配新后端是常态，不能因为多了一个事件就整页报错）。
 */

import { appendThinking } from './thinking.js'

/** 正文分片 */
export const EV_MESSAGE = 'message'
/** 思考链增量 */
export const EV_THINKING = 'thinking'
/** 联网搜索的来源（标题 + 链接） */
export const EV_SOURCE = 'source'
/** 厂商把这一轮挂起了，后端要重发一次 */
export const EV_RETRY = 'retry'
/** 这一轮没答出来 */
export const EV_ERROR = 'error'

/**
 * 信封的识别：必须是 {"v": 开头
 *
 * <p>为什么不直接 JSON.parse 所有分片？
 *   1. 快路径 —— 绝大多数分片不是 JSON，省一次 try/catch
 *   2. 旧格式的模型正文里可能**本身就是**一段 JSON（比如用户问「给我一段 JSON」），
 *      那种情况下必须原样显示，不能被当成信封拆开
 */
const ENVELOPE_HEAD = /^\{\s*"v"\s*:/

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
    // 后端以后给信封加字段(seq / type / done)时，前端不用跟着改。
    // 代价是模型正文正好写成 {"v":...} 时会被拆开，但那种情况很罕见。
    if (parsed && typeof parsed.v === 'string') return parsed.v
  } catch {
    // 不是合法 JSON（半截分片、被截断的信封）→ 退回旧格式的处理方式
  }
  return raw
}

/**
 * 解析联网搜索的来源列表
 *
 * <p>⚠️ 来源**不走 JSON 信封** —— 后端发的是一个裸数组
 *   （{@code StreamPayload.sources()}），因为它是数组不是一段文本，
 *   前端按 {@code event: source} 单独解析。
 *
 * @param {string} raw event.data 的原始内容
 * @returns {Array<{title: string, url: string}>} 来源列表；解析不出来就是空数组
 */
export const parseSources = (raw) => {
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((s) => s && (s.title || s.url))
      .map((s) => ({
        title: String(s.title || s.url || ''),
        url: String(s.url || ''),
      }))
  } catch {
    // 不是合法 JSON → 当作没有来源(不能因为来源解析失败就把整轮回答搞挂)
    return []
  }
}

/**
 * 建一个流式累加器 —— 把 SSE 的一帧帧累成「这一轮现在是什么样」
 *
 * <p>用法：
 * <pre>
 *   const collector = createStreamCollector()
 *   onFrame: (frame) =&gt; {
 *     collector.push(frame)
 *     target.content = collector.state.text
 *     target.thinking = collector.state.thinking
 *     …
 *   }
 * </pre>
 *
 * @returns {{state: object, push: (frame: {event?: string, data?: string}) =&gt; object}}
 */
export const createStreamCollector = () => {
  /**
   * 累到现在的状态
   *
   * <p>⚠️ 是**普通对象**，不是响应式的 —— 页面把它写进自己的响应式气泡里，
   *    由 Vue 负责更新界面。累加器自己不需要 reactivity。
   */
  const state = {
    /** 正文（累积） */
    text: '',
    /** 思考链（累积，超长由 appendThinking 从前面截） */
    thinking: '',
    /** 联网搜索的来源 */
    sources: [],
    /** 后端给的失败原因（空 = 没失败） */
    error: '',
    /** 后端已经重试了几次 */
    retries: 0,
    /** 现在是不是正处在「后端要重试」的状态 */
    retrying: false,
    /** 后端给的「正在重试」提示文案（前端直接显示，不自己另写一套） */
    retryNotice: '',
  }

  /**
   * 吃进一帧
   *
   * @param {{event?: string, data?: string}} frame
   * @returns {object} 累到现在的状态（同一个对象，方便链式用）
   */
  const push = (frame) => {
    if (!frame) return state
    // ⚠️ 库里无名帧的事件类型是空串 —— 当成正文(见 utils/sse.js)
    const event = frame.event || EV_MESSAGE
    const payload = parseChunkPayload(frame.data)

    switch (event) {
      case EV_MESSAGE:
        state.text += payload
        // 正文出来了 → 重试状态结束
        state.retrying = false
        break

      case EV_THINKING:
        // ⚠️ **一律攒起来**,不管正文出没出:后端一帧里可能同时有正文和思考链
        //    (OpenAI 协议下思考链和正文是交错的),只在「还没出正文」时攒的话,
        //    思考链的后半截会被整段丢掉 —— 用户看到的推理过程是残的。
        // ⚠️ 思考链**不混进正文**:它是模型的内部推理(还可能是英文的),
        //    页面单独放一块显示(见 components/ThinkingPanel.vue)。
        state.thinking = appendThinking(state.thinking, payload)
        state.retrying = false
        break

      case EV_SOURCE: {
        // 联网搜索的来源(标题 + 链接)—— 后端一直在发,以前前端**根本没接**这个事件,
        // 后端发的东西没人看等于白做。
        const list = parseSources(payload)
        if (list.length) {
          // 多个 source 事件就合并(同一个链接只留一条)
          const seen = new Set(state.sources.map((s) => s.url))
          for (const s of list) {
            if (s.url && seen.has(s.url)) continue
            seen.add(s.url)
            state.sources.push(s)
          }
        }
        break
      }

      case EV_RETRY:
        // ⚠️ **把上一遍的思考链清掉**:那一遍被厂商挂起了 —— 是条死路
        //    (模型想的东西已经被丢掉了)。留着用户会以为那就是这次回答的推理过程。
        //    ⚠️ 后端归档时也只留**最后一次**尝试的思考链 —— 两边对得上
        //    (刷新页面回看的思考过程 = 屏幕上的那份)。
        state.thinking = ''
        state.retrying = true
        state.retries += 1
        state.retryNotice = payload
        break

      case EV_ERROR:
        // ⚠️ 原因要**记在气泡上**,不能只在「内容为空」时才显示 ——
        //    模型常常先说一两句才失败(比如被内容审核拦下、或第二轮超时),
        //    那时内容不为空,错误就整个被吞掉了:用户看到半截回答,像成功了一样,
        //    根本不知道这一轮其实没答完。
        state.error = payload
        break

      default:
        // 认不出的事件:忽略(见文件头的说明)
        break
    }
    return state
  }

  return { state, push }
}
