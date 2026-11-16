/**
 * 后端接口地址
 *
 * 单独抽一个文件，是因为不止一处要用：
 *   - src/views/Index.vue —— 聊天、SSE、反馈、回滚
 *   - src/utils/tts.js    —— 后端语音合成
 *   - src/utils/vision.js —— 多模态(看图说话)
 * 换环境（打包到别的域名）时只改这一处。
 */

/** 后端服务地址 */
export const SERVER_BASE = 'http://localhost:8080'

/**
 * 文字对话:/v2/ai/** —— **有**多轮记忆(按 chatId 存上下文)
 */
export const API_BASE = `${SERVER_BASE}/v2/ai`

/**
 * 多模态(看图说话):/v9/ai/** —— **无状态**,不接聊天记忆
 *
 * ⚠️ 别把两个 base 混用:
 *   /v2 的记忆是按 chatId 存的,/v9 每次都是「一张图 + 一个问题」的独立请求 ——
 *   后端根本不收 chatId 这个参数,传了也没用。
 *   这也是前端要单独开一个「看图说话」模式的原因:
 *   两种对话的上下文语义不一样,混在一条时间线上会让人以为模型记得上一张图。
 */
export const MULTIMODAL_API_BASE = `${SERVER_BASE}/v9/ai`
