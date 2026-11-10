/**
 * 语音朗读：**后端 TTS 优先，失败自动退回浏览器内置 TTS**
 *
 * 为什么要有两条路：
 *   - 浏览器内置的 `speechSynthesis`（Web Speech API）零成本、离线可用，
 *     但音质是操作系统自带的 —— Windows 上就是「微软 Huihui」那套 SAPI5 声音，
 *     机械感重，一听就是「机器在念」。
 *   - 后端走 MiniMax `speech-02-hd`，是自然语音，音质好得多，
 *     但要走网络、要花钱，而且依赖后端 `app.tts.enabled=true`。
 *
 * 所以策略是：**后端优先，拿不到就悄悄退回浏览器**，用户无感。
 * 后端没开时接口返回 501，正好触发退回 —— 不用在前端配开关跟着后端改。
 *
 * 后端接口：POST {API_BASE}/speech  body {"text":"要念的纯文本"}  → audio/mpeg
 * ⚠️ 必须先剥掉 Markdown（`toPlainText`），别把 ``` 和 ** 一起送过去。
 *
 * 用后端 TTS 顺带解决了一个浏览器 TTS 的老 bug：
 * Chrome 读超 15 秒会自己停（crbug 1053671），`speech.js` 里得靠
 * pause()+resume() 每 8 秒续命；mp3 是原生播放，没这毛病。
 */

import { speakText, speechSupported, stopSpeaking } from './speech.js'
import { API_BASE } from './api.js'

/**
 * 总开关：设成 false 就一直用浏览器内置 TTS，一个请求都不发。
 * 正常情况不用改 —— 后端不可用时会自动退回。
 */
export const USE_BACKEND_TTS = true

/** 一次请求最多送多少字（后端上限 5000，这里留余量） */
export const CHUNK_MAX = 1500
/** 一直没有合适断点时的硬切上限 */
export const CHUNK_HARD_MAX = 3000

/** 当前会话（后端音频播放中）。同时只允许一条。 */
let session = null

/**
 * 把长文本切成一段段
 *
 * 为什么要切：一次送几千字，上游合成要好几秒，用户干等着；
 * 而且后端也有单次字数上限。切小之后还能边合成边播。
 *
 * 切分点优先选句末标点（念起来不打断），没有合适标点就硬切。
 *
 * @param {string} text
 * @param {number} max
 * @returns {string[]}
 */
export const splitForTts = (text, max = CHUNK_MAX) => {
  if (!text) return []
  const chunks = []
  let buf = ''

  for (const ch of text) {
    buf += ch
    const isBreak = /[。！？!?；;\n]/.test(ch)
    if ((isBreak && buf.length >= max) || buf.length >= CHUNK_HARD_MAX) {
      chunks.push(buf)
      buf = ''
    }
  }
  if (buf.trim()) chunks.push(buf)
  return chunks.filter((c) => c.trim())
}

/**
 * 停掉当前正在播的一切（后端音频 + 浏览器 TTS）
 *
 * 点第二条消息的「朗读」时，第一条必须停下来；
 * 组件被销毁时也要调它，不然会听到一条已经不存在的消息的声音。
 */
export const stopTts = () => {
  const s = session
  session = null
  if (s) {
    s.cancelled = true
    try {
      s.audio?.pause()
    } catch (e) {
      /* 忽略 */
    }
    // 让还在等待的播放 promise 结束，不然 await 会一直挂着
    s.resolvePlay?.(false)
    // 正在飞的合成请求也掐掉，别白花钱
    try {
      s.controller?.abort()
    } catch (e) {
      /* 忽略 */
    }
    if (s.url) {
      URL.revokeObjectURL(s.url)
      s.url = null
    }
  }
  // 浏览器 TTS 那边也要停
  stopSpeaking()
}

/**
 * 请求后端合成一段 mp3
 *
 * @param {string} text 纯文本
 * @param {AbortSignal} [signal]
 * @returns {Promise<Blob>}
 */
