/**
 * 模型清单 —— /v13/models
 */

import { API_BASE, getJson, unwrap } from './base.js'

export const modelApi = {
  /**
   * 后端配置了哪些模型
   *
   * <p>每一项:
   * <pre>
   *   { code, name, provider, description, webSearch }
   *   code        发请求时用的模型标识(modelName)
   *   name        展示用的名字
   *   provider    厂商
   *   description 一句话说明
   *   webSearch   这个模型支不支持联网搜索
   * </pre>
   *
   * @returns {Promise<Array<object>>} 模型清单
   *
   * <p>⚠️ 失败时**抛出去**,不吞掉:
   *    「后端挂了(等下再拉)」和「后端确实一个模型都没配」是两回事 ——
   *    吞掉的话上层分不出,只能一律当成「没有可选模型」,
   *    于是用户打开下拉框看到空菜单,却不知道为什么(其实后端还没起来)。
   *    上层(store)拿到异常后可以不置「已加载」标记,等用户打开下拉框时再拉一次。
   */
  async list() {
    const payload = await getJson(`${API_BASE}/v13/models`)
    const data = unwrap(payload)
    return Array.isArray(data) ? data : []
  },
}
