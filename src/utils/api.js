/**
 * 后端接口地址
 *
 * 单独抽一个文件，是因为不止一处要用：
 *   - src/views/Index.vue —— 聊天、SSE、反馈、回滚
 *   - src/utils/tts.js    —— 后端语音合成
 * 换环境（打包到别的域名）时只改这一处。
 */
export const API_BASE = 'http://localhost:8080/v2/ai'
