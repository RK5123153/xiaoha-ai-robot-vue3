/**
 * localStorage 的安全包装
 *
 * <p>为什么不能直接用 window.localStorage:
 *   隐私模式 / 站点数据被禁用 / 某些 App 内嵌 WebView 里,
 *   **访问** localStorage 这个属性本身就可能抛 SecurityError ——
 *   不是读写才抛,是「取一下这个对象」就抛。
 *   那种情况下,任何一处直接写 localStorage 的代码都会把整个页面的初始化带崩。
 *
 * <p>所以统一走这里:读不到就当没有,写不进去就当这次没记住。
 *   「记住用户的选择」是锦上添花,不该因为存不下就把页面搞挂。
 *
 * <p>形状和 Web Storage API 一致(只用到 getItem / setItem)——
 *   这样可以直接传给 pinia-plugin-persistedstate 的 storage 选项。
 */

/**
 * 读一个键
 *
 * @param {string} key
 * @returns {string|null} 读不到(被禁用 / 不存在)时返回 null
 */
export const safeGetItem = (key) => {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * 写一个键
 *
 * @param {string} key
 * @param {string} value
 * @returns {boolean} 写进去了吗
 */
export const safeSetItem = (key, value) => {
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    // 配额满了 / 隐私模式 → 这次没记住,别的都不受影响
    return false
  }
}

/**
 * 删一个键
 *
 * @param {string} key
 */
export const safeRemoveItem = (key) => {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // 读不了也删不了 → 无所谓
  }
}

/**
 * 给 pinia-plugin-persistedstate 用的 storage
 *
 * <p>插件默认用的是 window.localStorage —— 那是在**插件初始化**时直接取属性,
 *    隐私模式下这一步就会抛,整页崩。所以这里换成自己这份。
 */
export const safeStorage = {
  getItem: safeGetItem,
  setItem: safeSetItem,
  removeItem: safeRemoveItem,
}
