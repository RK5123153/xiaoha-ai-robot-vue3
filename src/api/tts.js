/**
 * 语音合成 —— /v2/ai/speech
 */

import { API_BASE, fetchWithTimeout, readErrorMessage } from './base.js'

/** 老栈:语音 —— /v2/ai/** */
const LEGACY_CHAT_BASE = `${API_BASE}/v2/ai`

export const ttsApi = {
  /**
   * 请求后端合成一段 mp3
   *
   * @param {string} text 纯文本
   * @param {AbortSignal} [signal]
   * @returns {Promise<Blob>} 音频;失败时抛 Error(带 status)
   */
  async synthesize(text, signal) {
    const res = await fetchWithTimeout(
      `${LEGACY_CHAT_BASE}/speech`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      },
      { signal }
    )
    if (!res.ok) {
      // 501 = 后端没开 TTS(app.tts.enabled=false)→ 上层据此退回浏览器 TTS
      const err = new Error(`后端语音接口返回 ${res.status}`)
      err.status = res.status
      throw err
    }
    const type = res.headers.get('content-type') || ''
    if (!type.includes('audio')) {
      throw new Error('后端语音接口没返回音频')
    }
    return res.blob()
  },
}
