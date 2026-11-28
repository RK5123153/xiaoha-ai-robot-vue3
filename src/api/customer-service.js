/**
 * AI 智能客服的接口 —— /customer-service/**
 *
 * <p>和主聊天链路(./conversation.js)是**两套**:
 *    <ul>
 *      <li>主聊天 {@code /chat/**}:有会话、有聊天记忆、有归档(刷新还能看回来);</li>
 *      <li>客服 {@code /customer-service/**}:<b>无状态</b> —— 每一问独立去知识库检索、
 *          独立作答,不接聊天记忆、也不写进会话表(见后端 {@code CustomerChatService}
 *          的类注释)。所以它没有「建会话 / 拉历史 / 改名」那一套接口。</li>
 *    </ul>
 *
 * <p>⚠️ <b>事件协议和主聊天完全一致</b>(正文 {@code message} / 思考链 {@code thinking} /
 *    来源 {@code source} / 重试 {@code retry} / 错误 {@code error},data 是 JSON 信封
 *    {@code {"v":"…"}}),所以传输层直接复用 {@link streamSse}、协议分流直接复用
 *    {@code utils/stream-events.js} ——
 *    <b>别在这儿另写一套</b>:另写一套就意味着「标签页切走会重发一遍 POST」
 *    「后端的失败原因被吃掉」这两个坑要重新踩一次(见 utils/sse.js 的说明)。
 */

import {
  API_BASE,
  fetchWithTimeout,
  postJson,
  readErrorMessage,
  unwrap,
} from './base.js'
import { streamSse } from '@/utils/sse.js'

/** 智能客服 —— /customer-service/** */
const CUSTOMER_BASE = `${API_BASE}/customer-service`

/** 上传文件的上限(字节)—— 和后端 app.customer-service.max-file-size 一致(10MB) */
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024

