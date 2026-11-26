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
   * @returns {Promise<Array<object>>} 模型清单;拿不到时返回空数组
   */
  async list() {
    try {
      const payload = await getJson(`${API_BASE}/v13/models`)
      const data = unwrap(payload)
      return Array.isArray(data) ? data : []
    } catch {
      // 后端没这个接口 / 网络不通 → 当作「没有可选模型」,前端用默认模型
      return []
    }
  },
}
