/**
 * 老栈的接口 —— /v2/ai/**
 *
 * <p>⚠️ 新栈(/chat/**)没有这几个能力,但后端还留着,前端继续用。
 *
 * <p>⚠️ 「回滚最后一轮」原来也在这组里(DELETE /v2/ai/chats/{chatId}/last-turn),
 *    已经搬到新栈(见 ./conversation.js 的 rollbackLastTurn):回滚要连归档一起退,
 *    而归档只有新栈才有 —— 挂在老栈下面的话语义会「只做一半」。
 */

import { API_BASE, fetchWithTimeout } from './base.js'

/** 老栈:工具 / 反馈 —— /v2/ai/** */
const LEGACY_CHAT_BASE = `${API_BASE}/v2/ai`

export const toolApi = {
  /**
   * 可用工具清单 —— 前端拿它做「工具开关」。
   *
   * <p>返回的每一项:
   * <pre>
   *   { name, label, description, impl, defaultEnabled }
   *   name           短名,发请求时用它(tools=datetime,amap)
   *   label          中文标签,按钮上显示
   *   description    说明
   *   defaultEnabled 默认是不是开着(前端据此预先勾选)
   * </pre>
   *
   * @returns {Promise<Array<object>>} 工具清单;后端不支持时返回空数组
   */
  async list() {
    try {
      const res = await fetchWithTimeout(`${LEGACY_CHAT_BASE}/tools`)
      if (!res.ok) return []
      const data = await res.json()
      return Array.isArray(data) ? data : []
    } catch {
      // 后端是旧版本(没有 /tools)或者网络不通 → 当作「没有工具」,不影响聊天
      return []
    }
  },
}

export const feedbackApi = {
  /**
   * 点赞/点踩上报 —— 后端记 JSONL,失败也不打扰用户。
   *
   * @param {object} params
   * @param {string} params.chatId
   * @param {number} params.turnIndex 第几轮(从 1 开始)
   * @param {'up'|'down'} params.rating
   * @returns {Promise<boolean>}
   */
  async submit({ chatId, turnIndex, rating }) {
    try {
      const res = await fetchWithTimeout(`${LEGACY_CHAT_BASE}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, turnIndex, rating }),
      })
      return res.ok
    } catch {
      return false
    }
  },
}
