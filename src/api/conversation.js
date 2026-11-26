/**
 * 会话(对话)的接口 —— 新栈 /chat/**
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
  postJson,
  query,
  unwrap,
} from './base.js'
import { streamSse } from '@/utils/sse.js'

/** 新栈:会话管理 —— /chat/** */
const CONVERSATION_BASE = `${API_BASE}/chat`

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
   * 某个会话的消息历史(游标翻页,**从最新往回翻**)
   *
   * <p>⚠️ 翻页方向和「页码分页」的直觉相反,这是后端定的:
   *   <ul>
   *     <li>不传 cursor → 拿到的是**最新**的一页(页内按时间正序:先问后答);</li>
   *     <li>把 nextCursor 原样传回来 → 拿到的是**更早**的一页;</li>
   *     <li>hasMore=false → 已经翻到头了(会话最开始)。</li>
   *   </ul>
   *   前端就是按这个来的:打开会话先显示「最近聊了什么」,
   *   用户往上一滑才去加载更早的(见 ChatPage.vue 的 loadOlderHistory)。
   *
   * <p>⚠️ 游标不能改 —— 改坏了后端会 400(而不是当成「没传」),
   *    那样前端会拿到最新的一页却以为那是下一页,历史直接重复。
   *
   * @param {object} params
   * @param {string} params.chatId 会话 uuid
   * @param {number} [params.size] 一页多少条(后端限制 1~100)
   * @param {string} [params.cursor] 上一页返回的 nextCursor;第一页不传
   * @returns {Promise<{items: Array<object>, hasMore: boolean, nextCursor: string, totalTurns: number}>}
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
      // 这个会话一共多少轮(= 归档里 user 消息的条数)。
      // ⚠️ 老后端没这个字段 → 0,前端按「不知道总数」处理(轮次号变成相对的)。
      totalTurns: typeof payload.totalTurns === 'number' ? payload.totalTurns : 0,
    }
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
   *    走的是 utils/sse.js 里那层(基于 @microsoft/fetch-event-source)。
   *
   * <p>⚠️ 失败(HTTP 非 2xx)时后端返回的是**普通 JSON 错误体**,不是 SSE:
   *    比如模型没配 key 会返回 503 + {"message":"provider 'deepseek' 没有配置 API key..."}。
   *    sse.js 那层会把这条原因挖出来原样抛出去。
   *
   * @param {object} params
   * @param {string} params.message 问什么
   * @param {string} [params.chatId] 会话 uuid
   * @param {string} [params.modelName] 模型标识(空 = 后端配置的默认模型)
   * @param {boolean} [params.networkSearch] 是否联网搜索
   * @param {number} [params.temperature]
   * @param {string} [params.tools] 要开启的工具(逗号分隔;none = 全关;空 = 后端默认)
   * @param {AbortSignal} [params.signal]
   * @param {(frame: {event: string, data: string}) => void} params.onFrame 每帧回调
   * @returns {Promise<void>} 流结束才 resolve
   */
  async completion({
    message,
    chatId,
    modelName = '',
    networkSearch,
    temperature,
    tools = '',
    signal,
    onFrame,
  }) {
    const body = { message }
    if (chatId) body.chatId = chatId
    if (modelName) body.modelName = modelName
    if (typeof networkSearch === 'boolean') body.networkSearch = networkSearch
    if (typeof temperature === 'number') body.temperature = temperature
    if (tools) body.tools = tools

    await streamSse({
      url: `${CONVERSATION_BASE}/completion`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
      onFrame,
    })
  },
}
