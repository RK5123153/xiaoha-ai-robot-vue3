/**
 * 图片预处理(纯前端,不发请求)
 *
 * 存在的理由有三个,都是后端替不了、前端必须自己兜的:
 *
 * 1. **体积** ⚠️ 这是最容易踩的一个
 *    后端 `MediaSupport` 允许 10MB,但**真正卡住请求的是 Spring 容器**:
 *    `spring.servlet.multipart.max-file-size` 的默认值只有 **1MB**
 *    (后端 application.yml 里没配这一项,用的是框架默认值)。
 *    超过 1MB 的请求根本进不了 controller,直接被容器拒掉
 *    (MaxUploadSizeExceededException → 500),而且**报出来的错跟「图片太大」没关系**。
 *    手机随手拍一张就是 3~8MB,所以前端先把图缩到 1MB 以内再发。
 *    (后端那边该把 max-file-size 配上,见 docs/ 里的方案文档 —— 但前端这层压缩
 *     依然要留着:压缩后请求体更小,上传和 base64 编码都快得多。)
 *
 * 2. **类型**
 *    非图片文件后端会 400。而且 Spring AI 的 OpenAI 协议转换器遇到非 `image/*`
 *    的附件是**静默丢掉**的(只打一行 INFO 日志)——
 *    症状是「图没发出去,模型只收到一句文字」,排查起来极其费劲。
 *    前端先拦一道,给人话。
 *
 * 3. **方向**
 *    手机竖拍的照片靠 EXIF 记录方向,浏览器解码时要按 EXIF 转正,
 *    否则模型看到的是躺着的图。
 */

/** 后端 `MediaSupport.MAX_IMAGE_BYTES` 的上限:10MB */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/**
 * 压缩目标:800KB
 *
 * 为什么不是刚好 1MB:Spring 容器默认上限是 1MB(=1048576 字节),
 * 留点余量,免得 multipart 的边界/表单头一叠加就顶到线上。
 */
export const TARGET_IMAGE_BYTES = 800 * 1024

/** 压缩后的最长边(像素)。模型看图不需要原图那么清晰,1600 足够。 */
const MAX_EDGE = 1600

/** 能当图片用的后缀 —— 只在浏览器给不出 content-type 时才用得上 */
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp)$/i

/**
 * 把字节数说成人话
 *
 * @param {number} bytes
 * @returns {string}
 */
export const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 这个文件是不是图片?
 *
 * 判定顺序和后端 `MediaSupport.guessMimeType` 一致:
 * 先看 content-type,没有(或不可信)再看文件名后缀。
 *
 * @param {File|null|undefined} file
 * @returns {boolean}
 */
export const isImageFile = (file) => {
  if (!file) return false
  const type = file.type || ''
  if (type) return type.startsWith('image/')
  return IMAGE_EXT.test(file.name || '')
}

/**
 * 校验图片,不合法就抛错(错误信息直接给人看)
 *
 * @param {File} file
 */
export const assertImageFile = (file) => {
  if (!file) throw new Error('没有拿到图片')
  if (file.size === 0) throw new Error('这个文件是空的')
  if (!isImageFile(file)) {
    throw new Error(
      `只支持图片(jpg/png/webp/gif/bmp),这个文件是${file.type || '未知类型'}`
    )
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `图片太大(${formatBytes(file.size)}),上限 ${formatBytes(MAX_IMAGE_BYTES)}`
    )
  }
}

/**
 * 用 <img> 解码文件(老浏览器的兜底)
 *
 * @param {File} file
 * @returns {Promise<HTMLImageElement>}
 */
const loadViaImgElement = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('这张图片打不开(可能不是有效的图片文件)'))
    }
    img.src = url
  })

/**
 * 解码图片
 *
 * 优先用 `createImageBitmap`:更快,而且 `imageOrientation: 'from-image'`
 * 会按 EXIF 把方向转正(手机竖拍的照片不会躺着发给模型)。
 *
 * @param {File} file
 * @returns {Promise<CanvasImageSource & {width: number, height: number}>}
 */
const decodeImage = async (file) => {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // 老浏览器不认 imageOrientation,退回 <img>
    }
  }
  return loadViaImgElement(file)
}

/**
 * canvas → Blob
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string} type
 * @param {number} quality
 * @returns {Promise<Blob|null>}
 */
const canvasToBlob = (canvas, type, quality) =>
  new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null)
      return
    }
    canvas.toBlob((blob) => resolve(blob), type, quality)
  })

/**
 * 把文件名后缀改成 .jpg(转成 JPEG 之后)
 *
 * @param {string} name
 * @returns {string}
 */
const renameToJpg = (name) => {
  const base = (name || 'image').replace(/\.[^.]+$/, '').trim()
  return `${base || 'image'}.jpg`
}

/**
 * 把图片处理成「可以直接发给后端」的状态
 *
 * 小于目标体积的原样返回;超了就缩放 + 转 JPEG,
 * 压不下去就一轮轮地降质量、缩边长(最多 4 轮)。
 *
 * @param {File} file 用户选的文件
 * @returns {Promise<{file: File, downscaled: boolean}>} downscaled = 是不是压过
 */
export const prepareImage = async (file) => {
  assertImageFile(file)

  // 已经够小,原样发 —— 不做无谓的重编码(重编码会掉画质)
  if (file.size <= TARGET_IMAGE_BYTES) return { file, downscaled: false }

  const source = await decodeImage(file)
  const width = source.width || source.naturalWidth
  const height = source.height || source.naturalHeight
  if (!width || !height) throw new Error('这张图片打不开(可能不是有效的图片文件)')

  let edge = MAX_EDGE
  let quality = 0.9
  let best = null

  for (let round = 0; round < 4; round++) {
    const scale = Math.min(1, edge / Math.max(width, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('这个浏览器不支持图片压缩,换个小一点的图试试')

    // ⚠️ 先铺一层白底:PNG 的透明区域转成 JPEG 会变成黑色
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height)

    const blob = await canvasToBlob(canvas, 'image/jpeg', quality)
    if (!blob) break
    best = blob

    if (blob.size <= TARGET_IMAGE_BYTES) break

    // 还是太大:先降质量,质量到底了再缩边长
    if (quality > 0.6) quality = Math.round((quality - 0.15) * 100) / 100
    else edge = Math.round(edge * 0.75)
  }

  if (!best) throw new Error('图片压缩失败,换一张试试')
  if (best.size > MAX_IMAGE_BYTES) throw new Error('这张图压缩后还是太大')

  const out = new File([best], renameToJpg(file.name), { type: 'image/jpeg' })
  return { file: out, downscaled: true }
}
