/**
 * 待发送图片的状态(选图 → 压缩 → 预览 → 移除)
 *
 * <p>为什么抽出来:首页和聊天页的输入框都要处理图片,
 *    而「压缩 + object URL 生命周期」这套逻辑两边**一模一样**。
 *    复制两份的话,以后改压缩策略要记得改两处 ——
 *    漏一处就出现「首页能发图、聊天页发不出去」这种鬼故事。
 *
 * <p>object URL 的生命周期是最容易出错的地方:
 *    URL.revokeObjectURL 一调用,那个地址就变成死链(图片会变成裂图)。
 *    但图片发出去之后,气泡里的缩略图还在用它 ——
 *    所以「释放」之前必须先问一句「还有没有人用这个地址」。
 *
 * <p>它只管图片本身,不负责「发出去之后怎么办」—— 那是页面的事。
 */

import { ref, onBeforeUnmount } from 'vue'
import { message as antMessage } from 'ant-design-vue'
import { prepareImage } from './image.js'

/** 自增序号:给图片一个本地 id(crypto.randomUUID 在个别环境里没有) */
let seq = 0
const nextId = () =>
  globalThis.crypto?.randomUUID?.() || `img-${Date.now()}-${++seq}`

/**
 * @param {object} [options]
 * @param {(url: string) => boolean} [options.isUrlInUse]
 *        判断某个预览地址**还有没有人在用**(比如消息气泡里的缩略图)。
 *        返回 true 的话,这个地址不会被回收。
 */
export const useAttachment = ({ isUrlInUse } = {}) => {
  /** 待发送的图片:{ id, file, previewUrl, name, size } */
  const attachment = ref(null)

  /** 正在压缩(大图要缩放,有几百毫秒的空档) */
  const preparingImage = ref(false)

  /** 创建过的 object URL(统一在组件卸载时回收) */
  const objectUrls = []

  /** 记下一个 object URL(卸载时统一回收) */
  const track = (url) => {
    if (url && !objectUrls.includes(url)) objectUrls.push(url)
    return url
  }

  /**
   * 释放一个 object URL
   *
   * <p>还有人在用就留着 —— 气泡里的缩略图正在用它,
   *    这时候 revoke 掉,用户看到的就是一张裂图。
   */
  const releaseObjectUrl = (url) => {
    if (!url) return
    if (isUrlInUse && isUrlInUse(url)) return
    const i = objectUrls.indexOf(url)
    if (i !== -1) {
      objectUrls.splice(i, 1)
      URL.revokeObjectURL(url)
    }
  }

  /**
   * 选好一张图(点了按钮 / 粘贴 / 拖拽都走这里)
   *
   * <p>失败(不是图片 / 压缩不了)时给人话提示,不让它静悄悄地消失。
   */
  const pickImage = async (file) => {
    if (!file || preparingImage.value) return
    preparingImage.value = true
    try {
      const { file: prepared } = await prepareImage(file)
      const previewUrl = track(URL.createObjectURL(prepared))

      const old = attachment.value
      attachment.value = {
        id: nextId(),
        file: prepared,
        previewUrl,
        name: prepared.name,
        size: prepared.size,
      }
      // 换掉的旧图没人引用了才回收
      if (old) releaseObjectUrl(old.previewUrl)
    } catch (e) {
      console.error('图片处理失败: ', e)
      antMessage.info(e.message || '这个文件不能当图片用')
    } finally {
      preparingImage.value = false
    }
  }

  /** 移除待发送的图片 */
  const removeImage = () => {
    const old = attachment.value
    attachment.value = null
    if (old) releaseObjectUrl(old.previewUrl)
  }

  /**
   * 接管一张**外部**的图片(首页 → 聊天页 交接过来的)
   *
   * <p>交接时图片已经压缩好了,别再压一遍。
   */
  const adoptImage = ({ file, previewUrl }) => {
    if (!file) return
    const old = attachment.value
    attachment.value = {
      id: nextId(),
      file,
      previewUrl,
      name: file.name || '图片',
      size: file.size || 0,
    }
    track(previewUrl)
    if (old) releaseObjectUrl(old.previewUrl)
  }

  /**
   * 把某个预览地址的「所有权」交出去(**不回收**)
   *
   * <p>首页把图发给聊天页时用:那边的组件马上要卸载,
   *    卸载时会回收自己记下的所有 object URL ——
   *    不把这个地址交出去,聊天页拿到的就是一张裂图。
   */
  const detachPreviewUrl = (url) => {
    const i = objectUrls.indexOf(url)
    if (i !== -1) objectUrls.splice(i, 1)
  }

  onBeforeUnmount(() => {
    objectUrls.forEach((url) => URL.revokeObjectURL(url))
    objectUrls.length = 0
  })

  return {
    attachment,
    preparingImage,
    pickImage,
    removeImage,
    adoptImage,
    detachPreviewUrl,
  }
}
