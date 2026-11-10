/**
 * 语音朗读（浏览器内置的 SpeechSynthesis）
 *
 * 为什么用浏览器的而不是后端 TTS：
 *   - 零成本、零延迟、不用配 API Key
 *   - Windows / macOS / Android / iOS 都自带中文语音
 *   - 缺点是音质一般（系统 TTS），且依赖系统装了中文语音包
 *     —— 想换成 MiniMax TTS 那种自然语音，见 docs/ 里的后端方案。
 *
 * ⚠️ 三个必须处理的坑：
 *
 * 1. **Chrome 读超 15 秒会自己停**（crbug 1053671）
 *    这是 Chrome 的老 bug，不是我们代码的问题。
 *    绕法：每隔几秒 pause() + resume() 一下，把浏览器的计时器重置掉。
 *    代码在下面的 keepAlive 里。
 *
 * 2. **getVoices() 第一次拿不到**
 *    Chrome 要等语音列表加载完才有内容，得监听 voiceschanged 事件。
 *    这里用 whenVoicesReady() 等一下（最多 1.5 秒），拿不到就退回默认语音。
 *
 * 3. **同时只能读一条**
 *    点第二条消息的朗读时，第一条必须停下来。
 *    这里用「会话」概念：新会话开始时把旧的 cancel 掉。
 */

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null

/** 当前正在朗读的会话（同一时间只有一个） */
let currentSession = null

/** 单段文本的最大长度（字符） */
const CHUNK_MAX = 200
/** 硬切上限：一直没有合适的断点时，超过这个长度就强制切 */
const CHUNK_HARD_MAX = 400
/** Chrome 15 秒 bug 的续命间隔（毫秒） */
const KEEPALIVE_MS = 8000
/** 等语音列表的最长时间（毫秒） */
const VOICES_TIMEOUT_MS = 1500

/**
 * 浏览器支不支持语音朗读
 * @returns {boolean}
 */
export const speechSupported = () => !!synth

/**
 * 当前是不是正在朗读
 * @returns {boolean}
 */
export const isSpeaking = () => !!synth?.speaking

/**
 * 等语音列表就绪
 *
 * Chrome 首次 getVoices() 返回空数组，语音列表是异步加载的，
 * 加载完会触发 voiceschanged 事件。拿不到也不能一直等（有些浏览器不触发），
 * 所以加个超时兜底。
 *
 * @returns {Promise<SpeechSynthesisVoice[]>}
 */
const whenVoicesReady = () =>
  new Promise((resolve) => {
    if (!synth) return resolve([])

    const now = synth.getVoices()
    if (now && now.length) return resolve(now)

    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      synth.removeEventListener?.('voiceschanged', finish)
      resolve(synth.getVoices() || [])
    }
    synth.addEventListener?.('voiceschanged', finish)
    setTimeout(finish, VOICES_TIMEOUT_MS)
  })

/**
 * 挑一个中文语音
 *
 * 优先级：简体中文 → 任意中文 → 系统默认 → 第一个
 * @param {SpeechSynthesisVoice[]} voices
 * @returns {SpeechSynthesisVoice|null}
 */
const pickVoice = (voices) => {
  if (!voices?.length) return null
  return (
    voices.find((v) => /^zh[-_]CN/i.test(v.lang)) ||
    voices.find((v) => /^zh/i.test(v.lang)) ||
    voices.find((v) => v.default) ||
    voices[0]
  )
}

/**
 * 把长文本切成一段段
 *
 * 为什么要切：一次 speak() 念一整篇，万中途出错/被浏览器掐断就整段没了；
 * 分段之后每段独立，一段出问题不影响后面。
 * 切分点优先选句末标点（念起来不打断），没有合适标点就硬切。
 *
 * @param {string} text
 * @param {number} max
 * @returns {string[]}
 */
export const splitSpeechText = (text, max = CHUNK_MAX) => {
  if (!text) return []
  const chunks = []
  let buf = ''

  for (const ch of text) {
    buf += ch
    const isBreak = /[。！？!?；;，,、\n]/.test(ch)
    if ((isBreak && buf.length >= max) || buf.length >= CHUNK_HARD_MAX) {
      chunks.push(buf)
      buf = ''
    }
  }
  if (buf.trim()) chunks.push(buf)
  return chunks.filter((c) => c.trim())
}

/**
 * 停止朗读
 *
 *  cancel() 会让当前 utterance 触发 onerror('interrupted')，
 *  靠这个把 speakText 的 Promise 收掉。
 */
export const stopSpeaking = () => {
  if (currentSession) {
    currentSession.cancelled = true
    clearInterval(currentSession.timer)
    // 主动结束掉 Promise，避免 cancel 没触发 onerror 时挂死
    currentSession.finish?.()
    currentSession = null
  }
  try {
    synth?.cancel()
  } catch (e) {
    // 某些浏览器在无朗读时 cancel() 会抛，忽略
  }
}

/**
 * 朗读一段文本
 *
 * @param {string} text 纯文本（先用 toPlainText 剥掉 Markdown 标记）
 * @param {object} [handlers]
 * @param {Function} [handlers.onStart] 开始朗读时
 * @param {Function} [handlers.onEnd] 朗读结束/被打断时
 * @param {Function} [handlers.onError] 出错时
 * @returns {Promise<void>} 朗读结束（或被打断）后 resolve
 */
export const speakText = async (text, handlers = {}) => {
  if (!synth) {
    handlers.onError?.(new Error('当前浏览器不支持语音朗读'))
    return
  }

  const chunks = splitSpeechText(text)
  if (!chunks.length) {
    handlers.onEnd?.()
    return
  }

  // 同一时间只读一条：先把上一条停掉
  stopSpeaking()

  const voices = await whenVoicesReady()
  const voice = pickVoice(voices)

  const session = { cancelled: false, timer: null, finish: null }
  currentSession = session
  handlers.onStart?.()

  await new Promise((resolve) => {
    session.finish = resolve

    let index = 0
    const next = () => {
      if (session.cancelled) return
      if (index >= chunks.length) return resolve()

      const utterance = new SpeechSynthesisUtterance(chunks[index++])
      if (voice) {
        utterance.voice = voice
        utterance.lang = voice.lang
      }
      utterance.rate = 1
      utterance.pitch = 1

      utterance.onend = () => {
        if (!session.cancelled) next()
      }
      utterance.onerror = (e) => {
        // interrupted / canceled 是我们自己停的，不算错误
        const userCancelled = e?.error === 'interrupted' || e?.error === 'canceled'
        if (!session.cancelled && !userCancelled) handlers.onError?.(e)
        resolve()
      }

      try {
        synth.speak(utterance)
      } catch (e) {
        handlers.onError?.(e)
        resolve()
      }
    }

    // Chrome 15 秒 bug 的续命：隔 8 秒 pause + resume 一下
    session.timer = setInterval(() => {
      if (!synth.speaking || synth.paused) return
      try {
        synth.pause()
        synth.resume()
      } catch (e) {
        // 忽略：某些浏览器在切换时抛异常
      }
    }, KEEPALIVE_MS)

    next()
  })

  clearInterval(session.timer)
  if (currentSession === session) currentSession = null
  handlers.onEnd?.()
}
