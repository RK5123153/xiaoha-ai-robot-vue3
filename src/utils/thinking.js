/**
 * 思考链的攒法 —— 主聊天页和智能客服页共用一份
 *
 * <p>为什么抽出来:两个页面都要「把后端流过来的思考链片段攒成一条完整的链,
 *    太长了就从**前面**截掉」—— 规则一样的事抄两份,改一处就漏一处
 *    (漏的那份会变成「思考链越攒越长,气泡越来越重」)。
 */

/**
 * 思考链最多留多长(字)
 *
 * <p>⚠️ 思考链可能很长(实测一两千字),全留着气泡会越来越重;
 *    而且有用的是**最后**那几段(它在说什么、准备干什么),
 *    所以超长就从**前面**截掉。
 */
export const THINKING_MAX = 4000

/**
 * 攒思考链
 *
 * @param {string} current 已有的思考链
 * @param {string} add     新来的一段
 * @returns {string} 新的思考链
 */
export const appendThinking = (current, add) => {
  const next = (current || '') + (add || '')
  return next.length > THINKING_MAX ? next.slice(next.length - THINKING_MAX) : next
}
