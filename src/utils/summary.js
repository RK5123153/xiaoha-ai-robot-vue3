/**
 * 会话标题的还原 —— 把后端给的「机器味」标题变回人话
 *
 * <p>⚠️ 后端有部分数据是 **URL 编码**过的:
 *   "%E8%AE%B0%E4%BD%8F%EF%BC%9A…" 而不是「记住：…」。
 *   那些是历史遗留的脏数据(写入时多编码了一次),读出来就是一堆百分号。
 *
 * <p>⚠️ 而且后端会把标题截断到 60 个字 —— 截断点很可能切在某个多字节字符中间:
 *   "%E5%B9%B4%E8%B…" 里的 "%E8" 是个**残缺**的汉字(3 个字节只剩 1 个)。
 *   整串 decodeURIComponent 会抛 URIError,标题就全废了。
 *
 * <p>⚠️ 还有一条不能越的线:**含非 ASCII 字符的标题一律不碰**。
 *   「完成 50%BC 的任务」这种正常标题里也有 %XX,拿字节流去解会把中文全变成乱码。
 *   所以只有「整串都是可打印 ASCII」时才当它是编码过的
 *   (后端截断时补的省略号「…」不算 —— 它自己就是非 ASCII,得单独特判)。
 */

/**
 * 一串连续的百分号转义(%E8%AE%B0 这种)→ 还原成文字
 *
 * <p>正常情况就是 decodeURIComponent 的效果;但后端把标题截断到 60 个字时,
 * 截断点很可能切在某个多字节字符中间("%E5%B9%B4%E8%B…" —— 末尾那个字只剩了 2 个字节),
 * 这时整体 decode 会抛 URIError,得逐段来。
 *
 * @param {string} run 连续的 %XX 转义
 * @returns {string} 还原后的文字;整段不是合法 UTF-8 时原样返回
 */
const decodeRun = (run) => {
  const bytes = []
  for (let i = 0; i < run.length; i += 3) {
    bytes.push(parseInt(run.slice(i + 1, i + 3), 16))
  }

  const text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes))
  if (!text.includes('�')) return text

  // 有解不出来的字节:分两种情况
  //   a) 末尾是「半个字」(被截断)→ 丢掉这半个字,前面的照常显示
  //   b) 根本不是 UTF-8 → 整段原样保留(别把正常内容改坏)
  let i = bytes.length - 1
  while (i >= 0 && (bytes[i] & 0xc0) === 0x80) i-- // 跳过续字节
  if (i >= 0) {
    const lead = bytes[i]
    const need = lead >= 0xf0 ? 3 : lead >= 0xe0 ? 2 : lead >= 0xc0 ? 1 : 0
    const have = bytes.length - 1 - i
    if (need > 0 && have < need) return text.replace(/�+$/, '')
  }
  return run
}

/**
 * 把后端给的标题还原成人话
 *
 * @param {string} summary
 * @returns {string}
 */
export const decodeSummary = (summary) => {
  if (!summary || typeof summary !== 'string') return ''
  // 不像百分号编码(比如正文里本来就有 %)→ 原样返回
  if (!/%[0-9A-Fa-f]{2}/.test(summary)) return summary
  // 含非 ASCII → 这是**正常**的标题(只是碰巧有百分号),别按字节流解
  // (省略号是后端截断时补的,放行)
  if (!/^[\x20-\x7e…]*$/.test(summary)) return summary

  try {
    return decodeURIComponent(summary)
  } catch {
    // 编码被截断在某个多字节字符中间 → 逐段还原,末尾残缺的那个字丢掉
    return summary
      .replace(/(?:%[0-9A-Fa-f]{2})+/g, decodeRun)
      // 末尾那个还原不出字的残缺转义("%B…")→ 去掉
      .replace(/%[0-9A-Fa-f](?![0-9A-Fa-f])(?=…|$)/g, '')
      // 截断留下的替换字符(在省略号前面)也一并清掉
      .replace(/�+(?=…|$)/g, '')
  }
}
