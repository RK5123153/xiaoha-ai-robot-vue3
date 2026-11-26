/**
 * 多模态(看图说话):/v9/ai/** —— **无状态**,不接聊天记忆
 *
 * <p>⚠️ 别把新栈混用:/v2 的记忆是按 chatId 存的,/v9 每次都是
 *    「一张图 + 一个问题」的独立请求 —— 后端根本不收 chatId,
 *    传了也没用。
 */

import { API_BASE, fetchWithTimeout } from './base.js'

/** 多模态:看图说话 —— /v9/ai/** */
const VISION_BASE = `${API_BASE}/v9/ai`

export const visionApi = {
  /**
   * 上传图片 + 提问 → SSE
   *
   * <p>⚠️ 只能用 POST multipart:浏览器拿到的是**本地文件**(blob: 地址),
   * 后端拉不到,所以不能走 GET ?image=xxx 那条路;EventSource 也发不了 multipart。
   *
   * @param {object} params
   * @param {File} params.file
   * @param {string} params.message 问什么
   * @param {string} [params.model] 模型标识(空 = 后端默认)
   * @param {AbortSignal} [params.signal]
   * @returns {Promise<Response>}
   */
  async submit({ file, message, model = '', signal }) {
    const form = new FormData()
    form.append('file', file, file.name)
    form.append('message', message || '')
    if (model) form.append('model', model)

    return fetchWithTimeout(
      `${VISION_BASE}/generateStream`,
      {
        method: 'POST',
        // ⚠️ 千万别手写 Content-Type —— 少了 boundary 浏览器根本发不出去,
        //    后端会收到一个解析不了的 multipart 体(报 400,但原因跟图片没关系)。
        body: form,
      },
      { signal }
    )
  },
}
