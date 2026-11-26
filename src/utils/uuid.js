/**
 * 生成会话 uuid(后端建会话失败时的兜底)
 *
 * <p>后端 POST /chat/new 会给一个真正的 uuid;
 * 万一那一步挂了,前端自己造一个也能发 —— 后端按 chatId 存消息,
 * 不校验 uuid 是不是它自己发的。
 *
 * @returns {string}
 */
export const genUuid = () =>
  globalThis.crypto?.randomUUID?.() ||
  `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
