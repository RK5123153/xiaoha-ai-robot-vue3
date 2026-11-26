/**
 * 会话(对话)的接口 —— 新栈 /chat/** + /v13/**
 *
 * <p>页面的「左边栏」和「主内容区」都靠这组接口:
 *    左边栏列会话、点会话进主内容区、主内容区发消息/读历史。
 *
 * <p>⚠️ 别把新栈和老栈混用(老栈在 ./chat.js):
 *    新栈的会话按 uuid 存(Cassandra),老栈的聊天记忆按 chatId 存。
 *    同一个 uuid 在两边都能用(后端是同一份数据),但**接口语义不同**:
 *    老栈是「一个 chatId 对应一段上下文」,新栈是「一个 uuid 对应一个会话 + 一串消息」。
 */

import {
  API_BASE,
  fetchWithTimeout,
  getJson,
  postJson,
  query,
  readErrorMessage,
  unwrap,
} from './base.js'

/** 新栈:会话管理 —— /chat/** */
const CONVERSATION_BASE = `${API_BASE}/chat`

/** 新栈:会话历史 —— /v13/** */
const V13_BASE = `${API_BASE}/v13`

export const conversationApi = {
  /**
   * 新建一个会话 —— 后端生成 uuid,并拿首条消息当标题(summary)
   *
   * <p>⚠️ 建会话**不会**把这条消息存进消息表:
   *    它只是先占一个坑(会话列表里立刻能看到它),消息本体还得靠
   *    {@link conversationApi.completion} 再发一次。
   *
   * @param {object} params
   * @param {string} params.message 首条消息(用来生成标题)
   * @returns {Promise<{uuid: string, summary: string}>}
   */
  async create({ message }) {
    const payload = await postJson(`${CONVERSATION_BASE}/new`, { message })
    const data = unwrap(payload) || {}
    return { uuid: data.uuid || '', summary: data.summary || '' }
  },

  /**
   * 会话列表 —— 左边栏的数据源
   *
   * <p>按**最后更新时间**倒序(刚聊过的排在最上面),游标翻页。
   * 后端把标题截断到 60 个字。
   *
   * @param {object} [params]
   * @param {number} [params.size] 一页多少条(后端限制 1~100)
   * @param {string} [params.cursor] 上一页返回的 nextCursor;首页不传
   * @returns {Promise<{items: Array<object>, hasMore: boolean, nextCursor: string}>}
   */
  async list({ size = 20, cursor = '' } = {}) {
    const payload = await postJson(`${CONVERSATION_BASE}/list`, {
      size,
      ...(cursor ? { cursor } : {}),
    })
    const data = unwrap(payload)
    return {
      items: Array.isArray(data) ? data : [],
      hasMore: !!payload.hasMore,
      nextCursor: payload.nextCursor || '',
    }
  },

  /**
   * 删掉一个会话
   *
   * @param {object} params
   * @param {string} params.uuid 会话 uuid
   * @returns {Promise<boolean>} 是否真的删掉了
   */
  async remove({ uuid }) {
    const payload = await postJson(`${CONVERSATION_BASE}/delete`, { uuid })
    const data = unwrap(payload) || {}
    return !!data.deleted
  },

  /**
   * 给会话改名 —— 就是改它的标题(summary)
   *
   * @param {object} params
   * @param {number} params.id 会话的**数字 id**(不是 uuid!)
   * @param {string} params.summary 新标题
   * @returns {Promise<{id: number, summary: string}>}
   */
  async rename({ id, summary }) {
    const payload = await postJson(`${CONVERSATION_BASE}/summary/rename`, { id, summary })
    const data = unwrap(payload) || {}
    return { id: data.id, summary: data.summary }
  },

  /**
   * 某个会话的消息历史(游标翻页,按时间正序)
   *
   * <p>⚠️ 这个接口是**正序**的:第一页给的是**最早**的消息。
   *    页面要显示的是「最近聊了什么」,所以开页面时用
   *    {@link conversationApi.history} 一次性拿全量,而不是用这个。
   *    这个留着给「往前翻更多消息」用。
   *
   * @param {object} params
   * @param {string} params.chatId 会话 uuid
   * @param {number} [params.size]
   * @param {string} [params.cursor]
   * @returns {Promise<{items: Array<object>, hasMore: boolean, nextCursor: string}>}
   */
  async messages({ chatId, size = 20, cursor = '' }) {
    const payload = await postJson(`${CONVERSATION_BASE}/message/list`, {
      chatId,
      size,
      ...(cursor ? { cursor } : {}),
    })
    const data = unwrap(payload)
    return {
      items: Array.isArray(data) ? data : [],
      hasMore: !!payload.hasMore,
      nextCursor: payload.nextCursor || '',
    }
  },

  /**
   * 某个会话的完整消息历史(不分页)
   *
   * <p>页面打开一个会话时用这个:一次拿全量,直接铺到聊天区。
   * 消息很多的时候流量会大,但比「翻到最后一页」省事得多。
   *
   * @param {object} params
   * @param {string} params.uuid 会话 uuid
   * @returns {Promise<Array<object>>} 消息数组(按时间正序)
   */
  async history({ uuid }) {
    const payload = await getJson(`${V13_BASE}/chats/${encodeURIComponent(uuid)}`)
    const data = unwrap(payload)
    return Array.isArray(data) ? data : []
  },

  /**
   * 回滚最后一轮 —— 前端「重新生成」的前置动作。
   *
   * <p>不先回滚的话,模型会看到上一版答案,变成「在旧答案上改写」而不是「换一个答案」。
   *
   * <p>⚠️ 后端这个接口**两处存储一起回滚**:记忆窗口(Cassandra,给模型看的近场)
   * + 归档(PostgreSQL,给用户看的历史)。只回滚记忆窗口的话,用户刷新页面会看到
   * 「提问 + 旧答案 + 同样的提问 + 新答案」—— 同一个问题问了两遍。
   *
   * @param {string} chatId 会话 uuid
   * @returns {Promise<boolean>} 是否成功
   */
  async rollbackLastTurn(chatId) {
    try {
      const res = await fetchWithTimeout(
        `${CONVERSATION_BASE}/${encodeURIComponent(chatId)}/last-turn`,
        { method: 'DELETE' }
      )
      return res.ok
    } catch {
      return false
    }
  },

  /**
   * 发一条消息,拿流式回复
   *
   * <p>⚠️ 这是 **POST**,所以不能用 EventSource(它只能发 GET)——
   *    必须 fetch + ReadableStream 自己读 SSE(帧解析在 utils/sse.js)。
   *
   * <p>⚠️ 失败(HTTP 非 2xx)时后端返回的是**普通 JSON 错误体**,不是 SSE:
   *    比如模型没配 key 会返回 503 + {"message":"provider 'deepseek' 没有配置 API key..."}。
   *    所以这里先把非 2xx 转成 Error 抛出去,别去读流(读了也是空的,还看不出原因)。
   *
   * @param {object} params
   * @param {string} params.message 问什么
   * @param {string} [params.chatId] 会话 uuid
   * @param {string} [params.modelName] 模型标识(空 = 后端配置的默认模型)
   * @param {boolean} [params.networkSearch] 是否联网搜索
   * @param {number} [params.temperature]
   * @param {string} [params.tools] 要开启的工具(逗号分隔;none = 全关;空 = 后端默认)
   * @param {AbortSignal} [params.signal]
   * @returns {Promise<Response>} 交给调用方读 SSE 流
   */
  async completion({
    message,
    chatId,
    modelName = '',
    networkSearch,
    temperature,
    tools = '',
    signal,
  }) {
    const body = { message }
    if (chatId) body.chatId = chatId
    if (modelName) body.modelName = modelName
    if (typeof networkSearch === 'boolean') body.networkSearch = networkSearch
    if (typeof temperature === 'number') body.temperature = temperature
    if (tools) body.tools = tools

    const res = await fetchWithTimeout(
      `${CONVERSATION_BASE}/completion`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // ⚠️ **故意不带** `Accept: text/event-stream`
          //
          // 后端已经修好了:错误响应恒为 application/json(见后端 ApiExceptionHandler#json),
          // 带不带这个头都能拿到失败原因。
          // 但这里仍然不发 —— 万一前端先于后端更新上线,老后端带 Accept 时会返回
          // 503 + 空 body,失败原因就又看不见了。不带这个头,新老后端都能拿到原因。
          //
          // (读 SSE 本来也不需要它:响应类型由后端的 produces 决定,
          //  字节流是我们自己按帧拆的,见 utils/sse.js)
        },
        body: JSON.stringify(body),
      },
      // ⚠️ 这个超时只覆盖「连上 + 拿到响应头」这一段:
      //    fetch 一拿到响应头就 resolve,正文是之后慢慢读的
      //    (正文阶段的保护在 utils/sse.js 的空闲超时里)。
      { signal }
    ).catch((e) => {
      // 网络层面的失败(后端没起、端口不通、跨域被拒)—— fetch 自己就抛了,
      // 上面那套「读错误体」的逻辑根本走不到。
      // ⚠️ AbortError 是「我们自己掐断的」(切会话/离开页面),原样抛出去:
      //    上层靠 e.name 区分「取消」和「出错」,翻译了就认不出来了。
      if (e.name === 'AbortError') {
        throw e;
      }
      // 超时已经有专门的人话文案了,别再翻译成「网络连接失败」
      if (e?.message?.includes('请求超时')) throw e
      throw new Error('网络连接失败,请检查后端服务是否在运行');
    })
    if (!res.ok) throw new Error(await readErrorMessage(res))
    return res
  },
}
