/**
 * 后端接口层 —— **整个前端只有这一处知道后端的 URL**。
 *
 * <p>之前 URL 散在 3 个文件里(Index.vue 拼聊天/回滚/反馈、tts.js 拼语音、vision.js 拼看图),
 * 想加个参数就得满项目找「哪个文件拼的这个地址」。现在收口到这里:
 * <ul>
 *   <li>组件(Index.vue)只调 {@code chatApi.*} / {@code ttsApi.*} / {@code visionApi.*},不出现任何 URL</li>
 *   <li>每个功能模块(tools/tts/vision)只管自己的协议细节(SSE 帧解析、音频播放),
 *       「往哪个地址发」统一问这里</li>
 * </ul>
 *
 * <p><b>后端的路径为什么是 /v2、/v9 这种带版本号的</b>:
 * 那是教程系列的骨架 —— 每一节新增一个能力就升一版(v2 聊天、v8 结构化输出、v9 多模态、
 * v10 文生图、v11 语音、v12 视频……),和你的博客文章一一对应。
 * <b>所以前端不要去拼这些路径</b>:路径变了只改本文件,组件一行都不用动。
 *
 * <p>换环境(打包到别的域名)也只改 {@link SERVER_BASE} 这一处。
 */

/** 后端服务地址 */
export const SERVER_BASE = 'http://localhost:8080'

/**
 * 文字对话:/v2/ai/** —— **有**多轮记忆(按 chatId 存上下文)
 */
const CHAT_BASE = `${SERVER_BASE}/v2/ai`

/**
 * 多模态(看图说话):/v9/ai/** —— **无状态**,不接聊天记忆
 *
 * ⚠️ 别把两个 base 混用:
 *   /v2 的记忆是按 chatId 存的,/v9 每次都是「一张图 + 一个问题」的独立请求 ——
 *   后端根本不收 chatId 这个参数,传了也没用。
 *   这也是前端要单独开一个「看图说话」模式的原因:
 *   两种对话的上下文语义不一样,混在一条时间线上会让人以为模型记得上一张图。
 */
const VISION_BASE = `${SERVER_BASE}/v9/ai`

/**
 * 拼查询串
 *
 * <p>用 URLSearchParams 而不是手写 encodeURIComponent:
 * 手写最容易漏掉某个参数(尤其是后来新增的),漏了就是「参数没生效」这种玄学 bug。
 *
 * <p>空值直接跳过 —— URL 里出现 {@code ?tools=} 和不出现是两回事:
 * 后端把「没传」和「传了空串」都当成「用默认工具」,但「一个都不开」要用 {@code none}。
 *
 * @param {object} params 键值对
 * @returns {string} 带 ? 的查询串,没有参数时返回空串
 */
const query = (params = {}) => {
  const usp = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    usp.append(key, value)
  })
  const s = usp.toString()
  return s ? `?${s}` : ''
}

/**
 * 从一个失败的响应里挖出「能给人看」的原因
 *
 * <p>后端把原因放在响应的 JSON 里(Spring 默认错误体的 `message` 字段):
 *   {"timestamp":"...","status":400,"error":"Bad Request","message":"provider 'bailian' 不在多模态白名单里 ...","path":"/v9/ai/generateStream"}
 *
 * ⚠️ 生产环境后端把 `include-message` 关成了 `never`,那时响应体里没有 `message`,
 *    只能退回状态码 —— 所以兜底文案里要带上状态码。
 *
 * ⚠️ 只取 `message`,不要拿 `error` 兜底 ——
 *    Spring 默认错误体里的 `error` 是 HTTP 的标准原因短语("Bad Request"、
 *    "Service Unavailable"),对用户毫无信息量,还把真正有用的状态码挤掉了。
 *
 * @param {Response} res
 * @returns {Promise<string>}
 */
export const readErrorMessage = async (res) => {
  let detail = ''
  try {
    const data = await res.json()
    detail = data?.message || ''
  } catch {
    // 不是 JSON(网关的 HTML 错误页之类)→ 用状态码兜底
  }
  if (detail) return detail
  return `请求失败(HTTP ${res.status}${res.statusText ? ' ' + res.statusText : ''})`
}

/**
 * 文字对话(/v2/ai/**)
 */
