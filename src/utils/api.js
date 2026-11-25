/**
 * 后端接口层 —— **整个前端只有这一处知道后端的 URL**。
 *
 * <p>之前 URL 散在 3 个文件里(Index.vue 拼聊天/回滚/反馈、tts.js 拼语音、vision.js 拼看图),
 * 想加个参数就得满项目找「哪个文件拼的这个地址」。现在收口到这里:
 * <ul>
 *   <li>组件(Layout.vue / Index.vue / ChatPage.vue)只调 {@code conversationApi.*} /
 *       {@code chatApi.*} / {@code ttsApi.*} / {@code visionApi.*},不出现任何 URL</li>
 *   <li>每个功能模块(会话/工具/tts/vision)只管自己的协议细节(SSE 帧解析、音频播放),
 *       「往哪个地址发」统一问这里</li>
 * </ul>
 *
 * <p><b>后端现在有两套聊天栈并存</b>:
 * <ul>
 *   <li><b>新栈</b> {@code /chat/**} + {@code /v13/**} —— 会话列表/历史/改名/删除/模型选择,
 *       数据落 Cassandra,是页面「左边栏 + 主内容」布局的数据来源。
 *       对话走 {@code POST /chat/completion}(POST + SSE)。</li>
 *   <li><b>老栈</b> {@code /v2/ai/**} —— 没有会话列表的概念(聊天记录在服务端文件/Cassandra 里,
 *       前端自己造 chatId)。新栈没覆盖到的地方还在用它:
 *       工具清单({@code /v2/ai/tools})、点赞点踩({@code /v2/ai/feedback})、
 *       回滚最后一轮({@code /v2/ai/chats/{chatId}/last-turn})、语音合成({@code /v2/ai/speech})。</li>
 * </ul>
 *
 * <p>换环境(打包到别的域名)也只改 {@link SERVER_BASE} 这一处。
 */

/** 后端服务地址 */
export const SERVER_BASE = 'http://localhost:8080'

/**
 * 新栈:会话(对话 + 增删改查) —— /chat/**
 *
 * <p>这��后端「大更新」后加的一组接口,是一套完整的会话管理:
 * 建会话 → 列会话 → 看历史 → 改名 → 删会话。
 * 页面的左边栏就是拿它渲染的。
 */
const CONVERSATION_BASE = `${SERVER_BASE}/chat`

/**
 * 新栈:模型清单 / 会话历史 —— /v13/**
 */
const V13_BASE = `${SERVER_BASE}/v13`

/**
 * 老栈:工具 / 反馈 / 回滚 / 语音 —— /v2/ai/**
 *
 * ⚠️ 别把两个 base 混用:
 *   新栈的会话按 uuid 存(Cassandra),老栈的聊天记忆按 chatId 存。
 *   同一个 uuid 在两边都能用(后端是同一份数据),但**接口语义不同**:
 *   老栈是「一个 chatId 对应一段上下文」,新栈是「一个 uuid 对应一个会话 + 一串消息」。
 */
const LEGACY_CHAT_BASE = `${SERVER_BASE}/v2/ai`

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
 * 拆掉后端统一的响应信封
 *
 * <p>新栈(/chat/**、/v13/**)的响应一律是这个形状:
 *   { "success": true, "message": null, "errorCode": null, "data": ... }
 *
 * ⚠️ 别把信封里的 `message` 当成「聊天的内容」——
 *    它是**出错的说明**,成功时是 null。聊天内容在 `data` 里。
 *
 * @param {object} payload 后端返回的 JSON
 * @returns {*} data 字段;失败时抛 Error
 */
const unwrap = (payload) => {
  if (!payload || typeof payload !== 'object') return payload
  // 不是本项目这批接口的形状(比如老栈直接返回一个数组)→ 原样返回
  if (!('success' in payload)) return payload
  if (!payload.success) {
    throw new Error(payload.message || payload.errorCode || '请求失败')
  }
  return payload.data
}

/**
 * 发一个 JSON POST,失败时抛出「能给人看」的原因
 *
 * @param {string} url
 * @param {object} body
 * @returns {Promise<object>} 解析后的 JSON(信封还没拆)
 */
const postJson = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return res.json()
}