export const customerServiceApi = {
  /**
   * 提问 —— 检索知识库后作答,SSE 流式返回
   *
   * @param {object} params
   * @param {string} params.question 问什么(后端字段名是 question;后端也认 message 这个别名)
   * @param {string} [params.chatId] 本次问答的标识 —— 后端只拿它把日志串起来,不影响作答
   * @param {number} [params.kbId] 只查某个知识库;不传 = 查全部
   * @param {number} [params.topK] 检索取几条;不传 = 用后端配置的默认值
   * @param {string} [params.model] 用哪个模型;不传 = 后端配置的默认模型
   * @param {AbortSignal} [params.signal] 取消信号(用户点「停止生成」/ 离开页面)
   * @param {(frame: {event: string, data: string}) => void} params.onFrame 每帧回调
   * @returns {Promise<void>} 流结束(或出错)才 resolve/reject
   */
  async chat({ question, chatId, kbId, topK, model, signal, onFrame }) {
    const body = { question }
    if (chatId) body.chatId = chatId
    if (kbId !== undefined && kbId !== null) body.kbId = kbId
    if (topK) body.topK = topK
    if (model) body.model = model

    await streamSse({
      // ⚠️ 走同源的 /api(vite 代理转给后端),组件里不出现任何后端地址 ——
      //    写死 localhost:8080 的话,打包出来的东西永远指着访客自己电脑的 8080 端口。
      url: `${CUSTOMER_BASE}/chat`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
      onFrame,
    })
  },

  /**
   * 问答文件列表 —— 页码分页
   *
   * <p>⚠️ <b>翻页信息在信封层,不在 data 里</b>(后端 {@code PageResponse}):
   *   <pre>{ "success": true, "data": [ ...本页文件... ],
   *         "total": 42, "size": 10, "current": 1, "pages": 5 }</pre>
   *   {@link unwrap} 只拆得出 {@code data}(本页的数组),翻页信息得自己从信封上读 ——
   *   漏了这一步,分页条上的「共 N 条」永远是 0。
   *
   * @param {object} [params]
   * @param {number} [params.current] 页号(从 1 开始)
   * @param {number} [params.size] 一页多少条(后端上限 100)
   * @param {number} [params.kbId] 只看某个知识库;不传 = 全部
   * @param {number} [params.status] 只看某个处理状态;不传 = 全部
   * @param {string} [params.fileName] 文件名(子串,大小写不敏感);不传 = 不过滤
   * @param {string} [params.startDate] 创建时间起点(含当天),格式 {@code yyyy-MM-dd}
   * @param {string} [params.endDate] 创建时间终点(含当天),格式 {@code yyyy-MM-dd}
   * @returns {Promise<{items: Array<object>, total: number, size: number, current: number, pages: number}>}
   */
  async listFiles({ current = 1, size = 10, kbId, status, fileName, startDate, endDate } = {}) {
    const payload = await postJson(`${CUSTOMER_BASE}/md/list`, {
      current,
      size,
      ...(kbId !== undefined && kbId !== null ? { kbId } : {}),
      ...(status !== undefined && status !== null ? { status } : {}),
      // ⚠️ 空字符串**别发过去**:后端把空白当成「不过滤」,但发过去总归是多余的字段
      ...(fileName ? { fileName } : {}),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    })
    const items = unwrap(payload)
    return {
      items: Array.isArray(items) ? items : [],
      total: Number(payload?.total) || 0,
      size: Number(payload?.size) || size,
      current: Number(payload?.current) || current,
      pages: Number(payload?.pages) || 0,
    }
  },

  /**
   * 上传一个 Markdown 问答文件
   *
   * <p>⚠️ <b>表单提交</b>(multipart/form-data),字段名是 {@code file}。
   *    上传接口**只落库**:状态记「待处理」,切分 + 向量化是后台线程的活 ——
   *    所以它返回得很快,前端要靠「刷新列表」看进度。
   *
   * <p>⚠️ <b>别设 Content-Type</b>:multipart 的 boundary 得由浏览器自己生成,
   *    手写 header 会把 boundary 丢掉,后端收到的是个空表单。
   *
   * @param {File} file 选中的 .md 文件
   * @returns {Promise<object>} 刚落库那条记录的信息(id / 文件名 / 状态)
   */
  async uploadFile(file) {
    const form = new FormData()
    form.append('file', file)
    const res = await fetchWithTimeout(
      `${CUSTOMER_BASE}/md/upload`,
      { method: 'POST', body: form },
      // 上传比普通请求慢(文件要落盘),超时给宽一点
      { timeout: 60000 }
    )
    if (!res.ok) throw new Error(await readErrorMessage(res))
    return unwrap(await res.json()) || {}
  },

  /**
   * 改问答文件的备注
   *
   * <p>后端的备注列是 varchar(200),超了会报 500(不是 400)—— 前端自己先拦一道。
   * 备注允许留空 = 清掉备注。
   *
   * @param {object} params
   * @param {number} params.id 文件 id
   * @param {string} params.remark 新备注
   * @returns {Promise<boolean>}
   */
  async updateRemark({ id, remark }) {
    const payload = await postJson(`${CUSTOMER_BASE}/md/remark`, { id, remark })
    return !!unwrap(payload)
  },

  /**
   * 删除问答文件(文件行 + 磁盘文件 + 这个文件的向量一起清掉)
   *
   * <p>⚠️ <b>「待处理」「向量化中」的文件删不掉</b>(后端返回业务码 20010)——
   *    异步线程可能正拿着它干活。前端该提前把按钮禁掉,而不是等后端来拒。
   *
   * @param {object} params
   * @param {number} params.id 文件 id
   * @returns {Promise<boolean>}
   */
  async deleteFile({ id }) {
    const payload = await postJson(`${CUSTOMER_BASE}/md/delete`, { id })
    return !!unwrap(payload)
  },

  /** 上传大小上限(字节)—— 前端先拦一道,免得白跑一趟 */
  MAX_UPLOAD_SIZE,
}