const requestSpeech = async (text, signal) => {
  const res = await fetch(`${API_BASE}/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  })
  if (!res.ok) {
    // 501 = 后端没开 TTS（app.tts.enabled=false）→ 上层据此退回浏览器 TTS
    const err = new Error(`后端语音接口返回 ${res.status}`)
    err.status = res.status
    throw err
  }
  const type = res.headers.get('content-type') || ''
  if (!type.includes('audio')) {
    throw new Error('后端语音接口没返回音频')
  }
  return res.blob()
}

/**
 * 播放一个音频 blob，播完（或失败）后 resolve
 *
 * @param {Blob} blob
 * @param {object} s 会话对象
 * @returns {Promise<boolean>} 是否成功播完
 */
const playBlob = (blob, s) =>
  new Promise((resolve) => {
    if (s.cancelled) {
      resolve(false)
      return
    }
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    s.audio = audio
    s.url = url

    // ⚠️ 这个「已结束」标记必须是**每次播放自己的**，
    //    放会话上会让第二段永远 resolve 不了（第一段就把标记置真了）。
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      try {
        audio.pause()
      } catch (e) {
        /* 忽略 */
      }
      URL.revokeObjectURL(url)
      if (s.audio === audio) {
        s.audio = null
        s.url = null
      }
      resolve(ok)
    }
    s.resolvePlay = finish

    audio.onended = () => finish(true)
    audio.onerror = () => finish(false)

    // ⚠️ play() 可能被浏览器自动播放策略拒掉（没有用户手势时），
    //    reject 之后走 fallback 退回浏览器 TTS。
    const p = audio.play()
    if (p && typeof p.catch === 'function') {
      p.catch(() => finish(false))
    }
  })

/**
 * 用后端 TTS 念一遍
 *
 * @param {string} text
 * @param {object} s 会话对象
 * @param {object} handlers
 * @returns {Promise<'played'|'stopped'|'partial'|'unavailable'>}
 */
const speakViaBackend = async (text, s, handlers) => {
  const chunks = splitForTts(text)
  let playedAny = false

  for (const chunk of chunks) {
    if (s.cancelled) return 'stopped'

    let blob
    try {
      blob = await requestSpeech(chunk, s.controller?.signal)
    } catch (e) {
      if (s.cancelled) return 'stopped'
      // 已经播过一段了 —— 再退回浏览器会把前面重复念一遍，不退回，直接收尾
      if (playedAny) {
        handlers.onError?.(e)
        return 'partial'
      }
      return 'unavailable'
    }

    if (s.cancelled) return 'stopped'

    const ok = await playBlob(blob, s)
    if (!ok) {
      if (s.cancelled) return 'stopped'
      return playedAny ? 'partial' : 'unavailable'
    }
    playedAny = true
  }

  handlers.onEnd?.()
  return 'played'
}

/**
 * 朗读一段文字：**后端优先，失败自动退回浏览器内置 TTS**
 *
 * @param {string} text 纯文本（先用 `toPlainText` 剥掉 Markdown）
 * @param {object} [handlers]
 * @param {Function} [handlers.onStart] 开始朗读
 * @param {Function} [handlers.onEnd] 朗读结束/被打断
 * @param {Function} [handlers.onError] 出错
 * @returns {Promise<string>} 实际走的哪条路：
 *   backend / browser / unsupported / stopped / empty / partial
 */
export const speakWithFallback = async (text, handlers = {}) => {
  if (!text || !text.trim()) {
    handlers.onEnd?.()
    return 'empty'
  }

  // 停掉上一条（不管它走的是哪条路）
  stopTts()

  const s = {
    cancelled: false,
    audio: null,
    url: null,
    resolvePlay: null,
    controller: typeof AbortController !== 'undefined' ? new AbortController() : null,
  }
  session = s

  if (USE_BACKEND_TTS) {
    handlers.onStart?.()
    const result = await speakViaBackend(text, s, handlers)
    if (result === 'played') {
      if (session === s) session = null
      return 'backend'
    }
    if (result === 'stopped' || result === 'partial') {
      if (session === s) session = null
      return result
    }
    // 后端不可用（501 / 网络不通 / 上游报错）→ 退回浏览器 TTS
    if (session === s) session = null
  }

  if (!speechSupported()) {
    handlers.onError?.(new Error('当前浏览器不支持语音朗读'))
    return 'unsupported'
  }
  await speakText(text, handlers)
  return 'browser'
}
