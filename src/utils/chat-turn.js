/**
 * 聊天轮次相关的纯函数。
 *
 * 单独拆出来是因为这里有一条**很容易悄悄坏掉**的规则：
 * 只有「最后一条回答」能点重新生成。弄错了不会报错，
 * 只会让后端记忆文件被写脏（同一个问题问两遍），很难从界面上看出来。
 */

/**
 * 最后一条「有对应提问」的回答的 id —— 只有它能重新生成。
 *
 * ⚠️ 为什么只有最后一条能重新生成：
 *   后端的 `DELETE /chat/{uuid}/last-turn` 只会回滚**最后一轮**，
 *   它没有「按轮次回滚」的能力。如果允许重新生成中间那条回答：
 *     记忆 [u1,a1,u2,a2]，用户点第 1 轮的「重新生成」
 *     → 后端删掉的是最后一轮 → 记忆变成 [u1,a1]
 *     → 前端重发第 1 轮的提问 → 记忆变成 [u1,a1,u1,a1_new]
 *   结果是同一个问题问了两遍（模型会当成在追问），而且最后一轮凭空消失，
 *   但它的气泡还留在页面上 —— 前端和后端对不上。
 *
 *   问候语（turn = 0）不算 —— 它没有对应的提问。
 *
 * @param {Array<{id: string, role: string, turn?: number, kind?: string}>} chatList 聊天记录
 * @param {string} [kind] 只看这一类消息（'text' 文字对话 / 'vision' 看图说话）。
 *   两种对话的后端语义不同：文字对话要回滚记忆，看图说话是无状态的（不用回滚），
 *   所以「最后一条」得按类型分别算。
 * @returns {string} 可重新生成那条消息的 id；没有则返回空字符串
 */
export const lastRegenerableId = (chatList, kind = 'text') => {
  if (!Array.isArray(chatList)) return ''
  for (let i = chatList.length - 1; i >= 0; i--) {
    const c = chatList[i]
    if (!c || c.role !== 'assistant') continue
    if ((c.kind ?? 'text') !== kind) continue
    if ((c.turn ?? 0) > 0) return c.id
  }
  return ''
}

/**
 * 这条回答是本次会话的第几轮（从 1 开始；问候语是 0）。
 *
 * 后端的记忆文件是 [u1,a1,u2,a2,…] 这种交替结构，
 * 「第 k 轮的回答」对应记忆里第 2k-1 条 —— 拿它当反馈的定位标识。
 *
 * ⚠️ 文字对话和看图说话**分别计数**：
 *   文字对话的轮次要和后端记忆里的顺序对得上，所以只数文字消息；
 *   看图说话是独立的无状态问答，用自己的轮次号 + 自己的 chatId 上报反馈，
 *   免得和文字对话的轮次号撞车（撞了的话，反馈就指错回答了）。
 *
 * @param {Array<{id: string, role: string, turn?: number}>} chatList 聊天记录
 * @param {string} messageId 消息 id
 * @returns {number} 轮次；找不到返回 0
 */
export const turnIndexOf = (chatList, messageId) => {
  if (!Array.isArray(chatList)) return 0
  const msg = chatList.find((c) => c.id === messageId)
  return msg?.turn ?? 0
}