/**
 * 发一个 JSON GET,失败时抛出「能给人看」的原因
 *
 * @param {string} url
 * @returns {Promise<object>} 解析后的 JSON(信封还没拆)
 */
const getJson = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return res.json()
}

/**
 * 新栈:会话管理(/chat/**)
 *
 * <p>页面的「左边栏」和「主内容区」都靠这组接口:
 * 左边栏列会话、点会话进主内容区、主内容区发消息/读历史。
 */
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

    const res = await fetch(`${CONVERSATION_BASE}/completion`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // ⚠️ **不要**加 `Accept: text/event-stream`
        //
        // 后端的这个接口声明了 produces=text/event-stream,响应类型由它决定,
        // 加上这个头没用。但加了就**坏消息**:
        //   带 Accept 头 → 失败时返回 503 + **空 body**(错误处理也想按 SSE 输出,
        //                   结果 JSON 错误体写不进去,body 是空的)
        //   不带 Accept 头 → 失败时返回 503 + 正常的 JSON 错误体
        //                    {"message":"provider 'deepseek' 没有配置 API key..."}
        //
        // 而用户最需要看到的恰恰是失败原因 —— 所以这里**故意不带** Accept 头。
        // (读 SSE 不需要它:我们自己按字节拆帧,见 utils/sse.js)
      },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok) throw new Error(await readErrorMessage(res))
    return res
  },
}

/**
 * 新栈:模型清单(/v13/models)
 */
export const modelApi = {
  /**
   * 后端配置了哪些模型
   *
   * <p>每一项:
   * <pre>
   *   { code, name, provider, description, webSearch }
   *   code        发请求时用的模型标识(modelName)
   *   name        展示用的名字
   *   provider    厂商
   *   description 一句话说明
   *   webSearch   这个模型支不支持联网搜索
   * </pre>
   *
   * @returns {Promise<Array<object>>} 模型清单;拿不到时返回空数组
   */
  async list() {
    try {
      const payload = await getJson(`${V13_BASE}/models`)
      const data = unwrap(payload)
      return Array.isArray(data) ? data : []
    } catch {
      // 后端没这个接口 / 网络不通 → 当作「没有可选模型」,前端用默认模型
      return []
    }
  },
}

/**
 * 老栈:工具 / 反馈 / 回滚(/v2/ai/**)
 *
 * <p>新栈(/chat/**)没有这几个能力,但后端还留着,前端继续用。
 */
export const chatApi = {
  /**
   * 回滚最后一轮 —— 前端「重新生成」的前置动作。
   *
   * <p>不先回滚的话,模型会看到上一版答案,变成「在旧答案上改写」而不是「换一个答案」。
   *
   * <p>⚠️ ���个接口挂在老栈(/v2/ai)上,但操作的是**同一份数据**:
   *    新栈建的会话 uuid 传进去也能删掉最后一轮(后端两边读的是同一个存储)。
   *
   * @param {string} chatId
   * @returns {Promise<boolean>} 是否成功
   */
  async rollbackLastTurn(chatId) {
    try {
      const res = await fetch(
        `${LEGACY_CHAT_BASE}/chats/${encodeURIComponent(chatId)}/last-turn`,
        { method: 'DELETE' }
      )
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
      const res = await fetch(`${LEGACY_CHAT_BASE}/feedback`, {
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
   *   name           短名,发请求时用它(tools=datetime,amap)
   *   label          中文标签,按钮上显示
   *   description    说明
   *   defaultEnabled 默认是不是开着(前端据此预先勾选)
   * </pre>
   *
   * @returns {Promise<Array<object>>} 工具清单;后端不支持时返回空数组
   */
  async tools() {
    try {
      const res = await fetch(`${LEGACY_CHAT_BASE}/tools`)
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
    const res = await fetch(`${LEGACY_CHAT_BASE}/speech`, {
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
