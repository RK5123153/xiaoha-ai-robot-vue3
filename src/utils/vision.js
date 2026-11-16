/**
 * 多模态(看图说话) —— 后端 /v9/ai/**
 *
 * 选它而不是 /v9/ai/generateStream?image=xxx 的原因:
 *   浏览器拿到的图片是**本地文件**(用户刚选的),没法给后端一个 URL 让它去拉。
 *   所以走 POST + multipart 那条路。
 *
 * ⚠️ 为什么不能用 EventSource:
 *   EventSource **只能发 GET**,发不了 multipart。
 *   而 GET 那条路的 `image` 参数只能是 URL / classpath / 服务器本地文件 ——
 *   浏览器里的 blob: 地址后端根本拉不到。
 *   所以这里用 fetch + ReadableStream 自己读 SSE(帧解析在 utils/sse.js)。
 *
 * 后端的三个端点:
 *   POST /v9/ai/generateStream  multipart(file + message)→ SSE  ← 本文件用这个
 *   GET  /v9/ai/generateStream  ?message=&image=            → SSE
 *   GET  /v9/ai/generate        ?message=&image=            → 同步一次性返回
 *
 * 事件协议和 /v2/ai 完全一致(SseChatSupport 统一封的):
 *   event: message  → 正文,data 是 JSON 信封 {"v":"..."}
 *   event: thinking → 思考链,只用来维持「正在思考…」提示
 *   event: error    → 模型没吐出正文时补发,data 是中文原因
 */

import { MULTIMODAL_API_BASE } from './api.js'
import { parseChunkPayload, readSseStream } from './sse.js'

/** 用户什么都没说时的默认问题(后端也有一份,但这里自己给更可控) */
export const DEFAULT_QUESTION = '请描述一下这张图片'

/**
 * 从一个失败的响应里挖出「能给人看」的原因
 *
 * 后端把原因放在响应的 JSON 里(Spring 默认错误体的 `message` 字段):
 *   {"timestamp":"...","status":400,"error":"Bad Request","message":"provider 'bailian' 不在多模态白名单里 ...","path":"/v9/ai/generateStream"}
 *
 * ⚠️ 生产环境后端把 `include-message` 关成了 `never`,那时响应体里没有 `message`,
 *    只能退回状态码 —— 所以兜底文案里要带上状态码。
 *
 * @param {Response} res
 * @returns {Promise<string>}
 */
export const readErrorMessage = async (res) => {
  let detail = ''
  try {
    const data = await res.json()
    // ⚠️ 只取 `message`,不要拿 `error` 兜底 ——
    //    Spring 默认错误体里的 `error` 是 HTTP 的标准原因短语("Bad Request"、
    //    "Service Unavailable"),对用户毫无信息量,还把真正有用的状态码挤掉了。
    detail = data?.message || ''
  } catch {
    // 不是 JSON(网关的 HTML 错误页之类)→ 用状态码兜底
  }
  if (detail) return detail
  return `请求失败(HTTP ${res.status}${res.statusText ? ' ' + res.statusText : ''})`
}

/**
 * 问一次「这张图里是什么」
 *
 * @param {object} options
 * @param {File} options.file 要看的图片(已经过 prepareImage 处理)
 * @param {string} [options.message] 问什么
 * @param {string} [options.model] 模型标识(留空 = 后端用 app.multimodal.default-model)
 * @param {AbortSignal} [options.signal]
 * @param {(delta: string, all: string) => void} [options.onChunk] 收到正文分片
 * @param {(text: string) => void} [options.onThinking] 收到思考链
 * @param {(reason: string) => void} [options.onServerError] 后端说「没答上来」的原因
 * @returns {Promise<string>} 完整的正文
 * @throws {Error} 失败时抛,message 是能直接展示给人看的中文原因
 */
export const sendVisionStream = async ({
  file,
  message,
  model = '',
  signal,
  onChunk,
  onThinking,
  onServerError,
}) => {
  const form = new FormData()
  form.append('file', file, file.name)
  form.append('message', message || DEFAULT_QUESTION)
  if (model) form.append('model', model)

  const res = await fetch(`${MULTIMODAL_API_BASE}/generateStream`, {
    method: 'POST',
    // ⚠️ 千万别手写 Content-Type —— 少了 boundary 浏览器根本发不出去,
    //    后端会收到一个解析不了的 multipart 体(报 400,但原因跟图片没关系)。
    body: form,
    signal,
  })

  // HTTP 层就失败了(400 图片类型不对 / 503 模型没配 key / 500 容器超限)
  if (!res.ok) throw new Error(await readErrorMessage(res))

  let text = ''
  await readSseStream(res, ({ event, data }) => {
    // data 可能是 JSON 信封(现在的后端),也可能是裸文本(老后端)—— 两种都认
    const payload = parseChunkPayload(data)
    if (event === 'message') {
      text += payload
      onChunk?.(payload, text)
    } else if (event === 'thinking') {
      onThinking?.(payload)
    } else if (event === 'error') {
      // 模型一条正文都没吐出来(比如思考链把 max_tokens 吃光了)
      onServerError?.(payload)
    }
  })

  return text
}
