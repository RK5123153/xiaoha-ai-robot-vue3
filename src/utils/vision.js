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
 *   所以这里走 fetch + SSE(见 utils/sse.js,基于 @microsoft/fetch-event-source)。
 *
 * 后端的三个端点:
 *   POST /v9/ai/generateStream  multipart(file + message)→ SSE  ← 本文件用这个
 *   GET  /v9/ai/generateStream  ?message=&image=            → SSE
 *   GET  /v9/ai/generate        ?message=&image=            → 同步一次性返回
 *
 * 事件协议和 /chat/completion 完全一致(后端 SseChatSupport 统一封的):
 *   event: message  → 正文,data 是 JSON 信封 {"v":"..."}
 *   event: thinking → 思考链,只用来维持「正在思考…」提示
 *   event: source   → 联网搜索的来源(看图说话用不到,但协议统一,照样认)
 *   event: retry    → 后端要把这一轮重发一次(厂商挂起了)
 *   event: error    → 模型没吐出正文时补发,data 是中文原因
 *
 * ⚠️ **协议只在 {@code utils/stream-events.js} 里认一次**,本文件不自己分流 ——
 *    三个读流的地方各写一份分流,改一处忘了另一处就会「有的页面认 retry、有的不认」。
 */

import { createStreamCollector } from './stream-events.js'
import { visionApi } from '@/api/vision.js'

/** 用户什么都没说时的默认问题(后端也有一份,但这里自己给更可控) */
export const DEFAULT_QUESTION = '请描述一下这张图片'

/**
 * 问一次「这张图里是什么」
 *
 * @param {object} options
 * @param {File} options.file 要看的图片(已经过 prepareImage 处理)
 * @param {string} [options.message] 问什么
 * @param {string} [options.model] 模型标识(留空 = 后端用 app.multimodal.default-model)
 * @param {AbortSignal} [options.signal]
 * @param {(state: object) => void} [options.onState] 每帧之后回调一次(状态见 utils/stream-events.js)
 * @returns {Promise<object>} 这一轮结束时的状态(text / thinking / error …)
 * @throws {Error} 失败时抛,message 是能直接展示给人看的中文原因
 */
export const sendVisionStream = async ({
  file,
  message,
  model = '',
  signal,
  onState,
}) => {
  // 累加器 —— 事件协议只有这一处实现
  const collector = createStreamCollector()

  // 请求本身交给接口层(它知道往哪个地址发);这里只管「读流」
  await visionApi.submit({
    file,
    message: message || DEFAULT_QUESTION,
    model,
    signal,
    onFrame: (frame) => {
      collector.push(frame)
      // ⚠️ 每帧都回调:页面要把状态写进**响应式**的气泡里,
      //    自己不在这里攒(攒在普通对象里界面不会更新)。
      onState?.(collector.state)
    },
  })

  return collector.state
}
