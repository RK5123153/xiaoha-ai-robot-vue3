/**
 * 复制文本到剪贴板
 *
 * 抽成独立模块的原因：代码块的「复制」按钮和消息底部的「复制」按钮都要用，
 * 放一起才不会出现两套实现、两套坑。
 */

/**
 * 复制文本
 *
 * ⚠️ navigator.clipboard 只在**安全上下文**可用（https / localhost）。
 *    页面用 http://192.168.x.x 访问时 writeText 直接是 undefined，
 *    所以必须留 execCommand 兜底 —— 不然局域网访问时「复制」按钮就是死的。
 *
 * @param {string} text 要复制的文本
 * @returns {Promise<boolean>} 是否复制成功
 */
export const copyText = async (text) => {
  if (!text) return false

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch (e) {
    // 权限被拒（非安全上下文 / 用户没授权）时走下面的兜底
  }

  // 兜底：老办法（已被多数浏览器标记为 deprecated，但在非安全上下文里仍可用）
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch (e) {
    return false
  }
}
