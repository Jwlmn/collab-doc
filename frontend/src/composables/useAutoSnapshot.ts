import { onBeforeUnmount } from 'vue'
import { api } from '../utils/request'

/** 两次自动快照之间的最短静默期（毫秒）——与后端 AUTO_MIN_INTERVAL 对齐 */
const QUIET_PERIOD_MS = 60_000

export interface AutoSnapshotCapture {
  content_json: unknown
  content_html: string
}

export interface UseAutoSnapshotOptions {
  documentId: () => number
  /** 是否启用（只读或访客分享时不自动快照） */
  enabled: () => boolean
  capture: () => AutoSnapshotCapture | null
}

/**
 * 编辑中的静默自动快照：内容停止变化 QUIET_PERIOD_MS 后拍一张 kind=auto 的版本。
 *
 * - 失败一律静默（自动快照不该打断写作，也不该弹 toast）
 * - 与上次提交的序列化结果相同则跳过（后端还会再判一次，双保险）
 * - 拔掉定时器在 onBeforeUnmount，避免卸载后仍发请求
 */
export function useAutoSnapshot(opts: UseAutoSnapshotOptions): { notifyChange: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastPosted = ''
  let inFlight = false

  async function snapshot(): Promise<void> {
    if (!opts.enabled()) return
    const payload = opts.capture()
    if (!payload) return

    const serialized = JSON.stringify(payload.content_json)
    if (serialized === lastPosted) return

    inFlight = true
    try {
      const documentId = opts.documentId()
      await api.post(`/documents/${documentId}/versions`, {
        kind: 'auto',
        content_json: payload.content_json,
        content_html: payload.content_html,
      })
      lastPosted = serialized
    } catch (error) {
      // 自动快照失败不打扰用户；下次内容变化会再试
      console.warn('[auto-snapshot] 保存失败', error)
    } finally {
      inFlight = false
    }
  }

  function notifyChange(): void {
    if (!opts.enabled()) return
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (inFlight) {
        // 上一张还没拍完，顺延一次
        notifyChange()
        return
      }
      void snapshot()
    }, QUIET_PERIOD_MS)
  }

  onBeforeUnmount(() => {
    if (timer !== null) clearTimeout(timer)
  })

  return { notifyChange }
}
