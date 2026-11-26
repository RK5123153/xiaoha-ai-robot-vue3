/**
 * 接口层地基 —— **整个前端只有这一处知道后端在哪**
 *
 * <p>URL 收在这儿的原因:组件里不出现任何后端地址,
 *    后端换路径 / 换部署地址只改这一处。
 *
 * <p><b>后端地址怎么定</b>:
 * <ul>
 *   <li><b>默认 '/api'</b> —— 走**同源**。
 *       开发时 vite 代理把 /api 转发到后端并去掉前缀(vite.config.ts),
 *       生产时用 nginx 做同样的事。
 *       <br>前后端同源 → 不用处理跨域,也不用在包里写死某个域名。</li>
 *   <li><b>后端在别的域名</b> —— 构建时给一个环境变量:
 *       <pre>VITE_API_BASE=https://api.example.com npm run build</pre>
 *       这时候这个值就是后端的完整前缀(不再带 /api)。</li>
 * </ul>
 *
 * <p>⚠️ 别再用 axios:这个项目最核心的流式对话(/chat/completion 的 SSE)
 *    axios 根本不支持 —— 它会把整个响应读完才给你,流式就没了。
 *    那条链路只能用 fetch + ReadableStream,于是等于项目里同时存在两套 HTTP 栈。
 *    原生 fetch 把这几个坑填掉就够:超时(见下)、错误信息翻译、信封拆解。
 */

/** 后端地址前缀 */
export const API_BASE = import.meta.env.VITE_API_BASE || '/api'

/** 普通请求的超时(ms) */
const REQUEST_TIMEOUT = 30000

/** 超时用的中止原因(用它把「超时」和「用户主动取消」分开) */
const TIMEOUT_REASON = '__request_timeout__'

/**
 * 把多个 AbortSignal 合成一个
 *
 * <p>⚠️ 不用 AbortSignal.any():Safari 17.4 以下没有,
 *    而国内不少 App 的内嵌 WebView 还停在旧内核上。
 *
 * @param {...(AbortSignal|undefined|null)} signals
 * @returns {AbortSignal|undefined}
 */
export const combineSignals = (...signals) => {
  const list = signals.filter(Boolean)
  if (!list.length) return undefined
  if (list.length === 1) return list[0]

  const controller = new AbortController()
  for (const s of list) {
    if (s.aborted) {
      controller.abort(s.reason)
      break
    }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true })
  }
  return controller.signal
}

/**
 * fetch + 超时
 *
 * <p>⚠️ fetch **默认没有超时**:后端挂住的话请求永远不回来,
 *    页面上的「发送中」会一直灰着,用户除了刷新没别的办法。
 *    所以每个请求都套一个定时器,到点自己掐断。
 *
 * @param {string} url
 * @param {object} [options] fetch 的选项
 * @param {object} [config]
 * @param {number} [config.timeout] 超时毫秒;0 = 不限
 * @param {AbortSignal} [config.signal] 调用方自己的信号(用户切会话时掐断)
 * @returns {Promise<Response>}
 */
export const fetchWithTimeout = async (url, options = {}, { timeout = REQUEST_TIMEOUT, signal } = {}) => {
  const controller = new AbortController()
  const timer = timeout
    ? setTimeout(() => controller.abort(new Error(TIMEOUT_REASON)), timeout)
    : null

  try {
    return await fetch(url, {
      ...options,
      signal: combineSignals(controller.signal, signal),
    })
  } catch (e) {
    // 超时要给一句人话;「用户主动取消」(AbortError)原样抛出去,
    // 上层靠 e.name 区分「取消」和「出错」,翻译了就认不出来了。
    if (e?.message === TIMEOUT_REASON) {
      throw new Error('请求超时，请检查后端服务是否在运行')
    }
    throw e
  } finally {
    if (timer) clearTimeout(timer)
  }
}

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
export const query = (params = {}) => {
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
export const unwrap = (payload) => {
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
export const postJson = async (url, body) => {
  const res = await fetchWithTimeout(url, {
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
export const getJson = async (url) => {
  const res = await fetchWithTimeout(url)
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return res.json()
}