export const chatApi = {
  /**
   * 流式对话的 URL —— 用 EventSource 发的,**只能 GET**,所以这里给 URL 而不是发请求。
   *
   * <p>EventSource 自带断线重连,但本项目的用法是「收到结束就 close()」,
   * 避免它按重连策略把同一个问题再问一遍(见 Index.vue 的 closeSSE)。
   *
   * @param {object} params
   * @param {string} params.message  问什么
   * @param {string} params.chatId   会话 ID(后端按它存上下文)
   * @param {string} [params.system] 临时换角色(空 = 用后端默认身份)
   * @param {string} [params.tools]  要开启的工具(逗号分隔的短名;none = 全关;空 = 用后端默认)
   * @returns {string}
   */
  streamUrl({ message, chatId, system = '', tools = '' } = {}) {
    return `${CHAT_BASE}/generateStream${query({ message, chatId, system, tools })}`
  },

  /**
   * 回滚最后一轮 —— 前端「重新生成」的前置动作。
   *
   * <p>不先回滚的话,模型会看到上一版答案,变成「在旧答案上改写」而不是「换一个答案」。
   *
   * @param {string} chatId
   * @returns {Promise<boolean>} 是否成功
   */
  async rollbackLastTurn(chatId) {
    try {
      const res = await fetch(`${CHAT_BASE}/chats/${encodeURIComponent(chatId)}/last-turn`, {
        method: 'DELETE',
      })
      return res.ok
    } catch {
      return false
    }
  },

  /**
   * 点赞/点踩上报 —— 后端记 JSONL,失败也不打扰用户。
   *
   * @param {object} params
   * @param {string} params.chatId
   * @param {number} params.turnIndex 第几轮(从 1 开始)
   * @param {'up'|'down'} params.rating
   * @returns {Promise<boolean>}
   */
  async feedback({ chatId, turnIndex, rating }) {
    try {
      const res = await fetch(`${CHAT_BASE}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, turnIndex, rating }),
      })
      return res.ok
    } catch {
      return false
    }
  },

  /**
   * 可用工具清单 —— 前端拿它做「工具开关」。
   *
   * <p>返回的每一项:
   * <pre>
   *   { name, label, description, impl, defaultEnabled }
   *   name           短名,发请求时用它(?tools=datetime,amap)
   *   label          中文标签,按钮上显示
   *   description    说明
   *   defaultEnabled 默认是不是开着(前端据此预先勾选)
   * </pre>
   *
   * @returns {Promise<Array<object>>} 工具清单;后端不支持时返回空数组
   */
  async tools() {
    try {
      const res = await fetch(`${CHAT_BASE}/tools`)
      if (!res.ok) return []
      const data = await res.json()
      return Array.isArray(data) ? data : []
    } catch {
      // 后端是旧版本(没有 /tools)或者网络不通 → 当作「没有工具」,不影响聊天
      return []
    }
  },
}

/**
 * 语音合成(/v2/ai/speech)
 */
export const ttsApi = {
  /**
   * 请求后端合成一段 mp3
   *
   * @param {string} text 纯文本
   * @param {AbortSignal} [signal]
   * @returns {Promise<Blob>} 音频;失败时抛 Error(带 status)
   */
  async synthesize(text, signal) {
    const res = await fetch(`${CHAT_BASE}/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal,
    })
    if (!res.ok) {
      // 501 = 后端没开 TTS(app.tts.enabled=false)→ 上层据此退回浏览器 TTS
      const err = new Error(`后端语音接口返回 ${res.status}`)
      err.status = res.status
      throw err
    }
    const type = res.headers.get('content-type') || ''
    if (!type.includes('audio')) {
      throw new Error('后端语音接口没返回音频')
    }
    return res.blob()
  },
}

/**
 * 看图说话(/v9/ai/**)
 */
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
   * @returns {Promise<Response>} 交给调用方读 SSE 流
   */
  async submit({ file, message, model = '', signal }) {
    const form = new FormData()
    form.append('file', file, file.name)
    form.append('message', message || '')
    if (model) form.append('model', model)

    return fetch(`${VISION_BASE}/generateStream`, {
      method: 'POST',
      // ⚠️ 千万别手写 Content-Type —— 少了 boundary 浏览器根本发不出去,
      //    后端会收到一个解析不了的 multipart 体(报 400,但原因跟图片没关系)。
      body: form,
      signal,
    })
  },
}
